import { FunctionDeclarationsTool } from '@google/generative-ai';

export interface ToolMetadata {
    /** Human-readable name shown in the UI (e.g. "Analyse Invoices"). */
    name: string;
    /** Short description shown as a tooltip in the UI. */
    description: string;
}

export interface ToolExecutionParams {
    functionCallName: string;
    args: Record<string, unknown>;
    uploadedFiles: any[];
    agentId?: string;
    useKnowledgeBase: boolean;
    userMessage?: string;
}

export interface ToolExecutionResult {
    /** Payload sent back to Gemini as the function response. */
    toolResponse: Record<string, unknown>;
    /** Optional structured data to include in ChatResponse. */
    extractedData?: any;
    /** Whether to trigger report generation in the frontend. */
    generateReport?: boolean;
    /**
     * If provided, overrides the function call args recorded in Turn 2 history.
     * Use this when the tool executed with different args than the model supplied
     * (e.g. using the user's actual message instead of a model-generated query).
     */
    actualArgs?: Record<string, unknown>;
}

export interface AgentTool {
    readonly metadata: ToolMetadata;
    readonly declaration: FunctionDeclarationsTool;
    canHandle(functionCallName: string): boolean;
    execute(params: ToolExecutionParams): Promise<ToolExecutionResult>;
}
