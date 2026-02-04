import { NextResponse } from 'next/server';
import { getPromptConfig } from '@/lib/gcs-client';

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const file = formData.get('file');
        const agentId = (formData.get('agentId') as string) || undefined;

        if (!(file instanceof File)) {
            return NextResponse.json({ error: 'File is required' }, { status: 400 });
        }

        // Check agent configuration for upload permission
        const config = await getPromptConfig(agentId);
        const allowUploads = config.config?.allowFileUploads === true;

        if (!allowUploads) {
            return NextResponse.json({ error: 'File uploads are disabled for this agent' }, { status: 403 });
        }

        const fileName = file.name || 'uploaded-file';
        const mimeType = file.type || 'application/octet-stream';

        // For now we treat everything as text-like content for the model,
        // but allow a broad set of file types commonly used for invoices.
        const allowed =
            mimeType.startsWith('text/') ||
            mimeType.startsWith('image/') ||
            mimeType === 'application/json' ||
            mimeType === 'application/pdf' ||
            mimeType === 'application/msword' ||
            mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            mimeType === 'application/vnd.ms-excel' ||
            mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

        if (!allowed) {
            return NextResponse.json({ error: `Unsupported file type: ${mimeType}` }, { status: 400 });
        }

        // Browser will try to decode as text; for binary formats this may not be perfect,
        // but it still gives the model some content to work with.
        const content = await file.text();
        if (!content.trim()) {
            return NextResponse.json({ error: 'File is empty or could not be read as text' }, { status: 400 });
        }

        return NextResponse.json({
            success: true,
            message: 'File uploaded successfully',
            fileName,
            content,
            mimeType,
        });
    } catch (error) {
        console.error('Error handling file upload:', error);
        return NextResponse.json({ error: 'Failed to process uploaded file' }, { status: 500 });
    }
}


