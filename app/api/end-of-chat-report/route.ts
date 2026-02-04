
import { NextResponse } from 'next/server';
import { google } from 'googleapis';

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
        const clientEmail = process.env.GCP_CLIENT_EMAIL;
        const privateKey = process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, '\n'); // Fix newlines in env var

        if (!sheetId || !clientEmail || !privateKey) {
            console.warn('Google Sheets configuration missing. Logging to console instead.');
            console.log('--- CHAT REPORT (MOCK) ---');
            console.log('Time:', currentTime);
            console.log('Variables:', dynamicVarsString);
            console.log('Messages:', formattedMessages);
            console.log('--------------------------');

            // Return success even if sheets config is missing, to not break the UI flow.
            // In production, you might want to return an error or alert the admin.
            return NextResponse.json({
                success: true,
                message: 'Chat report logged locally (Sheets credentials missing)'
            });
        }

        // 3. Initialize Google Sheets API
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: clientEmail,
                private_key: privateKey,
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

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
