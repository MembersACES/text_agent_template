export function getLogger(name: string) {
    return {
        info:  (msg: string, ...args: unknown[]) => console.log(`[${name}] INFO  ${msg}`, ...args),
        warn:  (msg: string, ...args: unknown[]) => console.warn(`[${name}] WARN  ${msg}`, ...args),
        error: (msg: string, ...args: unknown[]) => console.error(`[${name}] ERROR ${msg}`, ...args),
        debug: (msg: string, ...args: unknown[]) => console.debug(`[${name}] DEBUG ${msg}`, ...args),
    };
}
