import { FORMULAS_VERIFIED_AT } from '@/lib/config/base1ComparisonBuckets';
import type { Base1ComparisonBuckets } from '@/lib/config/base1ComparisonBuckets';
import type { SavingsCrossCheck } from '@/lib/types/SavingsCrossCheckTypes';
import {
    calculateSavingsSummary,
    type ExtractedInvoice,
} from '@/lib/types/ReportTypes';
import type { SavingsCrossCheckRecorder } from '@/lib/services/report/SavingsCrossCheckRecorder';

export function buildSavingsCrossCheck(params: {
    runId: string;
    generatedAt: string;
    invoices: ExtractedInvoice[];
    recorder: SavingsCrossCheckRecorder;
    buckets: Base1ComparisonBuckets | null;
    configGeneration?: string;
}): SavingsCrossCheck {
    const { runId, generatedAt, invoices, recorder, buckets, configGeneration } = params;

    const savingsSummary = calculateSavingsSummary(invoices);

    const emittedInRollUp = recorder.findings.filter((f) => f.includedInTotal);
    const totalRawFromFindings = emittedInRollUp.reduce(
        (s, f) => s + (f.steps.annualSaving ?? 0),
        0,
    );

    const mediumIncludedInTotal = emittedInRollUp
        .filter((f) => f.severity === 'medium')
        .reduce((s, f) => s + (f.steps.annualSaving ?? 0), 0);

    const criticalFromFindings = recorder.findings.filter((f) => f.includedInCriticalIssues);
    const criticalSavings = criticalFromFindings.reduce(
        (s, f) => s + (f.steps.annualSaving ?? 0),
        0,
    );

    const notes: string[] = [
        'Demand findings at medium severity count toward total/Expected band but not criticalIssues (high-only).',
        'optimistic equals moderate (100% scenario) — optimistic band is deprecated.',
        'Eligible invoice filter may exclude duplicate NMIs (latest invoice only).',
        'Member report summary may hide waste via hideWasteForMemberReport.',
    ];

    const conservative = savingsSummary.conservative;
    const moderate = savingsSummary.moderate;

    return {
        runId,
        generatedAt,
        configVersion: buckets?.version ?? null,
        configGeneration,
        formulasVerifiedAt: FORMULAS_VERIFIED_AT,
        findings: recorder.findings,
        skipped: recorder.skipped,
        rollUp: {
            totalRaw: savingsSummary.moderate,
            conservative,
            moderate,
            optimistic: savingsSummary.optimistic,
            criticalIssuesCount: savingsSummary.criticalIssues.length,
            criticalIssuesSavings: savingsSummary.criticalIssues.reduce((s, c) => s + c.savings, 0),
            mediumIncludedInTotal,
        },
        reconciliation: {
            matchesClientSheet:
                Math.abs(totalRawFromFindings - moderate) < 0.02 ||
                Math.abs(savingsSummary.moderate - moderate) < 0.02,
            clientSheetConservative: conservative,
            clientSheetExpected: moderate,
            notes,
        },
    };
}
