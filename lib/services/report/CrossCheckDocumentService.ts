import ExcelJS from 'exceljs';
import type { SavingsCrossCheck } from '@/lib/types/SavingsCrossCheckTypes';

export class CrossCheckDocumentService {
    async generateWorkbook(crossCheck: SavingsCrossCheck): Promise<Buffer> {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Base 1 Review';
        workbook.created = new Date();

        const summary = workbook.addWorksheet('Summary');
        summary.columns = [
            { header: 'Field', key: 'field', width: 36 },
            { header: 'Value', key: 'value', width: 48 },
        ];
        const { rollUp, reconciliation } = crossCheck;
        const summaryRows: Array<[string, string | number]> = [
            ['Run ID', crossCheck.runId],
            ['Generated', crossCheck.generatedAt],
            ['Config version', crossCheck.configVersion ?? 'hardcoded defaults'],
            ['Formulas verified at', crossCheck.formulasVerifiedAt],
            ['Total raw (100%)', rollUp.totalRaw],
            ['Conservative (80%)', rollUp.conservative],
            ['Expected (100%)', rollUp.moderate],
            ['Optimistic (= Expected)', rollUp.optimistic],
            ['Critical issues count', rollUp.criticalIssuesCount],
            ['Critical issues savings', rollUp.criticalIssuesSavings],
            ['Medium included in total', rollUp.mediumIncludedInTotal],
            ['Matches client sheet', reconciliation.matchesClientSheet ? 'Yes' : 'No'],
            ['Client sheet conservative', reconciliation.clientSheetConservative],
            ['Client sheet expected', reconciliation.clientSheetExpected],
        ];
        summaryRows.forEach(([field, value]) => summary.addRow({ field, value }));
        reconciliation.notes.forEach((note) => summary.addRow({ field: 'Note', value: note }));

        const findings = workbook.addWorksheet('Findings');
        findings.columns = [
            { header: 'Finding ID', key: 'findingId', width: 10 },
            { header: 'Type', key: 'type', width: 32 },
            { header: 'Utility', key: 'utility', width: 12 },
            { header: 'Invoice #', key: 'invoiceNumber', width: 14 },
            { header: 'NMI/MRIN', key: 'accountId', width: 14 },
            { header: 'Formula', key: 'formula', width: 40 },
            { header: 'Comparison', key: 'comparison', width: 24 },
            { header: 'Gap', key: 'gap', width: 12 },
            { header: 'Annual saving', key: 'annualSaving', width: 14 },
            { header: 'Severity', key: 'severity', width: 10 },
            { header: 'In total', key: 'inTotal', width: 8 },
            { header: 'In critical', key: 'inCritical', width: 10 },
            { header: 'Related charges', key: 'relatedCharges', width: 18 },
        ];
        crossCheck.findings.forEach((f) => {
            const comp = f.comparisonsUsed.map((c) => `${c.bucketKey}=${c.value} ${c.unit}`).join('; ');
            findings.addRow({
                findingId: f.findingId,
                type: f.type,
                utility: f.utility,
                invoiceNumber: f.invoiceRef.invoice_number ?? '',
                accountId: f.invoiceRef.nmi ?? f.invoiceRef.mrin ?? '',
                formula: f.formula,
                comparison: comp,
                gap: f.steps.gap ?? '',
                annualSaving: f.steps.annualSaving ?? '',
                severity: f.severity ?? '',
                inTotal: f.includedInTotal ? 'Y' : 'N',
                inCritical: f.includedInCriticalIssues ? 'Y' : 'N',
                relatedCharges: f.clientSheetRelatedCharges ?? '',
            });
        });

        const skipped = workbook.addWorksheet('Skipped');
        skipped.columns = [
            { header: 'Type', key: 'type', width: 32 },
            { header: 'Utility', key: 'utility', width: 12 },
            { header: 'Invoice #', key: 'invoiceNumber', width: 14 },
            { header: 'Reason', key: 'reason', width: 48 },
            { header: 'Computed annual', key: 'computed', width: 14 },
            { header: 'Formula', key: 'formula', width: 40 },
        ];
        crossCheck.skipped.forEach((s) => {
            skipped.addRow({
                type: s.type,
                utility: s.utility,
                invoiceNumber: s.invoiceRef.invoice_number ?? '',
                reason: s.reason,
                computed: s.computedAnnualSaving ?? '',
                formula: s.formula ?? '',
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(buffer);
    }
}

export const crossCheckDocumentService = new CrossCheckDocumentService();
