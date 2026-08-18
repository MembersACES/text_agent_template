/**
 * PII redaction for TRACE / LOG surfaces (defence-in-depth).
 *
 * Order tracking asks the customer for their email + order number in free text.
 * That raw message flows into LangSmith `traceable` inputs, the local chat trace,
 * and prompt-preview logs — all of which can egress or persist. This module
 * scrubs email addresses and order-number tokens from anything about to be
 * captured for a trace/log, WITHOUT touching the values the app logic actually
 * uses (the redactor is applied only at the capture boundary — e.g. LangSmith
 * `processInputs` — so the model/gate still receive the real text).
 *
 * Applied regardless of any env flag: it is always safe to redact a trace, and
 * the whole point is not to depend on `LANGCHAIN_TRACING_V2` being off in prod.
 *
 * Over-redaction is acceptable here (a 6–8 digit number in KB content becomes
 * `[order#]` in the trace) — trace fidelity is worth less than never leaking PII.
 */

// Email first — removing it prevents its local-part digits being re-scanned as
// an order number, mirroring OrderStatusGate's extract order.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Order tokens: 6+ digit runs, optionally BC-/SO-prefixed. Deliberately wider
// than the gate's strict 6/8 (`\d{6,}` not `\d{6,8}`) so a longer digit run in a
// trace — a mistyped order, an ID — is still scrubbed rather than leaked.
const ORDER_RE = /\b(?:BC-?|SO)?\d{6,}\b/gi;

// Strings longer than this in a TRACE input are elided rather than regex-scanned:
// base64 upload blobs (up to ~13M chars for a 10 MB file) would otherwise bloat
// the trace payload and burn CPU. Normal messages/prompts fall under this.
const MAX_TRACE_STR = 20_000;

export const REDACTED_EMAIL = '[redacted-email]';
export const REDACTED_ORDER = '[redacted-order]';

/** Scrub email addresses and order-number tokens from a string. */
export function redactPII(text: string): string {
    if (!text) return text;
    return text.replace(EMAIL_RE, REDACTED_EMAIL).replace(ORDER_RE, REDACTED_ORDER);
}

/**
 * Deep-redact an arbitrary value. Shape-agnostic on purpose: LangSmith may hand
 * us the raw args object, an `{ args: [...] }` wrapper, or a Content[] array, and
 * we scrub every string in whatever shape arrives.
 *
 * Safety rails, because trace inputs can carry SDK objects (the Gemini model
 * client) alongside plain data:
 *   - only recurses into PLAIN objects/arrays; class instances → '[object]'
 *     (avoids walking/serialising a huge SDK client),
 *   - depth-capped, and
 *   - circular-safe via a seen-set.
 */
export function redactDeep(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
    if (value == null) return value;
    if (typeof value === 'string') {
        // Elide oversized strings (base64 upload blobs) instead of scanning/shipping them.
        if (value.length > MAX_TRACE_STR) return `[elided ${value.length} chars]`;
        return redactPII(value);
    }
    if (typeof value !== 'object') return value; // number | boolean | bigint | symbol
    if (depth > 8) return '[depth-capped]';
    if (seen.has(value as object)) return '[circular]';
    seen.add(value as object);

    if (Array.isArray(value)) {
        return value.map((v) => redactDeep(v, depth + 1, seen));
    }

    // Only walk plain data objects. A class instance (e.g. the Gemini client) is
    // replaced wholesale rather than deep-serialised.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return '[object]';

    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
        out[key] = redactDeep((value as Record<string, unknown>)[key], depth + 1, seen);
    }
    return out;
}

/**
 * LangSmith `traceable` `processInputs` adapter. Signature matches
 * `(inputs) => KVMap` (KVMap = Record<string, any>) so it type-checks as a
 * processInputs on any of our traceables. Redacts every string in the logged
 * inputs; the wrapped function still receives the real, un-redacted arguments.
 * (processInputs is NOT inherited by nested traceables — applied to each.)
 */
export function redactTraceInputs(inputs: Readonly<Record<string, unknown>>): Record<string, unknown> {
    return redactDeep(inputs) as Record<string, unknown>;
}
