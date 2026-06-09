import { randomUUID } from 'crypto';
import type { Base1ComparisonBuckets } from '@/lib/config/base1ComparisonBuckets';
import { DEFAULT_BASE1_COMPARISON_BUCKETS } from '@/lib/config/base1ComparisonBuckets';
import { buildSavingsCrossCheck } from '@/lib/services/report/buildSavingsCrossCheck';
import { crossCheckDocumentService } from '@/lib/services/report/CrossCheckDocumentService';
import {
    createDeterministicSavingsService,
    type DeterministicPipelineResult,
} from '@/lib/services/report/DeterministicSavingsService';
import type { SavingsCrossCheck } from '@/lib/types/SavingsCrossCheckTypes';
import type { ExtractedInvoice } from '@/lib/types/ReportTypes';
import { normalizeExtractedInvoices } from '@/lib/utils/normalizeExtractedInvoices';

export interface DeterministicPipelineOutput extends DeterministicPipelineResult {
    crossCheck: SavingsCrossCheck;
    crossCheckXlsx: Buffer;
    runId: string;
}

export function runDeterministicSavingsPipeline(
    rawInvoices: unknown[],
    options?: {
        buckets?: Base1ComparisonBuckets;
        configGeneration?: string;
        runId?: string;
        generatedAt?: string;
    },
): DeterministicPipelineOutput {
    const buckets = options?.buckets ?? DEFAULT_BASE1_COMPARISON_BUCKETS;
    const normalized = normalizeExtractedInvoices(rawInvoices);
    const service = createDeterministicSavingsService(buckets);
    const { invoices, recorder } = service.runPipeline(normalized);

    const runId = options?.runId ?? randomUUID();
    const generatedAt = options?.generatedAt ?? new Date().toISOString();

    const crossCheck = buildSavingsCrossCheck({
        runId,
        generatedAt,
        invoices,
        recorder,
        buckets,
        configGeneration: options?.configGeneration,
    });

    return {
        invoices,
        recorder,
        crossCheck,
        crossCheckXlsx: Buffer.alloc(0),
        runId,
    };
}

export async function runDeterministicSavingsPipelineAsync(
    rawInvoices: unknown[],
    options?: Parameters<typeof runDeterministicSavingsPipeline>[1],
): Promise<DeterministicPipelineOutput> {
    const result = runDeterministicSavingsPipeline(rawInvoices, options);
    result.crossCheckXlsx = await crossCheckDocumentService.generateWorkbook(result.crossCheck);
    return result;
}
