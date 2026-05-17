/**
 * ChatMessageTrace
 *
 * Local-only per-message trace files: request, mirrored terminal output, response.
 * Enabled in development unless ENABLE_CHAT_TRACE_LOGS=false.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';

const TRACE_DIR = path.join(process.cwd(), '.local', 'chat-traces');
/** Brief wait so Next.js "POST /api/chat 200 in …" lines flush after the handler returns. */
const TERMINAL_TAIL_MS = 300;

interface TraceSection {
    title: string;
    body: string;
}

interface TraceContext {
    filePath: string;
    startedAt: string;
    sections: TraceSection[];
}

export interface ChatTraceResponse {
    response?: string;
    sources?: unknown;
    extractedData?: unknown;
    generateReport?: boolean;
    error?: string;
}

const storage = new AsyncLocalStorage<TraceContext>();

let interceptorsInstalled = false;

function isEnabled(): boolean {
    if (process.env.ENABLE_CHAT_TRACE_LOGS === 'true') return true;
    if (process.env.ENABLE_CHAT_TRACE_LOGS === 'false') return false;
    return process.env.NODE_ENV === 'development';
}

function slugify(text: string, maxLen = 48): string {
    const slug = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, maxLen);
    return slug || 'message';
}

function appendRaw(filePath: string, text: string): void {
    if (!text) return;
    fs.appendFileSync(filePath, text, 'utf8');
}

function appendLine(filePath: string, line: string): void {
    fs.appendFileSync(filePath, `${line}\n`, 'utf8');
}

function decodeWriteChunk(
    chunk: string | Uint8Array,
    encoding?: BufferEncoding,
): string {
    if (typeof chunk === 'string') return chunk;
    return Buffer.from(chunk).toString(encoding ?? 'utf8');
}

function installTerminalInterceptors(): void {
    if (interceptorsInstalled) return;
    interceptorsInstalled = true;

    const mirrorWrite = (
        original: typeof process.stdout.write,
    ): typeof process.stdout.write => {
        return function writeMirror(
            chunk: string | Uint8Array,
            encodingOrCallback?: BufferEncoding | ((err?: Error | null) => void),
            callback?: (err?: Error | null) => void,
        ): boolean {
            const ctx = storage.getStore();
            if (ctx) {
                const encoding =
                    typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
                appendRaw(ctx.filePath, decodeWriteChunk(chunk, encoding));
            }

            if (typeof encodingOrCallback === 'function') {
                return original(chunk, encodingOrCallback);
            }
            return original(chunk, encodingOrCallback, callback);
        };
    };

    process.stdout.write = mirrorWrite(process.stdout.write.bind(process.stdout));
    process.stderr.write = mirrorWrite(process.stderr.write.bind(process.stderr));
}

function createTraceFile(message: string): TraceContext {
    fs.mkdirSync(TRACE_DIR, { recursive: true });
    const startedAt = new Date();
    const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
    const slug = slugify(message);
    const filePath = path.join(TRACE_DIR, `${stamp}_${slug}.log`);
    fs.writeFileSync(filePath, '', 'utf8');
    return { filePath, startedAt: startedAt.toISOString(), sections: [] };
}

function flushSections(ctx: TraceContext): void {
    for (const section of ctx.sections) {
        appendLine(ctx.filePath, '');
        appendLine(ctx.filePath, `--- ${section.title} ---`);
        appendRaw(ctx.filePath, `${section.body}\n`);
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export const chatMessageTrace = {
    isEnabled,

    /** True while a trace is active — logger should only use console (stdout mirror captures it). */
    isCapturingTerminal(): boolean {
        return storage.getStore() !== undefined;
    },

    /** Queue a labelled block written after terminal output (e.g. full prompt). */
    appendSection(title: string, body: string): void {
        const ctx = storage.getStore();
        if (!ctx) return;
        ctx.sections.push({ title, body });
    },

    async run<T extends ChatTraceResponse>(
        request: {
            message: string;
            agentId?: string;
            useKnowledgeBase?: boolean;
            conversationHistory?: unknown[];
            uploadedFiles?: unknown[];
        },
        fn: () => Promise<T>,
    ): Promise<T> {
        if (!isEnabled()) {
            return fn();
        }

        installTerminalInterceptors();

        const ctx = createTraceFile(request.message);
        const header = [
            '================================================================================',
            'CHAT MESSAGE TRACE (local only)',
            '================================================================================',
            `startedAt: ${ctx.startedAt}`,
            `file: ${ctx.filePath}`,
            '',
            '--- REQUEST ---',
            `message: ${request.message}`,
            `agentId: ${request.agentId ?? '(none)'}`,
            `useKnowledgeBase: ${request.useKnowledgeBase ?? false}`,
            `uploadedFiles: ${request.uploadedFiles?.length ?? 0}`,
            '',
            'conversationHistory:',
            JSON.stringify(request.conversationHistory ?? [], null, 2),
            '',
            '--- TERMINAL OUTPUT (stdout/stderr mirror) ---',
            'Includes Next.js request lines and all [Service] logs exactly as in the dev terminal.',
            '',
        ].join('\n');

        fs.writeFileSync(ctx.filePath, `${header}\n`, 'utf8');

        const started = Date.now();
        try {
            const result = await storage.run(ctx, async () => fn());
            await sleep(TERMINAL_TAIL_MS);
            flushSections(ctx);
            this.writeResponse(ctx, result);
            return result;
        } catch (error) {
            await sleep(TERMINAL_TAIL_MS);
            flushSections(ctx);
            this.writeFailure(ctx, error);
            throw error;
        } finally {
            const elapsed = Date.now() - started;
            appendLine(ctx.filePath, '');
            appendLine(ctx.filePath, `--- trace closed (${elapsed}ms) ---`);
            appendLine(ctx.filePath, `traceFile: ${ctx.filePath}`);
        }
    },

    writeResponse(ctx: TraceContext, result: ChatTraceResponse): void {
        const lines = [
            '',
            '--- RESPONSE TO USER ---',
            `completedAt: ${new Date().toISOString()}`,
        ];

        if (result.error) {
            lines.push(`error: ${result.error}`);
        } else {
            lines.push('', 'assistantReply:', result.response ?? '(empty)');
            if (result.sources) {
                lines.push('', 'sources:', JSON.stringify(result.sources, null, 2));
            }
            if (result.extractedData) {
                lines.push('', 'extractedData:', JSON.stringify(result.extractedData, null, 2));
            }
            if (result.generateReport) {
                lines.push('', 'generateReport: true');
            }
        }

        fs.appendFileSync(ctx.filePath, `${lines.join('\n')}\n`, 'utf8');
    },

    writeFailure(ctx: TraceContext, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        appendLine(ctx.filePath, '');
        appendLine(ctx.filePath, '--- REQUEST FAILED ---');
        appendLine(ctx.filePath, `error: ${message}`);
        if (stack) appendLine(ctx.filePath, stack);
    },

    getTraceDir(): string {
        return TRACE_DIR;
    },
};
