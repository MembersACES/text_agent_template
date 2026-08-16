import type { ExtractedInvoice } from '@/lib/types/ReportTypes';

export interface CrossCheckInvoiceRef {
    invoiceIndex: number;
    invoice_number: string | null;
    nmi: string | null;
    mrin: string | null;
    billing_days: number | null;
    site_address: string | null;
    inferredState: 'NSW' | 'OTHER' | null;
    eligibleForRollUp: boolean;
}

export interface CrossCheckComparisonUsed {
    bucketKey: string;
    value: number;
    unit: string;
}

export interface CrossCheckSteps {
    periodValue?: number | null;
    periodUnit?: string;
    annualizedValue?: number | null;
    annualUnit?: string;
    currentRate?: number | null;
    comparisonRate?: number | null;
    gap?: number | null;
    gapUnit?: string;
    periodSaving?: number | null;
    annualSaving: number | null;
    annualizationFormula?: string;
}

export interface CrossCheckFindingRow {
    findingId: string;
    type: string;
    utility: ExtractedInvoice['utility_type'];
    invoiceRef: CrossCheckInvoiceRef;
    inputs: Record<string, number | string | boolean | null>;
    comparisonsUsed: CrossCheckComparisonUsed[];
    formula: string;
    steps: CrossCheckSteps;
    minAnnualSavingsGate: number;
    passedMinSavingsGate: boolean;
    severity: 'high' | 'medium' | null;
    severityRule: string;
    includedInTotal: boolean;
    includedInCriticalIssues: boolean;
    clientSheetRelatedCharges?: string;
}

export interface CrossCheckSkippedRow {
    type: string;
    utility: ExtractedInvoice['utility_type'];
    invoiceRef: CrossCheckInvoiceRef;
    reason: string;
    inputs: Record<string, number | string | boolean | null>;
    formula?: string;
    computedAnnualSaving?: number | null;
}

export interface SavingsCrossCheckRollUp {
    totalRaw: number;
    conservative: number;
    moderate: number;
    optimistic: number;
    criticalIssuesCount: number;
    criticalIssuesSavings: number;
    mediumIncludedInTotal: number;
}

export interface SavingsCrossCheckReconciliation {
    matchesClientSheet: boolean;
    clientSheetConservative: number;
    clientSheetExpected: number;
    notes: string[];
}

export interface SavingsCrossCheck {
    runId: string;
    generatedAt: string;
    configVersion: number | null;
    configGeneration?: string;
    formulasVerifiedAt: string;
    findings: CrossCheckFindingRow[];
    skipped: CrossCheckSkippedRow[];
    rollUp: SavingsCrossCheckRollUp;
    reconciliation: SavingsCrossCheckReconciliation;
}
