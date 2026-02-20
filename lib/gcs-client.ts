
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
const AGENTS_DIR = 'agents';
const SYSTEM_SETTINGS_FILENAME = 'system-settings.json';

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
        // Optional: per-agent knowledge base Drive folder
        kbFolderId?: string;
        // Optional: allow this agent to accept file uploads
        allowFileUploads?: boolean;
    };
}

export async function getPromptConfig(agentId?: string): Promise<PromptConfig> {
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
        
        // Determine file path based on agentId
        let filePath: string;
        if (agentId) {
            // Agent-specific config: agents/{agentId}/settings.json
            filePath = `${AGENTS_DIR}/${agentId}/settings.json`;
        } else {
            // Default/legacy config: settings.json
            filePath = SETTINGS_FILENAME;
        }

        let file = bucket.file(filePath);
        let [exists] = await file.exists();

        // If agent-specific file doesn't exist and we're looking for an agent, try default
        if (!exists && agentId) {
            file = bucket.file(SETTINGS_FILENAME);
            [exists] = await file.exists();
        }

        if (!exists) {
            // Fallback to prompt.json for migration (only for default)
            if (!agentId) {
                const oldFile = bucket.file('prompt.json');
                const [oldExists] = await oldFile.exists();
                if (oldExists) {
                    console.log('Found legacy prompt.json, migrating to settings.json');
                    file = oldFile;
                    exists = true;
                }
            }
        }

        if (!exists) {
            console.log(`Settings file not found for ${agentId || 'default'}, returning default.`);
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
export async function getPromptTemplate(agentId?: string): Promise<string> {
    const config = await getPromptConfig(agentId);
    return config.systemPrompt;
}

export async function savePromptConfig(data: PromptConfig, agentId?: string): Promise<void> {
    if (!BUCKET_NAME) {
        throw new Error('GCS_BUCKET_NAME not configured');
    }

    const bucket = storage.bucket(BUCKET_NAME);
    
    // Determine file path based on agentId
    const filePath = agentId 
        ? `${AGENTS_DIR}/${agentId}/settings.json`
        : SETTINGS_FILENAME;
    
    const file = bucket.file(filePath);

    await file.save(JSON.stringify(data, null, 2), {
        contentType: 'application/json',
        metadata: {
            cacheControl: 'no-cache',
        },
    });
}

// Wrapper for existing single-template save (migration helper if needed, or just update callers)
export async function savePromptTemplate(template: string, agentId?: string): Promise<void> {
    // We shouldn't drop other fields if we can help it, but for now this legacy call
    // implies we only care about the template. A better approach is to read-modify-write 
    // or just update all callers to use savePromptConfig. 
    // For safety, let's fetch first.
    const current = await getPromptConfig(agentId);
    await savePromptConfig({
        ...current,
        systemPrompt: template
    }, agentId);
}

// List all agents from GCS
export async function listAgents(): Promise<string[]> {
    if (!BUCKET_NAME) {
        return [];
    }

    try {
        const bucket = storage.bucket(BUCKET_NAME);
        const [files] = await bucket.getFiles({ prefix: `${AGENTS_DIR}/` });
        
        // Extract unique agent IDs from file paths
        const agentIds = new Set<string>();
        files.forEach(file => {
            const match = file.name.match(new RegExp(`^${AGENTS_DIR}/([^/]+)/`));
            if (match) {
                agentIds.add(match[1]);
            }
        });
        
        return Array.from(agentIds).sort();
    } catch (error) {
        console.error('Error listing agents:', error);
        return [];
    }
}

// System Settings (Global prompt that applies to all agents)
export interface SystemSettings {
    globalSystemPrompt: string;
}

// Default global system prompt - used as fallback when no saved settings exist in GCS
// Once a user saves settings via the UI, the saved version takes precedence
// This default ensures the system works even on first use before any settings are saved
const DEFAULT_GLOBAL_SYSTEM_PROMPT = `GLOBAL RULES FOR ALL AGENTS:

1. **Knowledge Base Awareness**: 
   - When context is provided (knowledge base files or uploaded files), you MUST use it to answer questions
   - If the user asks "what files do you have?" or "list files", reference the "KNOWLEDGE BASE FILES AVAILABLE" section in the context
   - If the user asks about specific documents/files mentioned in the context, search and reference that content
   - When answering questions, cite which file/document you're referencing (e.g., "According to BASE1_TEMPLATE_GUIDE...")
   - If context is provided but you ignore it and give generic responses, you are not following instructions

2. **Response Style**: 
   - Be concise and conversational for simple questions
   - Provide detailed, comprehensive answers when:
     * User asks about knowledge base files or documents
     * User asks for lists, data extraction, or analysis
     * User asks "what files do you have?" or "list all files"
     * Task requires comprehensive information
     * Agent is performing specialized work (e.g., invoice analysis, report generation)

3. **Acknowledgment Handling**: 
   - When user sends short acknowledgments like "ok", "go", "yes", "👍", respond with ONE brief sentence and suggest the next action
   - Do NOT restate your full instructions or configuration unless explicitly asked

4. **Uncertainty Handling**: 
   - If you don't know something or the data is incomplete, clearly state that
   - Never fabricate information
   - If asked about something not in your knowledge base, say so explicitly

5. **Professional Tone**: 
   - Be friendly, supportive, and professional
   - Avoid overly casual language

6. **Formatting**: 
   - Use plain text, natural language
   - Avoid excessive markdown unless formatting is needed

7. **Context Usage**: 
   - ALWAYS check the provided context before answering
   - Use knowledge base and uploaded files to inform your responses
   - Don't repeat the entire context back to the user unless asked
   - When listing files, use the exact file names from the "KNOWLEDGE BASE FILES AVAILABLE" section

Remember: If context is provided, USE IT. Generic "I'm ready to help" responses when context contains the answer are incorrect.`;

export async function getSystemSettings(): Promise<SystemSettings> {
    const defaultData: SystemSettings = {
        globalSystemPrompt: DEFAULT_GLOBAL_SYSTEM_PROMPT
    };

    if (!BUCKET_NAME) {
        console.warn('GCS_BUCKET_NAME not configured, using default system settings.');
        return defaultData;
    }

    try {
        const bucket = storage.bucket(BUCKET_NAME);
        const file = bucket.file(SYSTEM_SETTINGS_FILENAME);
        const [exists] = await file.exists();

        if (!exists) {
            console.log('System settings file not found, returning default.');
            return defaultData;
        }

        const [content] = await file.download();
        const rawData = JSON.parse(content.toString('utf-8'));

        return {
            globalSystemPrompt: rawData.globalSystemPrompt || DEFAULT_GLOBAL_SYSTEM_PROMPT
        };
    } catch (error) {
        console.error('Error fetching system settings from GCS:', error);
        return defaultData;
    }
}

export async function saveSystemSettings(data: SystemSettings): Promise<void> {
    if (!BUCKET_NAME) {
        throw new Error('GCS_BUCKET_NAME not configured');
    }

    const bucket = storage.bucket(BUCKET_NAME);
    const file = bucket.file(SYSTEM_SETTINGS_FILENAME);

    await file.save(JSON.stringify(data, null, 2), {
        contentType: 'application/json',
        metadata: {
            cacheControl: 'no-cache',
        },
    });
}
