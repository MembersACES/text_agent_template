import type {
    CrossCheckFindingRow,
    CrossCheckInvoiceRef,
    CrossCheckSkippedRow,
} from '@/lib/types/SavingsCrossCheckTypes';
import type { ExtractedInvoice } from '@/lib/types/ReportTypes';

export class SavingsCrossCheckRecorder {
    readonly findings: CrossCheckFindingRow[] = [];
    readonly skipped: CrossCheckSkippedRow[] = [];
    private counter = 0;

    invoiceRef(
        invoice: ExtractedInvoice,
        invoiceIndex: number,
        inferredState: 'NSW' | 'OTHER' | null,
        eligibleForRollUp: boolean,
    ): CrossCheckInvoiceRef {
        return {
            invoiceIndex,
            invoice_number: invoice.invoice_number ?? null,
            nmi: invoice.nmi ?? null,
            mrin: invoice.mrin ?? null,
            billing_days: invoice.billing_days ?? null,
            site_address: invoice.site_address ?? null,
            inferredState,
            eligibleForRollUp,
        };
    }

    recordSkipped(row: Omit<CrossCheckSkippedRow, 'invoiceRef'> & { invoiceRef: CrossCheckInvoiceRef }): void {
        this.skipped.push(row);
    }

    recordEmitted(
        row: Omit<CrossCheckFindingRow, 'findingId' | 'includedInTotal' | 'includedInCriticalIssues'> & {
            invoiceRef: CrossCheckInvoiceRef;
        },
    ): void {
        this.counter += 1;
        const severity = row.severity;
        this.findings.push({
            ...row,
            findingId: `F${this.counter}`,
            includedInTotal: row.invoiceRef.eligibleForRollUp,
            includedInCriticalIssues:
                row.invoiceRef.eligibleForRollUp && severity === 'high',
        });
    }
}
