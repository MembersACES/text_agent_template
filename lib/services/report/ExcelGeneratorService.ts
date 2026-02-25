import ExcelJS from 'exceljs';
import { ReportData, ExtractedInvoice } from '@/lib/types/ReportTypes';

const HEADER_BG_COLOR = '366092'; // Blue
const TOTALS_BG_COLOR = 'FFD966'; // Yellow

export class ExcelGeneratorService {
    async generateWorkbook(data: ReportData): Promise<Buffer> {
        const workbook = new ExcelJS.Workbook();

        const overviewSheet = workbook.addWorksheet('Overview');
        const electricitySheet = workbook.addWorksheet('Electricity Data');
        const gasSheet = workbook.addWorksheet('Gas Data');
        const wasteSheet = workbook.addWorksheet('Waste Data');
        const waterSheet = workbook.addWorksheet('Water Data');
        const oilSheet = workbook.addWorksheet('Oil Data');
        const costSummarySheet = workbook.addWorksheet('Cost Summary');
        const meterDetailsSheet = workbook.addWorksheet('Meter Details');
        const base1AnalysisSheet = workbook.addWorksheet('Base 1 Analysis');

        this.buildOverviewSheet(overviewSheet, data);

        const electricityInvoices = data.invoices.filter(i => i.utility_type === 'Electricity');
        const gasInvoices = data.invoices.filter(i => i.utility_type === 'Gas');
        const wasteInvoices = data.invoices.filter(i => i.utility_type === 'Waste');
        const waterInvoices = data.invoices.filter(i => i.utility_type === 'Water');
        const oilInvoices = data.invoices.filter(i => i.utility_type === 'Oil');

        this.buildElectricitySheet(electricitySheet, electricityInvoices);
        this.buildGasSheet(gasSheet, gasInvoices);
        this.buildWasteSheet(wasteSheet, wasteInvoices);
        this.buildWaterSheet(waterSheet, waterInvoices);
        this.buildOilSheet(oilSheet, oilInvoices);
        this.buildCostSummarySheet(costSummarySheet, data.invoices);
        this.buildMeterDetailsSheet(meterDetailsSheet, data.invoices);
        this.buildBase1AnalysisSheet(base1AnalysisSheet, data);

        const buffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(buffer);
    }

    private buildOverviewSheet(sheet: ExcelJS.Worksheet, data: ReportData) {
        sheet.addRow(['Base 1 Review Report']);
        sheet.getRow(1).font = { bold: true, size: 16 };
        sheet.addRow([]);

        sheet.addRow(['Business Name:', data.businessInfo.name]);
        if (data.businessInfo.address) {
            sheet.addRow(['Address:', data.businessInfo.address]);
        }
        sheet.addRow(['Report Generated:', new Date(data.generatedAt).toLocaleString()]);
        sheet.addRow(['Total Invoices Analyzed:', data.invoices.length]);

        sheet.addRow([]);
        sheet.addRow(['Summary']);
        sheet.getRow(sheet.rowCount).font = { bold: true };

        const totalCost = data.invoices.reduce((sum, inv) => sum + (inv.total_inc_gst || 0), 0);
        sheet.addRow(['Total Annual Cost (est):', `$${totalCost.toFixed(2)}`]);

        if (data.savingsSummary) {
            sheet.addRow(['Potential Savings (Conservative):', `$${data.savingsSummary.conservative.toFixed(2)}`]);
            sheet.addRow(['Potential Savings (Moderate):', `$${data.savingsSummary.moderate.toFixed(2)}`]);
            sheet.addRow(['Potential Savings (Optimistic):', `$${data.savingsSummary.optimistic.toFixed(2)}`]);
        }
    }

    private buildElectricitySheet(sheet: ExcelJS.Worksheet, invoices: ExtractedInvoice[]) {
        if (invoices.length === 0) {
            sheet.addRow(['No electricity invoices']);
            return;
        }

        const hasShoulder = invoices.some(inv =>
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
        if (invoices.length === 0) { sheet.addRow(['No gas invoices']); return; }

        const headers = ['Invoice Date', 'Supplier', 'MRIN', 'Site Address', 'Billing Days', 'Usage (GJ)',
            'Rate ($/GJ)', 'Daily Supply ($)', 'Total (inc GST)',
            'Estimated Monthly Usage (GJ)', 'Estimated Annual Usage (GJ)'];
        sheet.addRow(headers);
        const headerRow = sheet.getRow(1);
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
        headerRow.font = { color: { argb: 'FFFFFF' }, bold: true };
        headerRow.alignment = { horizontal: 'center' };

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
        if (invoices.length === 0) { sheet.addRow(['No waste invoices']); return; }

        const headers = ['Invoice Date', 'Invoice Number', 'Supplier', 'Site Address', 'Service Type', 'Frequency',
            'Pickup Date', 'Unit Cost', 'Total (ex GST)', 'GST', 'Total (inc GST)'];
        sheet.addRow(headers);
        const headerRow = sheet.getRow(1);
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
        headerRow.font = { color: { argb: 'FFFFFF' }, bold: true };
        headerRow.alignment = { horizontal: 'center' };

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
        if (invoices.length === 0) { sheet.addRow(['No water invoices']); return; }

        sheet.addRow(['Invoice Date', 'Supplier', 'Site Address', 'Usage (kL)', 'Total (inc GST)']);
        const headerRow = sheet.getRow(1);
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
        headerRow.font = { color: { argb: 'FFFFFF' }, bold: true };

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
        if (invoices.length === 0) { sheet.addRow(['No oil invoices']); return; }

        const headers = ['Invoice Date', 'Invoice Number', 'Supplier', 'Site Address', 'Service Type', 'Quantity',
            'Unit Cost', 'Total (ex GST)', 'GST', 'Total (inc GST)'];
        sheet.addRow(headers);
        const headerRow = sheet.getRow(1);
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
        headerRow.font = { color: { argb: 'FFFFFF' }, bold: true };
        headerRow.alignment = { horizontal: 'center' };

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
        sheet.addRow(['Benchmarking Results']);
        sheet.getRow(1).font = { bold: true, size: 14 };
        sheet.addRow([]);
        sheet.addRow(['Category', 'Issue Type', 'Flag', 'Current Rate/Cost', 'Market Benchmark', 'Potential Annual Savings']);
        const headerRow = sheet.getRow(3);
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
        headerRow.font = { color: { argb: 'FFFFFF' }, bold: true };

        data.invoices.forEach(inv => {
            if (inv.low_hanging_fruit && inv.low_hanging_fruit.length > 0) {
                inv.low_hanging_fruit.forEach(opp => {
                    const flag = opp.severity === 'high' ? '🔴' : opp.severity === 'medium' ? '🟡' : '🟢';
                    let currentRate = '';
                    if (opp.type === 'High Peak Rate' && inv.peak_rate_c_per_kwh !== null) currentRate = `${inv.peak_rate_c_per_kwh.toFixed(2)} c/kWh`;
                    else if (opp.type === 'High Shoulder Rate' && inv.shoulder_rate_c_per_kwh !== null) currentRate = `${inv.shoulder_rate_c_per_kwh.toFixed(2)} c/kWh`;
                    else if (opp.type === 'High Off-Peak Rate' && inv.off_peak_rate_c_per_kwh !== null) currentRate = `${inv.off_peak_rate_c_per_kwh.toFixed(2)} c/kWh`;
                    else if (opp.type === 'High Daily Supply' && inv.daily_supply_charge !== null) currentRate = `$${inv.daily_supply_charge.toFixed(2)}/day`;
                    else if (opp.type === 'High Meter Charges' && inv.meter_charges !== null && inv.billing_days !== null) currentRate = `$${((inv.meter_charges / inv.billing_days) * 365).toFixed(2)}/year`;
                    else if (opp.type === 'High Demand Charges' && inv.demand_charges !== null && inv.billing_days !== null) currentRate = `$${((inv.demand_charges / inv.billing_days) * 365).toFixed(2)}/year`;
                    else if (opp.type === 'High Gas Rate' && inv.gas_rate_per_gj !== null) currentRate = `$${inv.gas_rate_per_gj.toFixed(2)}/GJ`;

                    let benchmark = '';
                    if (opp.message) {
                        const m = opp.message.match(/(?:benchmark|threshold)\s+(?:of\s+)?([$]?[\d,]+\.?\d*\s*(?:\/year|\/day|\/GJ|c\/kWh)?)/i);
                        if (m) benchmark = m[1];
                    }

                    sheet.addRow([inv.utility_type, opp.type, flag, currentRate, benchmark, opp.potential_savings || '']);
                });
            }
        });

        sheet.addRow([]);

        if (data.savingsSummary) {
            sheet.addRow(['Total Potential Savings']);
            sheet.getRow(sheet.rowCount).font = { bold: true };
            sheet.addRow(['Conservative Estimate (70%):', `$${data.savingsSummary.conservative.toFixed(2)}`]);
            sheet.addRow(['Moderate Estimate (85%):', `$${data.savingsSummary.moderate.toFixed(2)}`]);
            sheet.addRow(['Optimistic Estimate (100%):', `$${data.savingsSummary.optimistic.toFixed(2)}`]);
            sheet.getColumn(2).numFmt = '$#,##0.00';
        }

        sheet.addRow([]);

        if (data.savingsSummary && data.savingsSummary.criticalIssues.length > 0) {
            sheet.addRow(['🔴 CRITICAL ISSUES']);
            sheet.getRow(sheet.rowCount).font = { bold: true, color: { argb: 'FF0000' } };
            data.savingsSummary.criticalIssues.forEach(issue => {
                sheet.addRow([issue.issue, `$${issue.savings.toFixed(2)}/year`]);
            });
        }
    }
}

export const excelGeneratorService = new ExcelGeneratorService();
