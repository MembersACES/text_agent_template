import { NextResponse } from 'next/server';
import { getPromptConfig } from '@/lib/gcs-client';
import { GoogleGenerativeAI } from '@google/generative-ai';

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

        let content: string;

        // Check if file is text-based or binary
        const isTextBased = mimeType.startsWith('text/') || 
                           mimeType === 'application/json' ||
                           mimeType === 'text/csv' ||
                           fileName.endsWith('.md') ||
                           fileName.endsWith('.txt') ||
                           fileName.endsWith('.csv') ||
                           fileName.endsWith('.json');

        if (isTextBased) {
            // Text-based files: read directly
            content = await file.text();
        } else {
            // Binary files (PDF, images, Word, Excel): use Gemini Vision to extract text
            const apiKey = process.env.GEMINI_API_KEY;
            if (!apiKey) {
                return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
            }

            try {
                const buffer = Buffer.from(await file.arrayBuffer());
                const base64Data = buffer.toString('base64');
                
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
                
                const result = await model.generateContent([
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Data,
                        },
                    },
                    {
                        text: `Extract ALL text from this document exactly as written. 
Include every number, date, address, account number, rate, charge, and total.
Preserve the structure (tables, sections, line items).
If this is an invoice, make sure to capture:
- Business name, supplier, account numbers
- All usage figures and rates
- All charges and totals
- Dates, billing periods, meter numbers
Return ONLY the extracted text, no commentary.`
                    },
                ]);
                
                const response = await result.response;
                content = response.text();
            } catch (visionError) {
                console.error('Error processing file with Gemini Vision:', visionError);
                return NextResponse.json({ 
                    error: 'Failed to extract text from file. Please ensure the file is a valid PDF or image.',
                    details: String(visionError)
                }, { status: 500 });
            }
        }

        if (!content || !content.trim()) {
            return NextResponse.json({ error: 'File is empty or could not be read' }, { status: 400 });
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


