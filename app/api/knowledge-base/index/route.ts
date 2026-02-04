import { NextResponse } from 'next/server';
import { fetchGoogleDoc, listFilesInFolder, getFolderMetadata } from '@/lib/document-fetcher';
import { chunkDocument } from '@/lib/document-chunker';
import { generateEmbeddings } from '@/lib/embeddings';
import { saveKnowledgeBase, loadKnowledgeBase } from '@/lib/knowledge-base-storage';

export async function GET() {
    try {
        const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

        if (!folderId) {
            return NextResponse.json({ indexed: [], pending: [], removed: [] });
        }

        // Fetch current files from Drive
        const driveFiles = await listFilesInFolder(folderId);

        // Load indexed metadata from storage
        const kbData = await loadKnowledgeBase();
        const indexedMeta = kbData?.fileMetadata || {};

        const driveFileIds = new Set(driveFiles.map(f => f.id));

        const indexed = driveFiles
            .filter(f => indexedMeta[f.id])
            .map(f => ({
                id: f.id,
                name: f.name,
                webViewLink: f.webViewLink,
                modifiedTime: f.modifiedTime,
                indexedAt: indexedMeta[f.id].indexedAt || kbData?.indexedAt,
                chunkCount: indexedMeta[f.id].chunkCount,
                isStale: f.modifiedTime !== indexedMeta[f.id].modifiedTime
            }));

        const pending = driveFiles
            .filter(f => !indexedMeta[f.id])
            .map(f => ({
                id: f.id,
                name: f.name,
                webViewLink: f.webViewLink,
                modifiedTime: f.modifiedTime
            }));

        // Find files that are in KB but no longer in Drive
        const removed = Object.entries(indexedMeta)
            .filter(([id]) => !driveFileIds.has(id))
            .map(([id, meta]) => ({
                id,
                name: (meta as any).name || "Unknown File",
                chunkCount: meta.chunkCount,
                modifiedTime: meta.modifiedTime
            }));

        return NextResponse.json({
            indexed,
            pending,
            removed,
            stats: {
                totalDriveFiles: driveFiles.length,
                totalIndexedFiles: Object.keys(indexedMeta).length
            }
        });

    } catch (error) {
        console.error('Error fetching knowledge base files:', error);
        return NextResponse.json({ error: 'Failed to fetch knowledge base files' }, { status: 500 });
    }
}


export async function POST() {
    try {
        const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

        if (!folderId) {
            return NextResponse.json(
                { error: 'GOOGLE_DRIVE_FOLDER_ID not configured' },
                { status: 500 }
            );
        }

        console.log('Starting knowledge base indexing...');

        // Load existing knowledge base to check for changes
        const existingKB = await loadKnowledgeBase();
        const existingFileMetadata = existingKB?.fileMetadata || {};

        let allChunks: Array<{ text: string; embedding: number[]; source?: string }> = [];
        let fileMetadata: Record<string, { modifiedTime: string; chunkCount: number; name: string; indexedAt?: string }> = {};
        const timestamp = new Date().toISOString();
        let totalStats = {
            processedDocs: 0,
            skippedDocs: 0,
            totalOriginalChars: 0,
            totalChunks: 0
        };

        console.log(`Processing folder: ${folderId}`);

        // Get folder metadata
        const folderMeta = await getFolderMetadata(folderId);
        const kbName = folderMeta.name;

        // List all files in folder
        const files = await listFilesInFolder(folderId);
        console.log(`Found ${files.length} documents in folder`);

        // Keep track of which files are still in the folder
        const currentFileIds = new Set(files.map(f => f.id));

        // First, preserve chunks from files that haven't changed
        if (existingKB) {
            for (const chunk of existingKB.chunks) {
                const sourceFileName = chunk.source;
                if (!sourceFileName) continue;

                // Find the file by name in current folder
                const currentFile = files.find(f => f.name === sourceFileName);

                if (currentFile && existingFileMetadata[currentFile.id]) {
                    const existingMeta = existingFileMetadata[currentFile.id];

                    // If file hasn't been modified, keep existing chunks
                    if (existingMeta.modifiedTime === currentFile.modifiedTime) {
                        allChunks.push(chunk);

                        // Only add to fileMetadata once per file
                        if (!fileMetadata[currentFile.id]) {
                            fileMetadata[currentFile.id] = existingMeta;
                            totalStats.skippedDocs++;
                            console.log(`✓ Skipping unchanged file: ${currentFile.name}`);
                        }
                    }
                }
            }
        }

        // Now process new or modified files
        for (const file of files) {
            try {
                // Skip if we already have up-to-date chunks for this file
                if (fileMetadata[file.id]) {
                    continue;
                }

                console.log(`Processing file: ${file.name} (${file.id})`);
                const text = await fetchGoogleDoc(file.id);

                if (!text) {
                    console.log(`Skipping empty file: ${file.name}`);
                    continue;
                }

                const textChunks = chunkDocument(text);
                const embeddings = await generateEmbeddings(textChunks);

                const fileChunks = textChunks.map((chunkText, i) => ({
                    text: chunkText,
                    embedding: embeddings[i],
                    source: file.name
                }));

                allChunks = [...allChunks, ...fileChunks];

                // Track this file's metadata
                fileMetadata[file.id] = {
                    name: file.name,
                    modifiedTime: file.modifiedTime,
                    chunkCount: fileChunks.length,
                    indexedAt: timestamp
                };

                totalStats.processedDocs++;
                totalStats.totalOriginalChars += text.length;
                totalStats.totalChunks += fileChunks.length;

                console.log(`✓ Indexed ${fileChunks.length} chunks from: ${file.name}`);
            } catch (err) {
                console.error(`Error processing file ${file.name}:`, err);
                // Continue with other files
            }
        }

        if (allChunks.length === 0) {
            return NextResponse.json(
                { error: 'No content found to index' },
                { status: 400 }
            );
        }

        // Save to Cloud Storage
        console.log(`Saving ${allChunks.length} chunks to Cloud Storage...`);
        await saveKnowledgeBase({
            chunks: allChunks,
            documentId: folderId,
            documentName: kbName,
            lastModified: new Date().toISOString(),
            indexedAt: new Date().toISOString(),
            fileMetadata: fileMetadata,
        });

        console.log('Indexing complete!');

        return NextResponse.json({
            success: true,
            message: 'Knowledge base indexed successfully',
            stats: {
                name: kbName,
                documentsFound: files.length,
                documentsProcessed: totalStats.processedDocs,
                documentsSkipped: totalStats.skippedDocs,
                totalChunks: allChunks.length,
                newChunks: totalStats.totalChunks,
                totalCharacters: totalStats.totalOriginalChars,
            },
        });

    } catch (error) {
        console.error('Error indexing knowledge base:', error);
        return NextResponse.json(
            { error: 'Failed to index knowledge base', details: String(error) },
            { status: 500 }
        );
    }
}
