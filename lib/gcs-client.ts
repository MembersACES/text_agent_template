
import { Storage } from '@google-cloud/storage';

const PROJECT_ID = process.env.GCP_PROJECT_ID;
const CLIENT_EMAIL = process.env.GCP_CLIENT_EMAIL;
const PRIVATE_KEY = process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, '\n');
const BUCKET_NAME = process.env.GCS_BUCKET_NAME;

const storage = new Storage({
    projectId: PROJECT_ID,
    credentials: {
        client_email: CLIENT_EMAIL,
        private_key: PRIVATE_KEY,
    },
});

const PROMPT_FILENAME = 'prompt.json';

// Default prompt fallback if GCS fails or file doesn't exist
const DEFAULT_PROMPT = `You are a friendly, conversational AI assistant helping users with step-by-step guidance.

Context from documentation:
{{context}}

User message: {{message}}

CRITICAL INSTRUCTIONS:
1. **Be concise and conversational** - Keep responses SHORT (2-4 sentences typically)
2. **Step-by-step approach** - If the context contains a procedure with multiple steps:
   - Only explain the FIRST step in detail
   - Give clear, actionable instructions for that step
   - End by asking if they've completed it before moving on
   - Wait for user confirmation before explaining the next step
3. **Formatting** - Use plain text, natural language. NO markdown symbols like ** or ##
4. **Tone** - Be friendly, supportive, and patient like a helpful colleague
5. **If not procedural** - Answer the question directly and briefly

Examples:
- Bad: "**Step 1:** Go to Settings. **Step 2:** Click on API Keys..."
- Good: "Let's start! First, go to Settings in your Google Cloud console. Once you're there, let me know and I'll guide you to the next step."

Remember: ONE step at a time. Keep it SHORT and FRIENDLY.

Response:`;

export async function getPromptTemplate(): Promise<string> {
    if (!BUCKET_NAME) {
        console.warn('GCS_BUCKET_NAME not configured, using default prompt.');
        return DEFAULT_PROMPT;
    }

    try {
        const bucket = storage.bucket(BUCKET_NAME);
        const file = bucket.file(PROMPT_FILENAME);
        const [exists] = await file.exists();

        if (!exists) {
            console.log('Prompt file not found in GCS, returning default.');
            return DEFAULT_PROMPT;
        }

        const [content] = await file.download();
        const data = JSON.parse(content.toString('utf-8'));
        return data.template || DEFAULT_PROMPT;
    } catch (error) {
        console.error('Error fetching prompt from GCS:', error);
        return DEFAULT_PROMPT;
    }
}

export async function savePromptTemplate(template: string): Promise<void> {
    if (!BUCKET_NAME) {
        throw new Error('GCS_BUCKET_NAME not configured');
    }

    const bucket = storage.bucket(BUCKET_NAME);
    const file = bucket.file(PROMPT_FILENAME);

    await file.save(JSON.stringify({ template }), {
        contentType: 'application/json',
        metadata: {
            cacheControl: 'no-cache',
        },
    });
}
