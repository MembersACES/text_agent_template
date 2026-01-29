import { NextResponse } from 'next/server';
import { fetchGoogleDoc, getDocumentMetadata } from '@/lib/document-fetcher';
import { chunkDocument } from '@/lib/document-chunker';
import { generateEmbeddings } from '@/lib/embeddings';
import { saveKnowledgeBase } from '@/lib/knowledge-base-storage';

export async function POST() {
    try {
        const documentId = process.env.GOOGLE_DOC_ID;

        if (!documentId) {
            return NextResponse.json(
                { error: 'GOOGLE_DOC_ID not configured' },
                { status: 500 }
            );
        }

        console.log('Starting document indexing...');

        // 1. Fetch document
        console.log('Fetching document from Google Drive...');
        const text = await fetchGoogleDoc(documentId);
        const metadata = await getDocumentMetadata(documentId);

        console.log(`Document fetched: "${metadata.name}" (${text.length} characters)`);

        // 2. Chunk document
        console.log('Chunking document...');
        const textChunks = chunkDocument(text);
        console.log(`Created ${textChunks.length} chunks`);

        // 3. Generate embeddings
        console.log('Generating embeddings...');
        const embeddings = await generateEmbeddings(textChunks);
        console.log('Embeddings generated');

        // 4. Combine chunks with embeddings
        const chunks = textChunks.map((text, i) => ({
            text,
            embedding: embeddings[i],
        }));

        // 5. Save to Cloud Storage
        console.log('Saving to Cloud Storage...');
        await saveKnowledgeBase({
            chunks,
            documentId,
            documentName: metadata.name,
            lastModified: metadata.modifiedTime,
            indexedAt: new Date().toISOString(),
        });

        console.log('Indexing complete!');

        return NextResponse.json({
            success: true,
            message: 'Document indexed successfully',
            stats: {
                documentName: metadata.name,
                chunksCount: chunks.length,
                totalCharacters: text.length,
            },
        });
    } catch (error) {
        console.error('Error indexing document:', error);
        return NextResponse.json(
            { error: 'Failed to index document', details: String(error) },
            { status: 500 }
        );
    }
}
