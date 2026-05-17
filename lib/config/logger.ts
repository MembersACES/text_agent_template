import { chatMessageTrace } from '@/lib/config/chatMessageTrace';

export function getLogger(name: string) {
    const write = (level: string, consoleFn: (...args: unknown[]) => void, msg: string, ...args: unknown[]) => {
        // When tracing, stdout/stderr mirror captures terminal output — avoid duplicate lines in the file.
        if (chatMessageTrace.isCapturingTerminal()) {
            if (args.length > 0) {
                consoleFn(`[${name}] ${level}  ${msg}`, ...args);
            } else {
                consoleFn(`[${name}] ${level}  ${msg}`);
            }
            return;
        }

        consoleFn(`[${name}] ${level}  ${msg}`, ...args);
    };

    return {
        info: (msg: string, ...args: unknown[]) => write('INFO', console.log, msg, ...args),
        warn: (msg: string, ...args: unknown[]) => write('WARN', console.warn, msg, ...args),
        error: (msg: string, ...args: unknown[]) => write('ERROR', console.error, msg, ...args),
        debug: (msg: string, ...args: unknown[]) => write('DEBUG', console.debug, msg, ...args),
    };
}
