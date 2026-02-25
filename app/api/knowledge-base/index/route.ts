import { NextResponse } from 'next/server';
import { fetchGoogleDoc, fetchGoogleSheet, listFilesInFolder, getFolderMetadata } from '@/lib/document-fetcher';
import { chunkDocument } from '@/lib/document-chunker';
import { generateEmbeddings } from '@/lib/embeddings';
import { saveKnowledgeBase, loadKnowledgeBase } from '@/lib/knowledge-base-storage';
import { getPromptConfig } from '@/lib/gcs-client';
import { cleanupOldReports } from '@/lib/report-cleanup';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const agentId = searchParams.get('agentId') || undefined;

        const promptConfig = await getPromptConfig(agentId);
        const rawFolderId = promptConfig.config?.kbFolderId;

        // Three-way resolution:
        //  - kbFolderId === ''  → new agent, explicitly no folder yet → return empty
        //  - kbFolderId === undefined → existing agent with no per-agent setting → fall back to env
        //  - kbFolderId is a real value → use it
        const folderId = rawFolderId === ''
            ? undefined
            : (rawFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID);

        if (!folderId) {
            return NextResponse.json({ indexed: [], pending: [], removed: [] });
        }

        // Fetch current files from Drive
        const driveFiles = await listFilesInFolder(folderId);

        // Load indexed metadata from storage (agent-specific or default)
        const kbData = await loadKnowledgeBase(agentId);
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

        // Note: Report cleanup runs on POST requests (when indexing), not on GET to avoid slowing down reads

        return NextResponse.json({
            indexed,
            pending,
            removed,
            stats: {
                totalDriveFiles: driveFiles.length,
                totalIndexedFiles: Object.keys(indexedMeta).length
            },
        });

    } catch (error) {
        console.error('Error fetching knowledge base files:', error);
        return NextResponse.json({ error: 'Failed to fetch knowledge base files' }, { status: 500 });
    }
}


export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const agentId = body.agentId || undefined;
        const explicitFolderId = typeof body.kbFolderId === 'string' && body.kbFolderId.trim() !== ''
            ? body.kbFolderId.trim()
            : undefined;

        const promptConfig = await getPromptConfig(agentId);
        const rawFolderId = promptConfig.config?.kbFolderId;

        // Three-way resolution (same logic as GET):
        //  - kbFolderId === ''  → new agent, explicitly no folder yet
        //  - kbFolderId === undefined → existing agent, fall back to env
        //  - kbFolderId is a real value → use it
        const configFolderId = rawFolderId === ''
            ? undefined
            : (rawFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID);
        const folderId = explicitFolderId || configFolderId;

        if (!folderId) {
            return NextResponse.json(
                {
                    error: rawFolderId === ''
                        ? 'No knowledge base folder configured for this agent. Set a Google Drive folder ID in the agent settings first.'
                        : 'GOOGLE_DRIVE_FOLDER_ID not configured'
                },
                { status: 400 }
            );
        }

        console.log(`Starting knowledge base indexing for agent: ${agentId || 'default'}...`);

        // Load existing knowledge base to check for changes (agent-specific or default)
        let existingKB = await loadKnowledgeBase(agentId);

        // If the stored KB was built from a different folder, ignore it and start fresh
        if (existingKB && existingKB.documentId !== folderId) {
            console.log(
                `Existing KB documentId (${existingKB.documentId}) does not match current folder (${folderId}). Resetting KB metadata for agent ${agentId || 'default'
                }.`
            );
            existingKB = null;
        }

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

                console.log(`Processing file: ${file.name} (${file.id}) [${file.mimeType}]`);

                let text = '';
                if (file.mimeType === 'application/vnd.google-apps.document') {
                    text = await fetchGoogleDoc(file.id);
                } else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
                    text = await fetchGoogleSheet(file.id);
                } else {
                    // Unsupported type; skip
                    console.log(`Skipping unsupported file type: ${file.name} (${file.mimeType})`);
                    continue;
                }

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

        // Save to Cloud Storage (agent-specific or default)
        console.log(`Saving ${allChunks.length} chunks to Cloud Storage...`);
        await saveKnowledgeBase({
            chunks: allChunks,
            documentId: folderId,
            documentName: kbName,
            lastModified: new Date().toISOString(),
            indexedAt: new Date().toISOString(),
            fileMetadata: fileMetadata,
        }, agentId);

        console.log('Indexing complete!');

        // Clean up old reports in background (non-blocking - don't await to avoid slowing down response)
        cleanupOldReports()
            .then((cleanupStats) => {
                if (cleanupStats && cleanupStats.deleted > 0) {
                    console.log(`[KB Index] Background cleanup: Deleted ${cleanupStats.deleted} old report(s)`);
                }
            })
            .catch((cleanupError) => {
                console.warn('[KB Index] Background report cleanup failed (non-critical):', cleanupError);
            });

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
