
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

const SETTINGS_FILENAME = 'settings.json';

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

const DEFAULT_WELCOME_MESSAGE = "Hello!\n\nI'm your AI assistant. How can I help you today?";
const DEFAULT_AGENT_NAME = "Text Agent";

export interface PromptConfig {
    systemPrompt: string;
    welcomeMessage: string;
    agentName: string;
    config?: {
        model?: string;
        language?: string;
    };
}

export async function getPromptConfig(): Promise<PromptConfig> {
    const defaultData: PromptConfig = {
        systemPrompt: DEFAULT_PROMPT,
        welcomeMessage: DEFAULT_WELCOME_MESSAGE,
        agentName: DEFAULT_AGENT_NAME,
        config: { model: 'Gemini 3.0 Flash', language: 'Multilingual' }
    };

    if (!BUCKET_NAME) {
        console.warn('GCS_BUCKET_NAME not configured, using default prompt.');
        return defaultData;
    }

    try {
        const bucket = storage.bucket(BUCKET_NAME);

        // Try settings.json first
        let file = bucket.file(SETTINGS_FILENAME);
        let [exists] = await file.exists();

        if (!exists) {
            // Fallback to prompt.json for migration
            const oldFile = bucket.file('prompt.json');
            const [oldExists] = await oldFile.exists();
            if (oldExists) {
                console.log('Found legacy prompt.json, migrating to settings.json');
                file = oldFile;
                exists = true;
            }
        }

        if (!exists) {
            console.log('Settings file not found in GCS, returning default.');
            return defaultData;
        }

        const [content] = await file.download();
        const rawData = JSON.parse(content.toString('utf-8'));

        // Handle backward compatibility or new structure
        return {
            systemPrompt: rawData.systemPrompt || rawData.template || DEFAULT_PROMPT,
            welcomeMessage: rawData.welcomeMessage || DEFAULT_WELCOME_MESSAGE,
            agentName: rawData.agentName || DEFAULT_AGENT_NAME,
            config: rawData.config || { model: 'Gemini 3.0 Flash', language: 'Multilingual' }
        };

    } catch (error) {
        console.error('Error fetching prompt from GCS:', error);
        return defaultData;
    }
}

// Keeping original export for backward compatibility relative to imports (will deprecate/refactor usage)
export async function getPromptTemplate(): Promise<string> {
    const config = await getPromptConfig();
    return config.systemPrompt;
}

export async function savePromptConfig(data: PromptConfig): Promise<void> {
    if (!BUCKET_NAME) {
        throw new Error('GCS_BUCKET_NAME not configured');
    }

    const bucket = storage.bucket(BUCKET_NAME);
    const file = bucket.file(SETTINGS_FILENAME);

    await file.save(JSON.stringify(data), {
        contentType: 'application/json',
        metadata: {
            cacheControl: 'no-cache',
        },
    });
}

// Wrapper for existing single-template save (migration helper if needed, or just update callers)
export async function savePromptTemplate(template: string): Promise<void> {
    // We shouldn't drop other fields if we can help it, but for now this legacy call
    // implies we only care about the template. A better approach is to read-modify-write 
    // or just update all callers to use savePromptConfig. 
    // For safety, let's fetch first.
    const current = await getPromptConfig();
    await savePromptConfig({
        ...current,
        systemPrompt: template
    });
}
