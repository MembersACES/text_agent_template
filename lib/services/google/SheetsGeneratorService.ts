import { google } from 'googleapis';
import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';
import { googleAuthService } from '@/lib/services/google/GoogleAuthService';
import { ReportData, ExtractedInvoice } from '@/lib/types/ReportTypes';
import { getBase1BenchmarkGroups } from '@/lib/utils/base1AnalysisLabels';

const logger = getLogger('SheetsGeneratorService');

const HEADER_BG_COLOR = { red: 0.212, green: 0.376, blue: 0.573 }; // #366092
const TOTALS_BG_COLOR = { red: 1.0, green: 0.851, blue: 0.4 }; // #FFD966
const OVERVIEW_SECTION_BG = { red: 0.906, green: 0.902, blue: 0.902 }; // #E7E6E6

export class SheetsGeneratorService {
    private formatCurrency(amount: number): string {
        return new Intl.NumberFormat('en-AU', {
            style: 'currency',
            currency: 'AUD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(amount);
    }

    async createSheet(data: ReportData, folderId?: string): Promise<{ spreadsheetId: string; url: string }> {
        const auth = googleAuthService.getWriteAuth();

        // Ensure JWT client has valid token
        await auth.authorize();

        const sheets = google.sheets({ version: 'v4', auth });
        const drive = google.drive({ version: 'v3', auth });

        logger.info('JWT auth client created');
        logger.info(`Service account email: ${settings.gcs.clientEmail}`);
        logger.info(`Auth scopes: ${auth.scopes}`);
        logger.info(`Auth credentials scope: ${auth.credentials?.scope || 'Not available'}`);

        // Test auth and check quota info
        try {
            const about = await drive.about.get({ fields: 'user,storageQuota' });
            logger.info(`Drive API test successful - authenticated as: ${about.data.user?.emailAddress}`);

            if (about.data.storageQuota) {
                const quota = about.data.storageQuota;
                const limit = quota.limit ? parseInt(quota.limit, 10) : 0;
                const usage = quota.usage ? parseInt(quota.usage, 10) : 0;
                const usageInDrive = quota.usageInDrive ? parseInt(quota.usageInDrive, 10) : 0;
                const limitMB = (limit / (1024 * 1024)).toFixed(2);
                const usageMB = (usage / (1024 * 1024)).toFixed(2);
                const usageInDriveMB = (usageInDrive / (1024 * 1024)).toFixed(2);

                logger.info('Storage quota info:');
                logger.info(`  - Limit: ${limitMB} MB (${limit} bytes)`);
                logger.info(`  - Total Usage: ${usageMB} MB (${usage} bytes)`);
                logger.info(`  - Usage in Drive: ${usageInDriveMB} MB (${usageInDrive} bytes)`);

                if (limit > 0) {
                    const percentUsed = ((usage / limit) * 100).toFixed(1);
                    logger.info(`  - Percent Used: ${percentUsed}%`);
                }
            }
        } catch (authTestError: any) {
            logger.warn(`Drive API auth test failed: ${authTestError?.message || authTestError}`);
            if (authTestError?.response) {
                logger.warn(`Auth test error details: ${JSON.stringify(authTestError.response.data, null, 2)}`);
            }
        }

        logger.info('Creating spreadsheet via Drive API...');
        const spreadsheetTitle = `Base 1 Review - ${data.businessInfo.name} - ${new Date(data.generatedAt).toLocaleDateString()}`;
        logger.info(`Spreadsheet title: ${spreadsheetTitle}`);

        let spreadsheetId: string;
        try {
            const createRequest: any = {
                requestBody: {
                    name: spreadsheetTitle,
                    mimeType: 'application/vnd.google-apps.spreadsheet',
                },
                fields: 'id',
            };

            if (folderId) {
                createRequest.requestBody.parents = [folderId];
                logger.info(`Creating spreadsheet directly in folder: ${folderId}`);
            }

            const file = await drive.files.create(createRequest);
            spreadsheetId = file.data.id!;
            logger.info(`Spreadsheet created successfully via Drive API: ${spreadsheetId}`);
        } catch (createError: any) {
            logger.error(`========== SPREADSHEET CREATION ERROR ==========`);
            logger.error(`Error type: ${createError?.constructor?.name}`);
            logger.error(`Error message: ${createError?.message}`);
            logger.error(`Error code: ${createError?.code}`);
            logger.error(`Error status: ${createError?.status}`);

            if (createError?.response) {
                logger.error(`Response status: ${createError.response.status}`);
                logger.error(`Response statusText: ${createError.response.statusText}`);
                logger.error(`Response data: ${JSON.stringify(createError.response.data, null, 2)}`);

                if (createError.response.data?.error) {
                    const errorData = createError.response.data.error;
                    logger.error(`Error details: code=${errorData.code}, message=${errorData.message}`);
                    if (errorData.errors) {
                        logger.error(`Errors: ${JSON.stringify(errorData.errors, null, 2)}`);
                    }
                }
            }

            if (createError?.config) {
                logger.error(`Request config: ${JSON.stringify({ method: createError.config.method, url: createError.config.url, headers: Object.keys(createError.config.headers || {}) })}`);
            }

            logger.error(`Full error object: ${JSON.stringify(createError, Object.getOwnPropertyNames(createError), 2)}`);

            if (createError?.response?.data?.error?.errors?.[0]?.reason === 'storageQuotaExceeded') {
                logger.error('========== QUOTA TROUBLESHOOTING ==========');
                logger.error('Even though the file is created in a shared folder,');
                logger.error('Google Drive checks the service account quota during creation.');
                logger.error('Solutions: 1) Wait a few minutes after emptying trash, 2) Run cleanup endpoint, 3) Check folder owner space, 4) Request additional quota from Workspace admin');
                logger.error('===========================================');
            }

            logger.error('===============================================');
            throw createError;
        }

        // Get spreadsheet data to find default sheet ID
        const spreadsheetData = await sheets.spreadsheets.get({ spreadsheetId });
        const defaultSheetId = spreadsheetData.data.sheets?.[0]?.properties?.sheetId;
        if (defaultSheetId !== undefined) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{ deleteSheet: { sheetId: defaultSheetId } }],
                },
            });
        }

        // Create all sheets
        const sheetRequests = [
            { title: 'Overview' },
            { title: 'Electricity Data' },
            { title: 'Gas Data' },
            { title: 'Waste Data' },
            { title: 'Water Data' },
            { title: 'Oil Data' },
            { title: 'Cost Summary' },
            { title: 'Meter Details' },
            { title: 'Base 1 Analysis' },
        ];

        const createSheetsResponse = await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: sheetRequests.map(title => ({
                    addSheet: { properties: title },
                })),
            },
        });

        const sheetIds = createSheetsResponse.data.replies
            ?.map((reply: any) => reply.addSheet?.properties?.sheetId)
            .filter((id: number | undefined): id is number => id !== undefined) || [];

        // Populate sheets with data
        await this.populateOverviewSheet(sheets, spreadsheetId, sheetIds[0], data);

        const electricityInvoices = data.invoices.filter(i => i.utility_type === 'Electricity');
        const gasInvoices = data.invoices.filter(i => i.utility_type === 'Gas');
        const wasteInvoices = data.invoices.filter(i => i.utility_type === 'Waste');
        const waterInvoices = data.invoices.filter(i => i.utility_type === 'Water');
        const oilInvoices = data.invoices.filter(i => i.utility_type === 'Oil');

        await this.populateElectricitySheet(sheets, spreadsheetId, sheetIds[1], electricityInvoices);
        await this.populateGasSheet(sheets, spreadsheetId, sheetIds[2], gasInvoices);
        await this.populateWasteSheet(sheets, spreadsheetId, sheetIds[3], wasteInvoices);
        await this.populateWaterSheet(sheets, spreadsheetId, sheetIds[4], waterInvoices);
        await this.populateOilSheet(sheets, spreadsheetId, sheetIds[5], oilInvoices);
        await this.populateCostSummarySheet(sheets, spreadsheetId, sheetIds[6], data.invoices);
        await this.populateMeterDetailsSheet(sheets, spreadsheetId, sheetIds[7], data.invoices);
        await this.populateBase1AnalysisSheet(sheets, spreadsheetId, sheetIds[8], data);

        const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
        return { spreadsheetId, url };
    }

    private async populateOverviewSheet(sheets: any, spreadsheetId: string, sheetId: number, data: ReportData) {
        const values = [
            ['Base 1 Review Report'],
            [],
            ['Business', data.businessInfo.name],
            ...(data.businessInfo.address ? [['Address', data.businessInfo.address]] : []),
            ['Report generated', new Date(data.generatedAt).toLocaleString()],
            ['Total invoices', data.invoices.length.toString()],
            [],
            ['Summary'],
            [],
        ];

        const totalCost = data.invoices.reduce((sum, inv) => sum + (inv.total_inc_gst || 0), 0);
        values.push(['Total annual cost (est.)', this.formatCurrency(totalCost)]);
        if (data.savingsSummary) {
            values.push(
                ['Potential savings (conservative)', this.formatCurrency(data.savingsSummary.conservative)],
                ['Potential savings (moderate)', this.formatCurrency(data.savingsSummary.moderate)],
                ['Potential savings (optimistic)', this.formatCurrency(data.savingsSummary.optimistic)]
            );
        }

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Overview!A1:B${values.length}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
        });

        const businessStartRow = 2;
        const businessEndRow = data.businessInfo.address ? 5 : 4;
        const summaryRowIndex = data.businessInfo.address ? 7 : 6;

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [
                    {
                        repeatCell: {
                            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                            cell: {
                                userEnteredFormat: {
                                    backgroundColor: HEADER_BG_COLOR,
                                    textFormat: { bold: true, fontSize: 18, foregroundColor: { red: 1, green: 1, blue: 1 } },
                                    horizontalAlignment: 'CENTER',
                                },
                            },
                            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
                        },
                    },
                    {
                        mergeCells: {
                            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 2 },
                            mergeType: 'MERGE_ALL',
                        },
                    },
                    {
                        repeatCell: {
                            range: { sheetId, startRowIndex: businessStartRow, endRowIndex: businessEndRow + 1, startColumnIndex: 0, endColumnIndex: 1 },
                            cell: {
                                userEnteredFormat: {
                                    backgroundColor: OVERVIEW_SECTION_BG,
                                    textFormat: { bold: true },
                                },
                            },
                            fields: 'userEnteredFormat(backgroundColor,textFormat)',
                        },
                    },
                    {
                        repeatCell: {
                            range: { sheetId, startRowIndex: summaryRowIndex, endRowIndex: summaryRowIndex + 1, startColumnIndex: 0, endColumnIndex: 1 },
                            cell: {
                                userEnteredFormat: {
                                    backgroundColor: OVERVIEW_SECTION_BG,
                                    textFormat: { bold: true, fontSize: 12 },
                                },
                            },
                            fields: 'userEnteredFormat(backgroundColor,textFormat)',
                        },
                    },
                    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 220 }, fields: 'pixelSize' } },
                    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 120 }, fields: 'pixelSize' } },
                ],
            },
        });
    }

    private async populateElectricitySheet(sheets: any, spreadsheetId: string, sheetId: number, invoices: ExtractedInvoice[]) {
        const hasShoulder = invoices.length > 0 && invoices.some(inv =>
            (inv.shoulder_usage_kwh !== null && inv.shoulder_usage_kwh !== undefined) ||
            (inv.shoulder_rate_c_per_kwh !== null && inv.shoulder_rate_c_per_kwh !== undefined)
        );

        const headers = ['Invoice Date', 'Supplier', 'NMI', 'Site Address', 'Peak Usage (kWh)'];
        if (hasShoulder) headers.push('Shoulder Usage (kWh)');
        headers.push('Off-Peak Usage (kWh)', 'Peak Rate (c/kWh)');
        if (hasShoulder) headers.push('Shoulder Rate (c/kWh)');
        headers.push('Off-Peak Rate (c/kWh)', 'Daily Supply ($)', 'Total (inc GST)',
            'Demand (kW/kVA)', 'Demand Charges ($)', 'Meter Charges ($)', 'Total Usage (kWh)');

        const values = [headers];
        if (invoices.length === 0) {
            values.push(['No data']);
            const lastCol = String.fromCharCode(65 + headers.length - 1);
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `Electricity Data!A1:${lastCol}${values.length}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values },
            });
            await this.formatSheetHeader(sheets, spreadsheetId, sheetId);
            return;
        }
        invoices.forEach(inv => {
            const row: any[] = [
                inv.invoice_date || '',
                inv.supplier || '',
                inv.nmi || '',
                inv.site_address || '',
                (inv.peak_usage_kwh || 0).toString(),
            ];

            if (hasShoulder) row.push((inv.shoulder_usage_kwh || 0).toString());

            row.push(
                (inv.off_peak_usage_kwh || 0).toString(),
                (inv.peak_rate_c_per_kwh ?? '').toString(),
            );

            if (hasShoulder) row.push((inv.shoulder_rate_c_per_kwh ?? '').toString());

            row.push(
                (inv.off_peak_rate_c_per_kwh ?? '').toString(),
                (inv.daily_supply_charge ?? '').toString(),
                (inv.total_inc_gst || 0).toString(),
                (inv.demand_kw ?? '').toString(),
                (inv.demand_charges ?? '').toString(),
                (inv.meter_charges ?? '').toString(),
                (inv.total_usage_kwh || 0).toString(),
            );

            values.push(row);
        });

        const totalRow: any[] = [
            'TOTAL', '', '', '',
            invoices.reduce((sum, inv) => sum + (inv.peak_usage_kwh || 0), 0).toString(),
        ];

        if (hasShoulder) totalRow.push(invoices.reduce((sum, inv) => sum + (inv.shoulder_usage_kwh || 0), 0).toString());

        totalRow.push(
            invoices.reduce((sum, inv) => sum + (inv.off_peak_usage_kwh || 0), 0).toString(),
            '',
        );

        if (hasShoulder) totalRow.push('');

        totalRow.push(
            '',
            invoices.reduce((sum, inv) => sum + (inv.daily_supply_charge || 0), 0).toString(),
            invoices.reduce((sum, inv) => sum + (inv.total_inc_gst || 0), 0).toString(),
        );

        values.push(totalRow);

        const lastCol = hasShoulder ? 'L' : 'J';
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Electricity Data!A1:${lastCol}${values.length}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
        });

        await this.formatSheetHeaderAndTotals(sheets, spreadsheetId, sheetId, values.length - 1);
    }

    private async populateGasSheet(sheets: any, spreadsheetId: string, sheetId: number, invoices: ExtractedInvoice[]) {
        const headers = ['Invoice Date', 'Supplier', 'MRIN', 'Site Address', 'Usage (GJ)',
            'Rate ($/GJ)', 'Daily Supply ($)', 'Total (inc GST)'];

        const values = [headers];
        if (invoices.length === 0) {
            values.push(['No data']);
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `Gas Data!A1:H${values.length}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values },
            });
            await this.formatSheetHeader(sheets, spreadsheetId, sheetId);
            return;
        }
        invoices.forEach(inv => {
            values.push([
                inv.invoice_date || '',
                inv.supplier || '',
                inv.mrin || '',
                inv.site_address || '',
                (inv.total_usage_gj || 0).toString(),
                (inv.gas_rate_per_gj ?? '').toString(),
                (inv.daily_supply_charge ?? '').toString(),
                (inv.total_inc_gst || 0).toString(),
            ]);
        });

        values.push([
            'TOTAL', '', '', '',
            invoices.reduce((sum, inv) => sum + (inv.total_usage_gj || 0), 0).toString(),
            '', '',
            invoices.reduce((sum, inv) => sum + (inv.total_inc_gst || 0), 0).toString(),
        ]);

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Gas Data!A1:H${values.length}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
        });

        await this.formatSheetHeaderAndTotals(sheets, spreadsheetId, sheetId, values.length - 1);
    }

    private async populateWasteSheet(sheets: any, spreadsheetId: string, sheetId: number, invoices: ExtractedInvoice[]) {
        const headers = ['Invoice Date', 'Supplier', 'Site Address', 'Service Type', 'Frequency',
            'Unit Cost', 'Total (ex GST)', 'GST', 'Total (inc GST)'];

        const values = [headers];
        if (invoices.length === 0) {
            values.push(['No data']);
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `Waste Data!A1:I${values.length}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values },
            });
            await this.formatSheetHeader(sheets, spreadsheetId, sheetId);
            return;
        }

        const hasServiceBreakdown = invoices.some(inv => inv.waste_services && inv.waste_services.length > 0);

        if (hasServiceBreakdown) {
            invoices.forEach(inv => {
                if (inv.waste_services && inv.waste_services.length > 0) {
                    inv.waste_services.forEach((service, index) => {
                        const gstAmount = service.total_cost ? service.total_cost * 0.1 : null;
                        const totalIncGst = service.total_cost ? service.total_cost * 1.1 : null;

                        values.push([
                            index === 0 ? (inv.invoice_date || '') : '',
                            index === 0 ? (inv.supplier || '') : '',
                            index === 0 ? (inv.site_address || '') : '',
                            service.service_type || '',
                            (service.frequency ?? '').toString(),
                            (service.unit_cost ?? '').toString(),
                            (service.total_cost ?? '').toString(),
                            (gstAmount ?? '').toString(),
                            (totalIncGst ?? '').toString(),
                        ]);
                    });
                } else {
                    values.push([
                        inv.invoice_date || '',
                        inv.supplier || '',
                        inv.site_address || '',
                        inv.tariff_type || '',
                        '', '',
                        (inv.total_charges_ex_gst ?? '').toString(),
                        (inv.gst_amount ?? '').toString(),
                        (inv.total_inc_gst || 0).toString(),
                    ]);
                }
            });
        } else {
            invoices.forEach(inv => {
                values.push([
                    inv.invoice_date || '',
                    inv.supplier || '',
                    inv.site_address || '',
                    inv.tariff_type || '',
                    '', '',
                    (inv.total_charges_ex_gst ?? '').toString(),
                    (inv.gst_amount ?? '').toString(),
                    (inv.total_inc_gst || 0).toString(),
                ]);
            });
        }

        let totalExGst = 0, totalGst = 0, totalIncGst = 0;
        invoices.forEach(inv => {
            if (inv.waste_services && inv.waste_services.length > 0) {
                inv.waste_services.forEach(service => {
                    if (service.total_cost) {
                        totalExGst += service.total_cost;
                        totalGst += service.total_cost * 0.1;
                        totalIncGst += service.total_cost * 1.1;
                    }
                });
            } else {
                totalExGst += inv.total_charges_ex_gst || 0;
                totalGst += inv.gst_amount || 0;
                totalIncGst += inv.total_inc_gst || 0;
            }
        });

        values.push(['TOTAL', '', '', '', '', '', totalExGst.toString(), totalGst.toString(), totalIncGst.toString()]);

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Waste Data!A1:I${values.length}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
        });

        await this.formatSheetHeaderAndTotals(sheets, spreadsheetId, sheetId, values.length - 1);
    }

    private async populateWaterSheet(sheets: any, spreadsheetId: string, sheetId: number, invoices: ExtractedInvoice[]) {
        const headers = ['Invoice Date', 'Supplier', 'Site Address', 'Usage (kL)', 'Total (inc GST)'];
        const values = [headers];
        if (invoices.length === 0) {
            values.push(['No data']);
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `Water Data!A1:E${values.length}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values },
            });
            await this.formatSheetHeader(sheets, spreadsheetId, sheetId);
            return;
        }

        invoices.forEach(inv => {
            values.push([
                inv.invoice_date || '',
                inv.supplier || '',
                inv.site_address || '',
                (inv.volume_m3 ? (inv.volume_m3 * 1000) : 0).toString(),
                (inv.total_inc_gst || 0).toString(),
            ]);
        });

        values.push([
            'TOTAL', '', '', '',
            invoices.reduce((sum, inv) => sum + (inv.total_inc_gst || 0), 0).toString(),
        ]);

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Water Data!A1:E${values.length}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
        });

        await this.formatSheetHeaderAndTotals(sheets, spreadsheetId, sheetId, values.length - 1);
    }

    private async populateOilSheet(sheets: any, spreadsheetId: string, sheetId: number, invoices: ExtractedInvoice[]) {
        const headers = ['Invoice Date', 'Supplier', 'Site Address', 'Service Type', 'Quantity',
            'Unit Cost', 'Total (ex GST)', 'GST', 'Total (inc GST)'];

        const values = [headers];
        if (invoices.length === 0) {
            values.push(['No data']);
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `Oil Data!A1:I${values.length}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values },
            });
            await this.formatSheetHeader(sheets, spreadsheetId, sheetId);
            return;
        }

        const hasServiceBreakdown = invoices.some(inv => inv.oil_services && inv.oil_services.length > 0);

        if (hasServiceBreakdown) {
            invoices.forEach(inv => {
                if (inv.oil_services && inv.oil_services.length > 0) {
                    inv.oil_services.forEach((service, index) => {
                        const gstAmount = service.total_cost ? service.total_cost * 0.1 : null;
                        const totalIncGst = service.total_cost ? service.total_cost * 1.1 : null;

                        values.push([
                            index === 0 ? (inv.invoice_date || '') : '',
                            index === 0 ? (inv.supplier || '') : '',
                            index === 0 ? (inv.site_address || '') : '',
                            service.service_type || '',
                            (service.quantity ?? '').toString(),
                            (service.unit_cost ?? '').toString(),
                            (service.total_cost ?? '').toString(),
                            (gstAmount ?? '').toString(),
                            (totalIncGst ?? '').toString(),
                        ]);
                    });
                } else {
                    values.push([
                        inv.invoice_date || '',
                        inv.supplier || '',
                        inv.site_address || '',
                        inv.tariff_type || '',
                        '', '',
                        (inv.total_charges_ex_gst ?? '').toString(),
                        (inv.gst_amount ?? '').toString(),
                        (inv.total_inc_gst || 0).toString(),
                    ]);
                }
            });
        } else {
            invoices.forEach(inv => {
                values.push([
                    inv.invoice_date || '',
                    inv.supplier || '',
                    inv.site_address || '',
                    inv.tariff_type || '',
                    '', '',
                    (inv.total_charges_ex_gst ?? '').toString(),
                    (inv.gst_amount ?? '').toString(),
                    (inv.total_inc_gst || 0).toString(),
                ]);
            });
        }

        let totalExGst = 0, totalGst = 0, totalIncGst = 0;
        invoices.forEach(inv => {
            if (inv.oil_services && inv.oil_services.length > 0) {
                inv.oil_services.forEach(service => {
                    if (service.total_cost) {
                        totalExGst += service.total_cost;
                        totalGst += service.total_cost * 0.1;
                        totalIncGst += service.total_cost * 1.1;
                    }
                });
            } else {
                totalExGst += inv.total_charges_ex_gst || 0;
                totalGst += inv.gst_amount || 0;
                totalIncGst += inv.total_inc_gst || 0;
            }
        });

        values.push(['TOTAL', '', '', '', '', '', totalExGst.toString(), totalGst.toString(), totalIncGst.toString()]);

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Oil Data!A1:I${values.length}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
        });

        await this.formatSheetHeaderAndTotals(sheets, spreadsheetId, sheetId, values.length - 1);
    }

    private async populateCostSummarySheet(sheets: any, spreadsheetId: string, sheetId: number, invoices: ExtractedInvoice[]) {
        const headers = ['Utility Type', 'Invoice Count', 'Total Cost (inc GST)'];
        const values = [headers];

        const byType = invoices.reduce((acc, inv) => {
            const type = inv.utility_type;
            if (!acc[type]) acc[type] = { count: 0, total: 0 };
            acc[type].count++;
            acc[type].total += inv.total_inc_gst || 0;
            return acc;
        }, {} as Record<string, { count: number; total: number }>);

        Object.entries(byType).forEach(([type, data]) => {
            values.push([type, data.count.toString(), data.total.toFixed(2)]);
        });

        values.push([
            'TOTAL',
            invoices.length.toString(),
            invoices.reduce((sum, inv) => sum + (inv.total_inc_gst || 0), 0).toFixed(2),
        ]);

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Cost Summary!A1:C${values.length}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
        });

        await this.formatSheetHeaderAndTotals(sheets, spreadsheetId, sheetId, values.length - 1);
    }

    private async populateMeterDetailsSheet(sheets: any, spreadsheetId: string, sheetId: number, invoices: ExtractedInvoice[]) {
        const headers = ['Utility Type', 'Meter Number', 'NMI/MRIN', 'Site Address', 'Tariff Type'];
        const values = [headers];

        invoices.forEach(inv => {
            values.push([
                inv.utility_type,
                inv.meter_number || '',
                inv.nmi || inv.mrin || '',
                inv.site_address || '',
                inv.tariff_type || '',
            ]);
        });

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Meter Details!A1:E${values.length}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
        });

        await this.formatSheetHeader(sheets, spreadsheetId, sheetId);
    }

    private async populateBase1AnalysisSheet(sheets: any, spreadsheetId: string, sheetId: number, data: ReportData) {
        const COLS = 5;
        const pad = (cells: string[]): string[] => [...cells, ...Array(Math.max(0, COLS - cells.length)).fill('')];

        const rows: string[][] = [];
        const pushRow = (cells: string[]) => rows.push(pad(cells));

        const benchmarkGroups = getBase1BenchmarkGroups(data.invoices, { hideWasteForMemberReport: true });
        const totalEstimated = data.savingsSummary?.optimistic ?? benchmarkGroups.reduce((sum, g) => sum + g.totalSavings, 0);
        const conservative = data.savingsSummary?.conservative ?? totalEstimated * 0.7;
        const firstMonthFee = conservative / 12;

        // Hero
        const heroTitleIdx = rows.length;
        pushRow(['ESTIMATED ANNUAL SAVINGS', '', '', '', '']);
        const heroValueIdx = rows.length;
        pushRow([this.formatCurrency(Math.round(totalEstimated)), '', '', '', '']);
        const heroSubIdx = rows.length;
        pushRow(['Total identified savings, per year', '', '', '', '']);
        pushRow([]);

        // Breakdown
        const breakdownTitleIdx = rows.length;
        pushRow(['Saving Breakdown by Category', '', '', '', '']);

        const benchmarkHeaderIdx = rows.length;
        pushRow(['Category', 'Option Type', 'Invoices', 'Charge Type', '$']);

        benchmarkGroups.forEach((g) => {
            pushRow([
                g.utilityType,
                g.optionKind,
                String(g.invoiceCount),
                g.relatedCharges,
                g.totalSavings > 0 ? this.formatCurrency(g.totalSavings) : '',
            ]);
        });

        const estTotalRowIdx = rows.length;
        pushRow(['Estimated Savings', '', '', '', this.formatCurrency(totalEstimated)]);
        pushRow([]);

        // Fee section
        const feeTitleIdx = rows.length;
        pushRow(['Our Fee', '', '', '', '']);

        const feeHeaderIdx = rows.length;
        pushRow(['Basis', 'Conservative Annual Savings', '', 'First Month Fee', '']);

        const feeValueIdx = rows.length;
        pushRow(['Conservative estimate', this.formatCurrency(conservative), '', this.formatCurrency(firstMonthFee), '']);

        const feeNoteIdx = rows.length;
        pushRow(['Our fee equals one month of conservative annual savings. Figures use cent-level rounding only.', '', '', '', '']);

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `Base 1 Analysis!A1:E${rows.length}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: rows },
        });

        const blueBannerFormat = {
            backgroundColor: HEADER_BG_COLOR,
            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 12 },
            horizontalAlignment: 'CENTER' as const,
        };
        const heroBannerFormat = {
            backgroundColor: { red: 0.118, green: 0.467, blue: 0.459 },
            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER' as const,
        };

        const blueHeaderFormat = {
            backgroundColor: HEADER_BG_COLOR,
            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
            horizontalAlignment: 'CENTER' as const,
        };

        const requests: object[] = [];

        requests.push({
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: heroTitleIdx,
                    endRowIndex: heroTitleIdx + 1,
                    startColumnIndex: 0,
                    endColumnIndex: COLS,
                },
                mergeType: 'MERGE_ALL',
            },
        });
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: heroTitleIdx,
                    endRowIndex: heroTitleIdx + 1,
                    startColumnIndex: 0,
                    endColumnIndex: COLS,
                },
                cell: { userEnteredFormat: heroBannerFormat },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
            },
        });
        requests.push({
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: heroValueIdx,
                    endRowIndex: heroValueIdx + 1,
                    startColumnIndex: 0,
                    endColumnIndex: COLS,
                },
                mergeType: 'MERGE_ALL',
            },
        });
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: heroValueIdx,
                    endRowIndex: heroValueIdx + 1,
                    startColumnIndex: 0,
                    endColumnIndex: COLS,
                },
                cell: {
                    userEnteredFormat: {
                        textFormat: { bold: true, fontSize: 22, foregroundColor: { red: 0.063, green: 0.165, blue: 0.263 } },
                        horizontalAlignment: 'CENTER',
                    },
                },
                fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
            },
        });
        requests.push({
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: heroSubIdx,
                    endRowIndex: heroSubIdx + 1,
                    startColumnIndex: 0,
                    endColumnIndex: COLS,
                },
                mergeType: 'MERGE_ALL',
            },
        });
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: heroSubIdx,
                    endRowIndex: heroSubIdx + 1,
                    startColumnIndex: 0,
                    endColumnIndex: COLS,
                },
                cell: {
                    userEnteredFormat: {
                        textFormat: { italic: true, fontSize: 9, foregroundColor: { red: 0.29, green: 0.333, blue: 0.408 } },
                        horizontalAlignment: 'CENTER',
                    },
                },
                fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
            },
        });

        requests.push({
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: breakdownTitleIdx,
                    endRowIndex: breakdownTitleIdx + 1,
                    startColumnIndex: 0,
                    endColumnIndex: COLS,
                },
                mergeType: 'MERGE_ALL',
            },
        });
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: benchmarkHeaderIdx,
                    endRowIndex: benchmarkHeaderIdx + 1,
                    startColumnIndex: 0,
                    endColumnIndex: COLS,
                },
                cell: { userEnteredFormat: blueHeaderFormat },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
            },
        });

        requests.push({
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: estTotalRowIdx,
                    endRowIndex: estTotalRowIdx + 1,
                    startColumnIndex: 0,
                    endColumnIndex: 4,
                },
                mergeType: 'MERGE_ALL',
            },
        });
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: estTotalRowIdx,
                    endRowIndex: estTotalRowIdx + 1,
                    startColumnIndex: 0,
                    endColumnIndex: 5,
                },
                cell: { userEnteredFormat: blueHeaderFormat },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
            },
        });

        requests.push({
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: feeTitleIdx,
                    endRowIndex: feeTitleIdx + 1,
                    startColumnIndex: 0,
                    endColumnIndex: COLS,
                },
                mergeType: 'MERGE_ALL',
            },
        });

        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: feeHeaderIdx,
                    endRowIndex: feeHeaderIdx + 1,
                    startColumnIndex: 0,
                    endColumnIndex: 1,
                },
                cell: { userEnteredFormat: blueHeaderFormat },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
            },
        });
        requests.push({
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: feeHeaderIdx,
                    endRowIndex: feeHeaderIdx + 1,
                    startColumnIndex: 1,
                    endColumnIndex: 3,
                },
                mergeType: 'MERGE_ALL',
            },
        });
        requests.push({
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: feeHeaderIdx,
                    endRowIndex: feeHeaderIdx + 1,
                    startColumnIndex: 3,
                    endColumnIndex: 5,
                },
                mergeType: 'MERGE_ALL',
            },
        });
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: feeHeaderIdx,
                    endRowIndex: feeHeaderIdx + 1,
                    startColumnIndex: 1,
                    endColumnIndex: 3,
                },
                cell: { userEnteredFormat: blueHeaderFormat },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
            },
        });
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: feeHeaderIdx,
                    endRowIndex: feeHeaderIdx + 1,
                    startColumnIndex: 3,
                    endColumnIndex: 5,
                },
                cell: { userEnteredFormat: blueHeaderFormat },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
            },
        });
        requests.push({
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: feeValueIdx,
                    endRowIndex: feeValueIdx + 1,
                    startColumnIndex: 1,
                    endColumnIndex: 3,
                },
                mergeType: 'MERGE_ALL',
            },
        });
        requests.push({
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: feeValueIdx,
                    endRowIndex: feeValueIdx + 1,
                    startColumnIndex: 3,
                    endColumnIndex: 5,
                },
                mergeType: 'MERGE_ALL',
            },
        });
        requests.push({
            mergeCells: {
                range: {
                    sheetId,
                    startRowIndex: feeNoteIdx,
                    endRowIndex: feeNoteIdx + 1,
                    startColumnIndex: 0,
                    endColumnIndex: COLS,
                },
                mergeType: 'MERGE_ALL',
            },
        });
        requests.push({
            repeatCell: {
                range: {
                    sheetId,
                    startRowIndex: feeNoteIdx,
                    endRowIndex: feeNoteIdx + 1,
                    startColumnIndex: 0,
                    endColumnIndex: COLS,
                },
                cell: {
                    userEnteredFormat: {
                        textFormat: { italic: true, fontSize: 9, foregroundColor: { red: 0.29, green: 0.333, blue: 0.408 } },
                        horizontalAlignment: 'LEFT',
                        wrapStrategy: 'WRAP',
                    },
                },
                fields: 'userEnteredFormat(textFormat,horizontalAlignment,wrapStrategy)',
            },
        });

        requests.push({
            autoResizeDimensions: {
                dimensions: {
                    sheetId,
                    dimension: 'COLUMNS',
                    startIndex: 0,
                    endIndex: COLS,
                },
            },
        });

        requests.push({
            updateSheetProperties: {
                properties: {
                    sheetId,
                    gridProperties: {
                        rowCount: Math.max(rows.length + 2, 50),
                        frozenRowCount: Math.min(benchmarkHeaderIdx + 1, rows.length),
                    },
                },
                fields: 'gridProperties(rowCount,frozenRowCount)',
            },
        });

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests },
        });
    }

    private async formatSheetHeader(sheets: any, spreadsheetId: string, sheetId: number) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    repeatCell: {
                        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                        cell: {
                            userEnteredFormat: {
                                backgroundColor: HEADER_BG_COLOR,
                                textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
                                horizontalAlignment: 'CENTER',
                            },
                        },
                        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
                    },
                }],
            },
        });
    }

    private async formatSheetHeaderAndTotals(sheets: any, spreadsheetId: string, sheetId: number, totalsRowIndex: number) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [
                    {
                        repeatCell: {
                            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                            cell: {
                                userEnteredFormat: {
                                    backgroundColor: HEADER_BG_COLOR,
                                    textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
                                    horizontalAlignment: 'CENTER',
                                },
                            },
                            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
                        },
                    },
                    {
                        repeatCell: {
                            range: { sheetId, startRowIndex: totalsRowIndex, endRowIndex: totalsRowIndex + 1 },
                            cell: {
                                userEnteredFormat: {
                                    backgroundColor: TOTALS_BG_COLOR,
                                    textFormat: { bold: true },
                                },
                            },
                            fields: 'userEnteredFormat(backgroundColor,textFormat)',
                        },
                    },
                ],
            },
        });
    }
}

export const sheetsGeneratorService = new SheetsGeneratorService();
