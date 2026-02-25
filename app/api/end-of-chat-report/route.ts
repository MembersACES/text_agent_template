
import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { settings } from '@/lib/config/settings';
import { googleAuthService } from '@/lib/services/google/GoogleAuthService';

export async function POST(request: Request) {
    try {
        const { messages, dynamicVariables, agentName = 'Text Agent' } = await request.json();

        // 1. Prepare data
        const currentTime = new Date().toISOString();

        // Format messages: "User: Hello\n[Agent Name]: Hi there"
        const formattedMessages = messages.map((msg: any) => {
            const prefix = msg.role === 'user' ? 'User:' : `${agentName}:`;
            return `${prefix} ${msg.content}`;
        }).join('\n\n'); // Double newline for better readability in the cell

        const dynamicVarsString = JSON.stringify(dynamicVariables || []);

        // 2. Check credentials
        const sheetId = process.env.GOOGLE_SHEET_ID;
        const sheetTab = process.env.GOOGLE_SHEET_TAB_NAME || 'Sheet1';

        if (!sheetId || !settings.gcs.clientEmail || !settings.gcs.privateKey) {
            console.warn('Google Sheets configuration missing. Logging to console instead.');
            console.log('--- CHAT REPORT (MOCK) ---');
            console.log('Time:', currentTime);
            console.log('Variables:', dynamicVarsString);
            console.log('Messages:', formattedMessages);
            console.log('--------------------------');

            return NextResponse.json({
                success: true,
                message: 'Chat report logged locally (Sheets credentials missing)'
            });
        }

        // 3. Initialize Google Sheets API
        const auth = googleAuthService.getWriteAuth();

        const sheets = google.sheets({ version: 'v4', auth });

        // 4. Append to spreadsheet
        // Assumes "Sheet1" exists. Appends to columns A, B, C.
        await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: `${sheetTab}!A:C`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [
                    [currentTime, dynamicVarsString, formattedMessages]
                ],
            },
        });

        return NextResponse.json({ success: true, message: 'Chat report saved to Sheets' });
    } catch (error) {
        console.error('Error saving chat report:', error);
        return NextResponse.json(
            { error: 'Failed to save chat report', details: String(error) },
            { status: 500 }
        );
    }
}
