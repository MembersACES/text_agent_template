import { Storage } from '@google-cloud/storage';
import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';

const logger = getLogger('GcsClient');

const SETTINGS_FILENAME = 'settings.json';
const AGENTS_DIR = 'agents';
const SYSTEM_SETTINGS_FILENAME = 'system-settings.json';

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
const DEFAULT_AGENT_NAME = 'Text Agent';

const DEFAULT_GLOBAL_SYSTEM_PROMPT = `GLOBAL RULES FOR ALL AGENTS:

1. **Knowledge Base Awareness**:
   - When context is provided (knowledge base files or uploaded files), you MUST use it to answer questions
   - If the user asks about specific documents/files mentioned in the context, search and reference that content
   - If context is provided but you ignore it and give generic responses, you are not following instructions
   - NEVER mention "the knowledge base", "knowledge base tool", or internal document names in your responses — answer directly and naturally as if the information is your own knowledge

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
   - When a tool returns successful content, use it to answer directly instead of saying information was not found

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

export interface PromptConfig {
    systemPrompt: string;
    welcomeMessage: string;
    agentName: string;
    config?: {
        model?: string;
        language?: string;
        kbFolderId?: string;
        description?: string;
        allowFileUploads?: boolean;
        zohoDesk?: {
            enabled: boolean;
            publicPortalIds?: string[];
        };
    };
}

export interface SystemSettings {
    globalSystemPrompt: string;
}

export class GcsClient {
    private readonly storage: Storage;
    private readonly bucketName: string;

    constructor() {
        this.bucketName = settings.gcs.bucketName;
        this.storage = new Storage({
            projectId: settings.gcs.projectId,
            credentials: {
                client_email: settings.gcs.clientEmail,
                private_key: settings.gcs.privateKey,
            },
        });
    }

    async getPromptConfig(agentId?: string): Promise<PromptConfig> {
        const defaultData: PromptConfig = {
            systemPrompt: DEFAULT_PROMPT,
            welcomeMessage: DEFAULT_WELCOME_MESSAGE,
            agentName: DEFAULT_AGENT_NAME,
            config: { model: 'Gemini 3.0 Flash', language: 'Multilingual' },
        };

        if (!this.bucketName) {
            logger.warn('GCS_BUCKET_NAME not configured, using default prompt.');
            return defaultData;
        }

        try {
            const bucket = this.storage.bucket(this.bucketName);

            let filePath = agentId
                ? `${AGENTS_DIR}/${agentId}/settings.json`
                : SETTINGS_FILENAME;

            let file = bucket.file(filePath);
            let [exists] = await file.exists();

            if (!exists && agentId) {
                file = bucket.file(SETTINGS_FILENAME);
                [exists] = await file.exists();
            }

            if (!exists && !agentId) {
                const oldFile = bucket.file('prompt.json');
                const [oldExists] = await oldFile.exists();
                if (oldExists) {
                    logger.info('Found legacy prompt.json, migrating to settings.json');
                    file = oldFile;
                    exists = true;
                }
            }

            if (!exists) {
                logger.info(`Settings file not found for ${agentId || 'default'}, returning default.`);
                return defaultData;
            }

            const [content] = await file.download();
            const rawData = JSON.parse(content.toString('utf-8'));

            return {
                systemPrompt: rawData.systemPrompt || rawData.template || DEFAULT_PROMPT,
                welcomeMessage: rawData.welcomeMessage || DEFAULT_WELCOME_MESSAGE,
                agentName: rawData.agentName || DEFAULT_AGENT_NAME,
                config: rawData.config || { model: 'Gemini 3.0 Flash', language: 'Multilingual' },
            };
        } catch (error) {
            logger.error(`Error fetching prompt from GCS: ${error}`);
            return defaultData;
        }
    }

    async getPromptTemplate(agentId?: string): Promise<string> {
        const config = await this.getPromptConfig(agentId);
        return config.systemPrompt;
    }

    async savePromptConfig(data: PromptConfig, agentId?: string): Promise<void> {
        if (!this.bucketName) throw new Error('GCS_BUCKET_NAME not configured');

        const filePath = agentId
            ? `${AGENTS_DIR}/${agentId}/settings.json`
            : SETTINGS_FILENAME;

        const file = this.storage.bucket(this.bucketName).file(filePath);
        await file.save(JSON.stringify(data, null, 2), {
            contentType: 'application/json',
            metadata: { cacheControl: 'no-cache' },
        });
    }

    async savePromptTemplate(template: string, agentId?: string): Promise<void> {
        const current = await this.getPromptConfig(agentId);
        await this.savePromptConfig({ ...current, systemPrompt: template }, agentId);
    }

    async listAgents(): Promise<string[]> {
        if (!this.bucketName) return [];

        try {
            const bucket = this.storage.bucket(this.bucketName);
            const [files] = await bucket.getFiles({ prefix: `${AGENTS_DIR}/` });

            const agentIds = new Set<string>();
            files.forEach(file => {
                const match = file.name.match(new RegExp(`^${AGENTS_DIR}/([^/]+)/`));
                if (match) agentIds.add(match[1]);
            });

            return Array.from(agentIds).sort();
        } catch (error) {
            logger.error(`Error listing agents: ${error}`);
            return [];
        }
    }

    async deleteAgent(agentId: string): Promise<{ deleted: string[] }> {
        if (!this.bucketName) throw new Error('GCS_BUCKET_NAME not configured');
        if (!agentId || agentId.trim() === '') throw new Error('agentId is required');

        const prefix = `${AGENTS_DIR}/${agentId}/`;
        const bucket = this.storage.bucket(this.bucketName);
        const [files] = await bucket.getFiles({ prefix });

        const deleted: string[] = [];

        for (const file of files) {
            if (!file.name.startsWith(prefix)) {
                logger.warn(`Skipping unexpected file outside prefix: ${file.name}`);
                continue;
            }
            await file.delete();
            deleted.push(file.name);
            logger.info(`Deleted: ${file.name}`);
        }

        logger.info(`Removed ${deleted.length} file(s) for agent "${agentId}"`);
        return { deleted };
    }

    async getSystemSettings(): Promise<SystemSettings> {
        const defaultData: SystemSettings = { globalSystemPrompt: DEFAULT_GLOBAL_SYSTEM_PROMPT };

        if (!this.bucketName) {
            logger.warn('GCS_BUCKET_NAME not configured, using default system settings.');
            return defaultData;
        }

        try {
            const bucket = this.storage.bucket(this.bucketName);
            const file = bucket.file(SYSTEM_SETTINGS_FILENAME);
            const [exists] = await file.exists();

            if (!exists) {
                logger.info('System settings file not found, returning default.');
                return defaultData;
            }

            const [content] = await file.download();
            const rawData = JSON.parse(content.toString('utf-8'));
            return { globalSystemPrompt: rawData.globalSystemPrompt || DEFAULT_GLOBAL_SYSTEM_PROMPT };
        } catch (error) {
            logger.error(`Error fetching system settings from GCS: ${error}`);
            return defaultData;
        }
    }

    async saveSystemSettings(data: SystemSettings): Promise<void> {
        if (!this.bucketName) throw new Error('GCS_BUCKET_NAME not configured');

        const file = this.storage.bucket(this.bucketName).file(SYSTEM_SETTINGS_FILENAME);
        await file.save(JSON.stringify(data, null, 2), {
            contentType: 'application/json',
            metadata: { cacheControl: 'no-cache' },
        });
    }
}

export const gcsClient = new GcsClient();
