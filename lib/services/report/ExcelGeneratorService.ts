import ExcelJS from 'exceljs';
import { ReportData, ExtractedInvoice } from '@/lib/types/ReportTypes';
import { getBase1BenchmarkGroups } from '@/lib/utils/base1AnalysisLabels';

const HEADER_BG_COLOR = '366092'; // Blue
const TOTALS_BG_COLOR = 'FFD966'; // Yellow
const OVERVIEW_TITLE_BG = '366092'; // Same blue as headers
const OVERVIEW_SECTION_BG = 'E7E6E6'; // Light grey for business block

export class ExcelGeneratorService {
    private formatCurrency(amount: number): string {
        return new Intl.NumberFormat('en-AU', {
            style: 'currency',
            currency: 'AUD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(amount);
    }

    async generateWorkbook(data: ReportData): Promise<Buffer> {
        const workbook = new ExcelJS.Workbook();

        const electricityInvoices = data.invoices.filter(i => i.utility_type === 'Electricity');
        const gasInvoices = data.invoices.filter(i => i.utility_type === 'Gas');
        const wasteInvoices = data.invoices.filter(i => i.utility_type === 'Waste');
        const waterInvoices = data.invoices.filter(i => i.utility_type === 'Water');
        const oilInvoices = data.invoices.filter(i => i.utility_type === 'Oil');

        const utilitySheets: { name: string; invoices: ExtractedInvoice[]; build: (s: ExcelJS.Worksheet, inv: ExtractedInvoice[]) => void }[] = [
            { name: 'Electricity Data', invoices: electricityInvoices, build: this.buildElectricitySheet.bind(this) },
            { name: 'Gas Data', invoices: gasInvoices, build: this.buildGasSheet.bind(this) },
            { name: 'Waste Data', invoices: wasteInvoices, build: this.buildWasteSheet.bind(this) },
            { name: 'Water Data', invoices: waterInvoices, build: this.buildWaterSheet.bind(this) },
            { name: 'Oil Data', invoices: oilInvoices, build: this.buildOilSheet.bind(this) },
        ];

        // 1. Overview always first
        const overviewSheet = workbook.addWorksheet('Overview');
        this.buildOverviewSheet(overviewSheet, data);

        // 2. Tabs with data (so data tabs appear 2nd, 3rd, … after Overview)
        for (const { name, invoices, build } of utilitySheets) {
            if (invoices.length > 0) {
                const sheet = workbook.addWorksheet(name);
                build(sheet, invoices);
            }
        }
        // 3. Empty utility tabs after data tabs
        for (const { name, invoices, build } of utilitySheets) {
            if (invoices.length === 0) {
                const sheet = workbook.addWorksheet(name);
                build(sheet, []);
            }
        }
        // 4. Cost Summary, Meter Details, Base 1 Analysis
        const costSummarySheet = workbook.addWorksheet('Cost Summary');
        const meterDetailsSheet = workbook.addWorksheet('Meter Details');
        const base1AnalysisSheet = workbook.addWorksheet('Base 1 Analysis');
        this.buildCostSummarySheet(costSummarySheet, data.invoices);
        this.buildMeterDetailsSheet(meterDetailsSheet, data.invoices);
        this.buildBase1AnalysisSheet(base1AnalysisSheet, data);

        const buffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(buffer);
    }

    private buildOverviewSheet(sheet: ExcelJS.Worksheet, data: ReportData) {
        // Title row - styled header
        sheet.addRow(['Base 1 Review Report']);
        const titleRow = sheet.getRow(1);
        titleRow.font = { bold: true, size: 18, color: { argb: 'FFFFFF' } };
        titleRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: OVERVIEW_TITLE_BG } };
        titleRow.alignment = { horizontal: 'center' };
        sheet.mergeCells('A1:B1');
        sheet.addRow([]);

        // Business info block
        const businessStartRow = sheet.rowCount + 1;
        sheet.addRow(['Business', data.businessInfo.name]);
        if (data.businessInfo.address) {
            sheet.addRow(['Address', data.businessInfo.address]);
        }
        sheet.addRow(['Report generated', new Date(data.generatedAt).toLocaleString()]);
        sheet.addRow(['Total invoices', data.invoices.length]);
        const businessEndRow = sheet.rowCount;
        for (let r = businessStartRow; r <= businessEndRow; r++) {
            sheet.getRow(r).getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: OVERVIEW_SECTION_BG } };
            sheet.getRow(r).getCell(1).font = { bold: true };
        }
        sheet.addRow([]);

        // Summary section
        sheet.addRow(['Summary']);
        sheet.getRow(sheet.rowCount).font = { bold: true, size: 12 };
        sheet.getRow(sheet.rowCount).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: OVERVIEW_SECTION_BG } };
        sheet.addRow([]);

        const totalCost = data.invoices.reduce((sum, inv) => sum + (inv.total_inc_gst || 0), 0);
        sheet.addRow(['Total annual cost (est.)', this.formatCurrency(totalCost)]);
        if (data.savingsSummary) {
            sheet.addRow([
                'Potential savings (conservative)', this.formatCurrency(data.savingsSummary.conservative),
                'Our costs – conservative (1st month savings)', this.formatCurrency(data.savingsSummary.conservative / 12)
            ]);
            sheet.addRow([
                'Potential savings (moderate)', this.formatCurrency(data.savingsSummary.moderate),
                'Our costs – moderate (1st month savings)', this.formatCurrency(data.savingsSummary.moderate / 12)
            ]);
            sheet.addRow([
                'Potential savings (optimistic)', this.formatCurrency(data.savingsSummary.optimistic),
                'Our costs – optimistic (1st month savings)', this.formatCurrency(data.savingsSummary.optimistic / 12)
            ]);
        }
        sheet.getColumn(1).width = 32;
        sheet.getColumn(2).width = 18;
        sheet.getColumn(3).width = 42;
        sheet.getColumn(4).width = 18;
    }

    private buildElectricitySheet(sheet: ExcelJS.Worksheet, invoices: ExtractedInvoice[]) {
        const hasShoulder = invoices.length > 0 && invoices.some(inv =>
            (inv.shoulder_usage_kwh !== null && inv.shoulder_usage_kwh !== undefined) ||
            (inv.shoulder_rate_c_per_kwh !== null && inv.shoulder_rate_c_per_kwh !== undefined)
        );

        const headers = ['Invoice Date', 'Supplier', 'NMI', 'Site Address', 'Billing Days', 'Peak Usage (kWh)'];
        if (hasShoulder) headers.push('Shoulder Usage (kWh)');
        headers.push('Off-Peak Usage (kWh)', 'Peak Rate (c/kWh)');
        if (hasShoulder) headers.push('Shoulder Rate (c/kWh)');
        headers.push('Off-Peak Rate (c/kWh)', 'Daily Supply ($)', 'Total (inc GST)',
            'Max Demand (kW/kVA)', 'Demand Charges ($)', 'Meter Charges ($)', 'Total Usage (kWh)',
            'Estimated Annual Usage (kWh)');

        sheet.addRow(headers);
        const headerRow = sheet.getRow(1);
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
        headerRow.font = { color: { argb: 'FFFFFF' }, bold: true };
        headerRow.alignment = { horizontal: 'center' };

        if (invoices.length === 0) {
            sheet.addRow(['No data']);
            return;
        }

        invoices.forEach(inv => {
            const billingDays = inv.billing_days || 0;
            const totalUsage = inv.total_usage_kwh || 0;
            const annualUsage = billingDays > 0 ? (totalUsage / billingDays) * 365 : null;

            const row: any[] = [
                inv.invoice_date || '', inv.supplier || '', inv.nmi || '',
                inv.site_address || '', billingDays || '', inv.peak_usage_kwh || 0,
            ];
            if (hasShoulder) row.push(inv.shoulder_usage_kwh || 0);
            row.push(inv.off_peak_usage_kwh || 0, inv.peak_rate_c_per_kwh ?? '');
            if (hasShoulder) row.push(inv.shoulder_rate_c_per_kwh ?? '');
            row.push(
                inv.off_peak_rate_c_per_kwh ?? '', inv.daily_supply_charge ?? '',
                inv.total_inc_gst || 0, inv.demand_kw ?? '', inv.demand_charges ?? '',
                inv.meter_charges ?? '', totalUsage, annualUsage ?? ''
            );
            sheet.addRow(row);
        });

        const totalUsage = invoices.reduce((sum, inv) => sum + (inv.total_usage_kwh || 0), 0);
        const totalAnnualUsage = invoices.reduce((sum, inv) => {
            const days = inv.billing_days || 0;
            const usage = inv.total_usage_kwh || 0;
            return sum + (days > 0 ? (usage / days) * 365 : 0);
        }, 0);
        const maxDemand = invoices.reduce((max, inv) => Math.max(max, inv.demand_kw || 0), 0);

        const totalRow: any[] = ['TOTAL', '', '', '', '',
            invoices.reduce((sum, inv) => sum + (inv.peak_usage_kwh || 0), 0)];
        if (hasShoulder) totalRow.push(invoices.reduce((sum, inv) => sum + (inv.shoulder_usage_kwh || 0), 0));
        totalRow.push(invoices.reduce((sum, inv) => sum + (inv.off_peak_usage_kwh || 0), 0), '');
        if (hasShoulder) totalRow.push('');
        totalRow.push(
            '', invoices.reduce((sum, inv) => sum + (inv.daily_supply_charge || 0), 0),
            invoices.reduce((sum, inv) => sum + (inv.total_inc_gst || 0), 0),
            maxDemand || '',
            invoices.reduce((sum, inv) => sum + (inv.demand_charges || 0), 0),
            invoices.reduce((sum, inv) => sum + (inv.meter_charges || 0), 0),
            totalUsage, totalAnnualUsage ?? ''
        );

        sheet.addRow(totalRow);
        const totalsRowObj = sheet.getRow(sheet.rowCount);
        totalsRowObj.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTALS_BG_COLOR } };
        totalsRowObj.font = { bold: true };

        const dailySupplyCol = hasShoulder ? 12 : 11;
        const totalCol = hasShoulder ? 13 : 12;
        const demandChargesCol = hasShoulder ? 15 : 14;
        const meterChargesCol = hasShoulder ? 16 : 15;
        const annualUsageCol = hasShoulder ? 18 : 17;
        sheet.getColumn(dailySupplyCol).numFmt = '$#,##0.00';
        sheet.getColumn(totalCol).numFmt = '$#,##0.00';
        sheet.getColumn(demandChargesCol).numFmt = '$#,##0.00';
        sheet.getColumn(meterChargesCol).numFmt = '$#,##0.00';
        sheet.getColumn(annualUsageCol).numFmt = '#,##0.00';
    }

    private buildGasSheet(sheet: ExcelJS.Worksheet, invoices: ExtractedInvoice[]) {
        const headers = ['Invoice Date', 'Supplier', 'MRIN', 'Site Address', 'Billing Days', 'Usage (GJ)',
            'Rate ($/GJ)', 'Daily Supply ($)', 'Total (inc GST)',
            'Estimated Monthly Usage (GJ)', 'Estimated Annual Usage (GJ)'];
        sheet.addRow(headers);
        const headerRow = sheet.getRow(1);
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
        headerRow.font = { color: { argb: 'FFFFFF' }, bold: true };
        headerRow.alignment = { horizontal: 'center' };

        if (invoices.length === 0) {
            sheet.addRow(['No data']);
            return;
        }

        invoices.forEach(inv => {
            const billingDays = inv.billing_days || 0;
            const totalUsage = inv.total_usage_gj || 0;
            const monthlyUsage = billingDays > 0 ? (totalUsage / billingDays) * 30 : null;
            const annualUsage = billingDays > 0 ? (totalUsage / billingDays) * 365 : null;

            sheet.addRow([
                inv.invoice_date || '', inv.supplier || '', inv.mrin || '', inv.site_address || '',
                billingDays || '', totalUsage, inv.gas_rate_per_gj ?? '', inv.daily_supply_charge ?? '',
                inv.total_inc_gst || 0, monthlyUsage ?? '', annualUsage ?? ''
            ]);
        });

        const totalUsage = invoices.reduce((sum, inv) => sum + (inv.total_usage_gj || 0), 0);
        const avgBillingDays = invoices.length > 0
            ? invoices.reduce((sum, inv) => sum + (inv.billing_days || 0), 0) / invoices.length : 30;
        const totalMonthlyUsage = avgBillingDays > 0 ? (totalUsage / avgBillingDays) * 30 : null;
        const totalAnnualUsage = avgBillingDays > 0 ? (totalUsage / avgBillingDays) * 365 : null;

        const totalRow = sheet.addRow([
            'TOTAL', '', '', '', '', totalUsage, '', '',
            invoices.reduce((sum, inv) => sum + (inv.total_inc_gst || 0), 0),
            totalMonthlyUsage, totalAnnualUsage
        ]);
        totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTALS_BG_COLOR } };
        totalRow.font = { bold: true };
        sheet.getColumn(7).numFmt = '$#,##0.00';
        sheet.getColumn(8).numFmt = '$#,##0.00';
        sheet.getColumn(9).numFmt = '$#,##0.00';
        sheet.getColumn(10).numFmt = '#,##0.00';
        sheet.getColumn(11).numFmt = '#,##0.00';
    }

    private buildWasteSheet(sheet: ExcelJS.Worksheet, invoices: ExtractedInvoice[]) {
        const headers = ['Invoice Date', 'Invoice Number', 'Supplier', 'Site Address', 'Service Type', 'Frequency',
            'Pickup Date', 'Unit Cost', 'Total (ex GST)', 'GST', 'Total (inc GST)'];
        sheet.addRow(headers);
        const headerRow = sheet.getRow(1);
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
        headerRow.font = { color: { argb: 'FFFFFF' }, bold: true };
        headerRow.alignment = { horizontal: 'center' };

        if (invoices.length === 0) {
            sheet.addRow(['No data']);
            return;
        }

        const hasServiceBreakdown = invoices.some(inv => inv.waste_services && inv.waste_services.length > 0);

        if (hasServiceBreakdown) {
            invoices.forEach(inv => {
                if (inv.waste_services && inv.waste_services.length > 0) {
                    let isFirstRowForInvoice = true;
                    inv.waste_services.forEach(service => {
                        const gstAmount = service.total_cost ? service.total_cost * 0.1 : null;
                        const totalIncGst = service.total_cost ? service.total_cost * 1.1 : null;

                        if (service.pickup_dates && service.pickup_dates.length > 0) {
                            service.pickup_dates.forEach((pickupDate, pickupIndex) => {
                                const isFirstRow = isFirstRowForInvoice && pickupIndex === 0;
                                const costPerPickup = service.total_cost && service.frequency
                                    ? service.total_cost / service.frequency : null;
                                sheet.addRow([
                                    isFirstRow ? (inv.invoice_date || '') : '',
                                    isFirstRow ? (inv.invoice_number || '') : '',
                                    isFirstRow ? (inv.supplier || '') : '',
                                    isFirstRow ? (inv.site_address || '') : '',
                                    service.service_type || '', '1', pickupDate,
                                    service.unit_cost ?? '',
                                    costPerPickup ?? '',
                                    costPerPickup ? costPerPickup * 0.1 : '',
                                    costPerPickup ? costPerPickup * 1.1 : ''
                                ]);
                                isFirstRowForInvoice = false;
                            });
                        } else {
                            sheet.addRow([
                                isFirstRowForInvoice ? (inv.invoice_date || '') : '',
                                isFirstRowForInvoice ? (inv.invoice_number || '') : '',
                                isFirstRowForInvoice ? (inv.supplier || '') : '',
                                isFirstRowForInvoice ? (inv.site_address || '') : '',
                                service.service_type || '', service.frequency ?? '', '',
                                service.unit_cost ?? '', service.total_cost ?? '',
                                gstAmount ?? '', totalIncGst ?? ''
                            ]);
                            isFirstRowForInvoice = false;
                        }
                    });
                } else {
                    sheet.addRow([
                        inv.invoice_date || '', inv.invoice_number || '', inv.supplier || '',
                        inv.site_address || '', inv.tariff_type || '', '', '',
                        '', inv.total_charges_ex_gst ?? '', inv.gst_amount ?? '', inv.total_inc_gst || 0
                    ]);
                }
            });
        } else {
            invoices.forEach(inv => {
                sheet.addRow([
                    inv.invoice_date || '', inv.invoice_number || '', inv.supplier || '',
                    inv.site_address || '', inv.tariff_type || '', '', '',
                    '', inv.total_charges_ex_gst ?? '', inv.gst_amount ?? '', inv.total_inc_gst || 0
                ]);
            });
        }

        let totalExGst = 0, totalGst = 0, totalIncGst = 0;
        invoices.forEach(inv => {
            if (inv.waste_services && inv.waste_services.length > 0) {
                inv.waste_services.forEach(service => {
                    if (service.total_cost) {
                        if (service.pickup_dates && service.pickup_dates.length > 0) {
                            const costPerPickup = service.frequency ? service.total_cost / service.frequency : 0;
                            totalExGst += costPerPickup * service.pickup_dates.length;
                            totalGst += costPerPickup * 0.1 * service.pickup_dates.length;
                            totalIncGst += costPerPickup * 1.1 * service.pickup_dates.length;
                        } else {
                            totalExGst += service.total_cost;
                            totalGst += service.total_cost * 0.1;
                            totalIncGst += service.total_cost * 1.1;
                        }
                    }
                });
            } else {
                totalExGst += inv.total_charges_ex_gst || 0;
                totalGst += inv.gst_amount || 0;
                totalIncGst += inv.total_inc_gst || 0;
            }
        });

        const totalRow = sheet.addRow(['TOTAL', '', '', '', '', '', '', '', totalExGst, totalGst, totalIncGst]);
        totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTALS_BG_COLOR } };
        totalRow.font = { bold: true };
        sheet.getColumn(8).numFmt = '$#,##0.00';
        sheet.getColumn(9).numFmt = '$#,##0.00';
        sheet.getColumn(10).numFmt = '$#,##0.00';
        sheet.getColumn(11).numFmt = '$#,##0.00';
    }

    private buildWaterSheet(sheet: ExcelJS.Worksheet, invoices: ExtractedInvoice[]) {
        sheet.addRow(['Invoice Date', 'Supplier', 'Site Address', 'Usage (kL)', 'Total (inc GST)']);
        const headerRow = sheet.getRow(1);
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
        headerRow.font = { color: { argb: 'FFFFFF' }, bold: true };
        headerRow.alignment = { horizontal: 'center' };

        if (invoices.length === 0) {
            sheet.addRow(['No data']);
            return;
        }

        invoices.forEach(inv => {
            sheet.addRow([
                inv.invoice_date || '', inv.supplier || '', inv.site_address || '',
                inv.volume_m3 || 0, inv.total_inc_gst || 0
            ]);
        });

        const totalRow = sheet.addRow([
            'TOTAL', '', '', '',
            invoices.reduce((sum, inv) => sum + (inv.total_inc_gst || 0), 0)
        ]);
        totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTALS_BG_COLOR } };
        totalRow.font = { bold: true };
        sheet.getColumn(5).numFmt = '$#,##0.00';
    }

    private buildOilSheet(sheet: ExcelJS.Worksheet, invoices: ExtractedInvoice[]) {
        const headers = ['Invoice Date', 'Invoice Number', 'Supplier', 'Site Address', 'Service Type', 'Quantity',
            'Unit Cost', 'Total (ex GST)', 'GST', 'Total (inc GST)'];
        sheet.addRow(headers);
        const headerRow = sheet.getRow(1);
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
        headerRow.font = { color: { argb: 'FFFFFF' }, bold: true };
        headerRow.alignment = { horizontal: 'center' };

        if (invoices.length === 0) {
            sheet.addRow(['No data']);
            return;
        }

        const hasServiceBreakdown = invoices.some(inv => inv.oil_services && inv.oil_services.length > 0);

        if (hasServiceBreakdown) {
            invoices.forEach(inv => {
                if (inv.oil_services && inv.oil_services.length > 0) {
                    inv.oil_services.forEach((service, index) => {
                        const gstAmount = service.total_cost ? service.total_cost * 0.1 : null;
                        const totalIncGst = service.total_cost ? service.total_cost * 1.1 : null;
                        sheet.addRow([
                            index === 0 ? (inv.invoice_date || '') : '',
                            index === 0 ? (inv.invoice_number || '') : '',
                            index === 0 ? (inv.supplier || '') : '',
                            index === 0 ? (inv.site_address || '') : '',
                            service.service_type || '', service.quantity ?? '', service.unit_cost ?? '',
                            service.total_cost ?? '', gstAmount ?? '', totalIncGst ?? ''
                        ]);
                    });
                } else {
                    sheet.addRow([
                        inv.invoice_date || '', inv.invoice_number || '', inv.supplier || '',
                        inv.site_address || '', inv.tariff_type || '', '', '',
                        inv.total_charges_ex_gst ?? '', inv.gst_amount ?? '', inv.total_inc_gst || 0
                    ]);
                }
            });
        } else {
            invoices.forEach(inv => {
                sheet.addRow([
                    inv.invoice_date || '', inv.invoice_number || '', inv.supplier || '',
                    inv.site_address || '', inv.tariff_type || '', '', '',
                    inv.total_charges_ex_gst ?? '', inv.gst_amount ?? '', inv.total_inc_gst || 0
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

        const totalRow = sheet.addRow(['TOTAL', '', '', '', '', '', '', totalExGst, totalGst, totalIncGst]);
        totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTALS_BG_COLOR } };
        totalRow.font = { bold: true };
        sheet.getColumn(7).numFmt = '$#,##0.00';
        sheet.getColumn(8).numFmt = '$#,##0.00';
        sheet.getColumn(9).numFmt = '$#,##0.00';
        sheet.getColumn(10).numFmt = '$#,##0.00';
    }

    private buildCostSummarySheet(sheet: ExcelJS.Worksheet, invoices: ExtractedInvoice[]) {
        sheet.addRow(['Utility Type', 'Invoice Count', 'Total Cost (inc GST)']);
        const headerRow = sheet.getRow(1);
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
        headerRow.font = { color: { argb: 'FFFFFF' }, bold: true };

        const byType = invoices.reduce((acc, inv) => {
            const type = inv.utility_type;
            if (!acc[type]) acc[type] = { count: 0, total: 0 };
            acc[type].count++;
            acc[type].total += inv.total_inc_gst || 0;
            return acc;
        }, {} as Record<string, { count: number; total: number }>);

        Object.entries(byType).forEach(([type, data]) => { sheet.addRow([type, data.count, data.total]); });

        const totalRow = sheet.addRow([
            'TOTAL', invoices.length,
            invoices.reduce((sum, inv) => sum + (inv.total_inc_gst || 0), 0)
        ]);
        totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTALS_BG_COLOR } };
        totalRow.font = { bold: true };
        sheet.getColumn(3).numFmt = '$#,##0.00';
    }

    private buildMeterDetailsSheet(sheet: ExcelJS.Worksheet, invoices: ExtractedInvoice[]) {
        sheet.addRow(['Utility Type', 'Meter Number', 'NMI/MRIN', 'Site Address', 'Tariff Type']);
        const headerRow = sheet.getRow(1);
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
        headerRow.font = { color: { argb: 'FFFFFF' }, bold: true };

        const typeOrder: Record<string, number> = {
            'Electricity': 1, 'Gas': 2, 'Water': 3, 'Waste': 4, 'Oil': 5, 'Cleaning': 6
        };
        const sortedInvoices = [...invoices].sort((a, b) => {
            const diff = (typeOrder[a.utility_type] || 99) - (typeOrder[b.utility_type] || 99);
            return diff !== 0 ? diff : (a.site_address || '').localeCompare(b.site_address || '');
        });

        sortedInvoices.forEach(inv => {
            sheet.addRow([
                inv.utility_type, inv.meter_number || '', inv.nmi || inv.mrin || '',
                inv.site_address || '', inv.tariff_type || ''
            ]);
        });
    }

    private buildBase1AnalysisSheet(sheet: ExcelJS.Worksheet, data: ReportData) {
        const BENCHMARK_COLS = 5;

        const applyBlueBannerRow = (rowIdx: number) => {
            sheet.mergeCells(`A${rowIdx}:E${rowIdx}`);
            const first = sheet.getRow(rowIdx).getCell(1);
            first.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
            first.font = { color: { argb: 'FFFFFF' }, bold: true, size: 12 };
            first.alignment = { horizontal: 'center', vertical: 'middle' };
        };

        const applyBlueHeaderCells = (rowIdx: number, colCount: number) => {
            const r = sheet.getRow(rowIdx);
            for (let c = 1; c <= colCount; c++) {
                const cell = r.getCell(c);
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
                cell.font = { color: { argb: 'FFFFFF' }, bold: true };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            }
        };

        const benchmarkGroups = getBase1BenchmarkGroups(data.invoices, {
            hideWasteForMemberReport: true,
        });
        const totalEstimated = data.savingsSummary?.optimistic ?? benchmarkGroups.reduce((s, g) => s + g.totalSavings, 0);
        const conservative = data.savingsSummary?.conservative ?? totalEstimated * 0.7;
        const firstMonthFee = conservative / 12;

        // Hero card
        sheet.addRow(['ESTIMATED ANNUAL SAVINGS', '', '', '', '']);
        const heroTitleIdx = sheet.rowCount;
        sheet.mergeCells(`A${heroTitleIdx}:E${heroTitleIdx}`);
        const heroTitle = sheet.getRow(heroTitleIdx).getCell(1);
        heroTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E7775' } };
        heroTitle.font = { color: { argb: 'FFFFFF' }, bold: true, size: 10 };
        heroTitle.alignment = { horizontal: 'center', vertical: 'middle' };

        sheet.addRow([totalEstimated, '', '', '', '']);
        const heroValueIdx = sheet.rowCount;
        sheet.mergeCells(`A${heroValueIdx}:E${heroValueIdx}`);
        const heroValue = sheet.getRow(heroValueIdx).getCell(1);
        heroValue.numFmt = '$#,##0';
        heroValue.font = { bold: true, size: 22, color: { argb: '102A43' } };
        heroValue.alignment = { horizontal: 'center', vertical: 'middle' };

        sheet.addRow(['Total identified savings, per year', '', '', '', '']);
        const heroSubIdx = sheet.rowCount;
        sheet.mergeCells(`A${heroSubIdx}:E${heroSubIdx}`);
        const heroSub = sheet.getRow(heroSubIdx).getCell(1);
        heroSub.font = { italic: true, size: 9, color: { argb: '4A5568' } };
        heroSub.alignment = { horizontal: 'center', vertical: 'middle' };

        sheet.addRow([]);

        // Breakdown table
        sheet.addRow(['Saving Breakdown by Category']);
        const breakdownTitleIdx = sheet.rowCount;
        sheet.mergeCells(`A${breakdownTitleIdx}:E${breakdownTitleIdx}`);
        sheet.getRow(breakdownTitleIdx).getCell(1).font = { bold: true, size: 11, color: { argb: '1A202C' } };

        sheet.addRow(['Category', 'Option Type', 'Invoices', 'Charge Type', '$']);
        applyBlueHeaderCells(sheet.rowCount, BENCHMARK_COLS);

        benchmarkGroups.forEach((g) => {
            const row = sheet.addRow([g.utilityType, g.optionKind, g.invoiceCount, g.relatedCharges, g.totalSavings || null]);
            row.getCell(5).numFmt = '$#,##0.00';
        });

        sheet.addRow(['Estimated Savings', '', '', '', totalEstimated]);
        const estRowIdx = sheet.rowCount;
        sheet.mergeCells(`A${estRowIdx}:D${estRowIdx}`);
        const estLabel = sheet.getRow(estRowIdx).getCell(1);
        estLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
        estLabel.font = { color: { argb: 'FFFFFF' }, bold: true };
        estLabel.alignment = { horizontal: 'left', vertical: 'middle' };
        const estValue = sheet.getRow(estRowIdx).getCell(5);
        estValue.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
        estValue.font = { color: { argb: 'FFFFFF' }, bold: true };
        estValue.numFmt = '$#,##0.00';
        estValue.alignment = { horizontal: 'right', vertical: 'middle' };

        sheet.addRow([]);

        // Fee section
        sheet.addRow(['Our Fee']);
        const feeTitleIdx = sheet.rowCount;
        sheet.mergeCells(`A${feeTitleIdx}:E${feeTitleIdx}`);
        sheet.getRow(feeTitleIdx).getCell(1).font = { bold: true, size: 11, color: { argb: '1A202C' } };

        sheet.addRow(['Basis', 'Conservative Annual Savings', '', 'First Month Fee', '']);
        const feeHdrIdx = sheet.rowCount;
        sheet.mergeCells(`B${feeHdrIdx}:C${feeHdrIdx}`);
        sheet.mergeCells(`D${feeHdrIdx}:E${feeHdrIdx}`);
        for (const col of [1, 2, 4] as const) {
            const cell = sheet.getRow(feeHdrIdx).getCell(col);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
            cell.font = { color: { argb: 'FFFFFF' }, bold: true };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }

        sheet.addRow(['Conservative estimate', conservative, '', firstMonthFee, '']);
        const feeRowIdx = sheet.rowCount;
        sheet.mergeCells(`B${feeRowIdx}:C${feeRowIdx}`);
        sheet.mergeCells(`D${feeRowIdx}:E${feeRowIdx}`);
        sheet.getRow(feeRowIdx).getCell(2).numFmt = '$#,##0.00';
        sheet.getRow(feeRowIdx).getCell(4).numFmt = '$#,##0.00';
        sheet.getRow(feeRowIdx).getCell(4).font = { bold: true, color: { argb: '1E7775' } };

        sheet.addRow(['Our fee equals one month of conservative annual savings. Figures use cent-level rounding only.', '', '', '', '']);
        const feeNoteIdx = sheet.rowCount;
        sheet.mergeCells(`A${feeNoteIdx}:E${feeNoteIdx}`);
        const feeNote = sheet.getRow(feeNoteIdx).getCell(1);
        feeNote.font = { size: 9, color: { argb: '4A5568' }, italic: true };
        feeNote.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };

        this.applyApproxColumnWidthsBase1Analysis(sheet, BENCHMARK_COLS);
    }

    /** Excel has no autofit API; widen columns from rendered cell text (capped). */
    private applyApproxColumnWidthsBase1Analysis(sheet: ExcelJS.Worksheet, maxCols: number) {
        const lengths = Array<number>(maxCols).fill(0);
        sheet.eachRow((row) => {
            row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
                if (colNumber > maxCols) return;
                const t = (cell.text ?? '').replace(/\r?\n/g, ' ');
                lengths[colNumber - 1] = Math.max(lengths[colNumber - 1], Math.min(t.length, 90));
            });
        });
        for (let c = 1; c <= maxCols; c++) {
            const base = lengths[c - 1] || 12;
            const w = Math.min(65, Math.max(14, base * 1.12 + 3));
            sheet.getColumn(c).width = w;
        }
    }
}

export const excelGeneratorService = new ExcelGeneratorService();
