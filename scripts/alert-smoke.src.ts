/**
 * alert-smoke — live smoke test for the internal CS/WH alert path.
 *
 * Drives the REAL `InternalAlertService` through the REAL `createAlertTransport`
 * (no stubs): with `ALERTS_TRANSPORT=webhook` it POSTs to the live n8n webhook,
 * so this exercises the end-to-end alert → n8n → email flow. All `ALERTS_*` come
 * from the environment (via `settings.alerts`); the shared secret is read from
 * `ALERTS_WEBHOOK_SECRET` and is NEVER hardcoded or printed.
 *
 * Cases (derived — confirmed with Morgan; the alert service has 3 triggers and
 * the result shapes sent/deduped/rateLimited/disabled/error):
 *   L1  not_found      → CS, live send            expect sent=true,  team=CS
 *   L2  queued_chasing → WH, live send            expect sent=true,  team=WH
 *   L3  wont_wait      → CS, live send            expect sent=true,  team=CS
 *   L4  null name      → subject "(Unknown)"      expect sent=true + subject
 *   L5  dedup by order+email (send twice)         expect [sent, deduped]
 *   L6  dedup by conversationId (diff orders)     expect [sent, deduped]
 *   L7  rate-limit (maxPerHour forced to 1)       expect [sent, rateLimited]
 *   L8  disabled (enabled forced off)             expect disabled=true, no send
 *
 * Each case uses DISTINCT order/email/conversationId so dedup never cross-fires;
 * L5/L6 intentionally reuse within the case. Every case builds its own service,
 * so the in-memory dedup/rate-limit state is isolated per case.
 *
 * LIVE side-effects: L1–L4 send one email each; L5/L6/L7 send ONE email (the
 * first send) before asserting the control branch. Use `--case Lx` to fire one
 * at a time. `--dry` swaps in the no-send LogAlertTransport (zero emails).
 *
 * Run (one case):   node --env-file=.env.local scripts/alert-smoke.mjs --case L1
 * Run (all, dry):   node --env-file=.env.local scripts/alert-smoke.mjs --dry
 */

import { InternalAlertService } from '@/lib/services/alerts/InternalAlertService';
import { LogAlertTransport } from '@/lib/services/alerts/transports';
import { settings } from '@/lib/config/settings';
import type { AlertSendResult, AlertTrigger, InternalAlert } from '@/lib/services/alerts/types';

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const caseFlagIdx = argv.indexOf('--case');
// A present-but-empty/flag-like --case must NOT silently fall through to "run all"
// (that would fire every live email). Require a real value after --case.
let ONLY = '';
let caseArgError = '';
if (caseFlagIdx >= 0) {
    const val = argv[caseFlagIdx + 1];
    if (!val || val.startsWith('--')) {
        caseArgError = 'Flag --case requires a case id, e.g. --case L1 (refusing to run all cases).';
    } else {
        ONLY = val.toUpperCase();
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────
/** Build a service. In --dry, inject the no-send Log transport; otherwise use the
 *  real transport selected by settings (webhook when ALERTS_TRANSPORT=webhook).
 *  `overrides` only forces control-branch knobs (L7 maxPerHour, L8 enabled). */
function svc(overrides: { enabled?: boolean; maxPerHour?: number } = {}): InternalAlertService {
    return new InternalAlertService({
        ...overrides,
        ...(DRY ? { transport: new LogAlertTransport() } : {}),
    });
}

function alert(
    trigger: AlertTrigger,
    f: { customerName: string | null; orderNumber: string; customerEmail: string; conversationId?: string },
): InternalAlert {
    return {
        trigger,
        customerName: f.customerName,
        customerEmail: f.customerEmail,
        orderNumber: f.orderNumber,
        reason: `alert-smoke ${trigger}`,
        conversationId: f.conversationId,
    };
}

interface CaseResult {
    results: AlertSendResult[];
    pass: boolean;
    expect: string;
    extra?: string;
}
type SmokeCase = { id: string; title: string; run: () => Promise<CaseResult> };

// ── cases ────────────────────────────────────────────────────────────────────
const CASES: SmokeCase[] = [
    {
        id: 'L1', title: 'not_found → CS (live send)',
        run: async () => {
            const r = await svc().send(alert('not_found', { customerName: 'Smoke L1', orderNumber: '90000001', customerEmail: 'smoke.l1@example.com', conversationId: 'smoke-L1' }));
            return { results: [r], expect: 'sent=true, team=CS', pass: r.sent === true && r.team === 'CS' };
        },
    },
    {
        id: 'L2', title: 'queued_chasing → WH (live send)',
        run: async () => {
            const r = await svc().send(alert('queued_chasing', { customerName: 'Smoke L2', orderNumber: '90000002', customerEmail: 'smoke.l2@example.com', conversationId: 'smoke-L2' }));
            return { results: [r], expect: 'sent=true, team=WH', pass: r.sent === true && r.team === 'WH' };
        },
    },
    {
        id: 'L3', title: 'wont_wait → CS (live send)',
        run: async () => {
            const r = await svc().send(alert('wont_wait', { customerName: 'Smoke L3', orderNumber: '90000003', customerEmail: 'smoke.l3@example.com', conversationId: 'smoke-L3' }));
            return { results: [r], expect: 'sent=true, team=CS', pass: r.sent === true && r.team === 'CS' };
        },
    },
    {
        id: 'L4', title: 'null customer name → subject "(Unknown)" (live send)',
        run: async () => {
            const s = svc();
            const a = alert('not_found', { customerName: null, orderNumber: '90000004', customerEmail: 'smoke.l4@example.com', conversationId: 'smoke-L4' });
            const subject = s.buildSubject(a);
            const r = await s.send(a);
            const unknown = subject.includes('_(Unknown)');
            return { results: [r], expect: 'sent=true, subject ends _(Unknown)', pass: r.sent === true && unknown, extra: `subject="${subject}"` };
        },
    },
    {
        id: 'L5', title: 'dedup by order+email (send twice)',
        run: async () => {
            const s = svc();
            const a = alert('not_found', { customerName: 'Smoke L5', orderNumber: '90000005', customerEmail: 'smoke.l5@example.com' }); // no conversationId → key = order|email
            const r1 = await s.send(a);
            const r2 = await s.send(a);
            return { results: [r1, r2], expect: '[sent, deduped]', pass: r1.sent === true && r2.deduped === true };
        },
    },
    {
        id: 'L6', title: 'dedup by conversationId (different orders)',
        run: async () => {
            const s = svc();
            const r1 = await s.send(alert('not_found', { customerName: 'Smoke L6', orderNumber: '90000061', customerEmail: 'smoke.l6a@example.com', conversationId: 'smoke-L6' }));
            const r2 = await s.send(alert('not_found', { customerName: 'Smoke L6', orderNumber: '90000062', customerEmail: 'smoke.l6b@example.com', conversationId: 'smoke-L6' }));
            return { results: [r1, r2], expect: '[sent, deduped]', pass: r1.sent === true && r2.deduped === true };
        },
    },
    {
        id: 'L7', title: 'rate-limit (maxPerHour forced to 1)',
        run: async () => {
            const s = svc({ maxPerHour: 1 });
            const r1 = await s.send(alert('not_found', { customerName: 'Smoke L7', orderNumber: '90000071', customerEmail: 'smoke.l7a@example.com', conversationId: 'smoke-L7a' }));
            const r2 = await s.send(alert('not_found', { customerName: 'Smoke L7', orderNumber: '90000072', customerEmail: 'smoke.l7b@example.com', conversationId: 'smoke-L7b' }));
            return { results: [r1, r2], expect: '[sent, rateLimited]', pass: r1.sent === true && r2.rateLimited === true };
        },
    },
    {
        id: 'L8', title: 'disabled (ALERTS_ENABLED forced off) → no send',
        run: async () => {
            const r = await svc({ enabled: false }).send(alert('not_found', { customerName: 'Smoke L8', orderNumber: '90000008', customerEmail: 'smoke.l8@example.com', conversationId: 'smoke-L8' }));
            return { results: [r], expect: 'disabled=true, sent=false', pass: r.disabled === true && r.sent === false };
        },
    },
];

// ── run ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
    const a = settings.alerts;
    const transportName = DRY ? 'log (--dry)' : a.transport;
    console.log('── alert-smoke ─────────────────────────────────────────────');
    console.log(`mode:       ${DRY ? 'DRY (no emails)' : 'LIVE'}`);
    console.log(`transport:  ${transportName}`);
    console.log(`enabled:    ${a.enabled}${a.enabled ? '' : '   ⚠️ ALERTS_ENABLED is off — live send cases will report disabled=true'}`);
    console.log(`to:         ${a.toAddress}`);
    console.log(`webhook:    ${a.webhook.url}`);
    console.log(`secret set: ${a.webhook.secret ? 'yes' : 'NO  ⚠️ webhook fails closed without ALERTS_WEBHOOK_SECRET'}`);
    if (ONLY) console.log(`case:       ${ONLY}`);
    console.log('────────────────────────────────────────────────────────────');

    if (caseArgError) {
        console.error(caseArgError);
        process.exitCode = 2;
        return;
    }

    const selected = ONLY ? CASES.filter((c) => c.id === ONLY) : CASES;
    if (ONLY && selected.length === 0) {
        console.error(`Unknown --case "${ONLY}". Valid: ${CASES.map((c) => c.id).join(', ')}`);
        process.exitCode = 2;
        return;
    }

    let failures = 0;
    for (const c of selected) {
        let res: CaseResult;
        try {
            res = await c.run();
        } catch (err) {
            failures++;
            console.log(`\n[${c.id}] ${c.title}`);
            console.log(`  THREW: ${err instanceof Error ? err.message : String(err)}`);
            console.log(`  [FAIL] expected ${'(no throw)'} `);
            continue;
        }
        const tag = res.pass ? 'PASS' : 'FAIL';
        if (!res.pass) failures++;
        console.log(`\n[${c.id}] ${c.title}`);
        res.results.forEach((r, i) => console.log(`  result[${i}]: ${JSON.stringify(r)}`));
        if (res.extra) console.log(`  ${res.extra}`);
        console.log(`  [${tag}] expected: ${res.expect}`);
    }

    console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}  (${selected.length} case(s) run${DRY ? ', dry' : ', LIVE'})`);
    process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
    console.error('alert-smoke crashed:', e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
});
