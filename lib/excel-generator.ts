import ExcelJS from 'exceljs';
import { ReportData, ExtractedInvoice } from './report-types';

const HEADER_BG_COLOR = '366092'; // Blue
const TOTALS_BG_COLOR = 'FFD966'; // Yellow

export async function generateBase1Workbook(data: ReportData): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    
    // Create all 9 sheets
    const overviewSheet = workbook.addWorksheet('Overview');
    const electricitySheet = workbook.addWorksheet('Electricity Data');
    const gasSheet = workbook.addWorksheet('Gas Data');
    const wasteSheet = workbook.addWorksheet('Waste Data');
    const waterSheet = workbook.addWorksheet('Water Data');
    const oilSheet = workbook.addWorksheet('Oil Data');
    const costSummarySheet = workbook.addWorksheet('Cost Summary');
    const meterDetailsSheet = workbook.addWorksheet('Meter Details');
    const base1AnalysisSheet = workbook.addWorksheet('Base 1 Analysis');

    // Build Overview sheet
    buildOverviewSheet(overviewSheet, data);

    // Build utility data sheets
    const electricityInvoices = data.invoices.filter(i => i.utility_type === 'Electricity');
    const gasInvoices = data.invoices.filter(i => i.utility_type === 'Gas');
    const wasteInvoices = data.invoices.filter(i => i.utility_type === 'Waste');
    const waterInvoices = data.invoices.filter(i => i.utility_type === 'Water');
    const oilInvoices = data.invoices.filter(i => i.utility_type === 'Oil');

    buildElectricitySheet(electricitySheet, electricityInvoices);
    buildGasSheet(gasSheet, gasInvoices);
    buildWasteSheet(wasteSheet, wasteInvoices);
    buildWaterSheet(waterSheet, waterInvoices);
    buildOilSheet(oilSheet, oilInvoices);
    buildCostSummarySheet(costSummarySheet, data.invoices);
    buildMeterDetailsSheet(meterDetailsSheet, data.invoices);
    buildBase1AnalysisSheet(base1AnalysisSheet, data);

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

function buildOverviewSheet(sheet: ExcelJS.Worksheet, data: ReportData) {
    sheet.addRow(['Base 1 Review Report']);
    sheet.getRow(1).font = { bold: true, size: 16 };
    sheet.addRow([]);
    
    sheet.addRow(['Business Name:', data.businessInfo.name]);
    if (data.businessInfo.address) {
        sheet.addRow(['Address:', data.businessInfo.address]);
    }
    sheet.addRow(['Report Generated:', new Date(data.generatedAt).toLocaleString()]);
    sheet.addRow(['Total Invoices Analyzed:', data.invoices.length]);
    
    // Quick stats
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

function buildElectricitySheet(sheet: ExcelJS.Worksheet, invoices: ExtractedInvoice[]) {
    if (invoices.length === 0) {
        sheet.addRow(['No electricity invoices']);
        return;
    }

    // Check if any invoice has shoulder data (optional - some states don't have shoulder)
    const hasShoulder = invoices.some(inv => 
        (inv.shoulder_usage_kwh !== null && inv.shoulder_usage_kwh !== undefined) ||
        (inv.shoulder_rate_c_per_kwh !== null && inv.shoulder_rate_c_per_kwh !== undefined)
    );

    // Headers - conditionally include shoulder columns
    const headers = ['Invoice Date', 'Supplier', 'NMI', 'Site Address', 'Billing Days', 'Peak Usage (kWh)'];
    if (hasShoulder) {
        headers.push('Shoulder Usage (kWh)');
    }
    headers.push('Off-Peak Usage (kWh)', 'Peak Rate (c/kWh)');
    if (hasShoulder) {
        headers.push('Shoulder Rate (c/kWh)');
    }
    headers.push('Off-Peak Rate (c/kWh)', 'Daily Supply ($)', 'Total (inc GST)', 
                 'Max Demand (kW/kVA)', 'Demand Charges ($)', 'Meter Charges ($)', 'Total Usage (kWh)',
                 'Estimated Monthly Usage (kWh)', 'Estimated Annual Usage (kWh)');
    
    sheet.addRow(headers);
    
    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: HEADER_BG_COLOR }
    };
    headerRow.font = { color: { argb: 'FFFFFF' }, bold: true };
    headerRow.alignment = { horizontal: 'center' };

    // Data rows
    invoices.forEach(inv => {
        const billingDays = inv.billing_days || 0;
        const totalUsage = inv.total_usage_kwh || 0;
        // Calculate monthly usage: (total usage / billing days) * 30
        const monthlyUsage = billingDays > 0 ? (totalUsage / billingDays) * 30 : null;
        // Calculate annual usage: (total usage / billing days) * 365
        const annualUsage = billingDays > 0 ? (totalUsage / billingDays) * 365 : null;
        
        const row: any[] = [
            inv.invoice_date || '',
            inv.supplier || '',
            inv.nmi || '',
            inv.site_address || '',
            billingDays || '',
            inv.peak_usage_kwh || 0,
        ];
        
        if (hasShoulder) {
            row.push(inv.shoulder_usage_kwh || 0);
        }
        
        row.push(
            inv.off_peak_usage_kwh || 0,
            inv.peak_rate_c_per_kwh ?? '',
        );
        
        if (hasShoulder) {
            row.push(inv.shoulder_rate_c_per_kwh ?? '');
        }
        
        row.push(
            inv.off_peak_rate_c_per_kwh ?? '',
            inv.daily_supply_charge ?? '',
            inv.total_inc_gst || 0,
            inv.demand_kw ?? '',
            inv.demand_charges ?? '',
            inv.meter_charges ?? '',
            totalUsage,
            monthlyUsage ?? '',
            annualUsage ?? ''
        );
        
        sheet.addRow(row);
    });

    // Totals row
    const totalRow: any[] = [
        'TOTAL', '', '', '', '', // Invoice Date, Supplier, NMI, Site Address, Billing Days
        invoices.reduce((sum, inv) => sum + (inv.peak_usage_kwh || 0), 0),
    ];
    
    if (hasShoulder) {
        totalRow.push(invoices.reduce((sum, inv) => sum + (inv.shoulder_usage_kwh || 0), 0));
    }
    
    totalRow.push(
        invoices.reduce((sum, inv) => sum + (inv.off_peak_usage_kwh || 0), 0),
        '', // Peak rate column
    );
    
    if (hasShoulder) {
        totalRow.push(''); // Shoulder rate column
    }
    
    // Calculate totals for monthly and annual usage
    // Sum the individual monthly/annual calculations to match what's displayed in rows
    const totalUsage = invoices.reduce((sum, inv) => sum + (inv.total_usage_kwh || 0), 0);
    const totalMonthlyUsage = invoices.reduce((sum, inv) => {
        const billingDays = inv.billing_days || 0;
        const usage = inv.total_usage_kwh || 0;
        return sum + (billingDays > 0 ? (usage / billingDays) * 30 : 0);
    }, 0);
    const totalAnnualUsage = invoices.reduce((sum, inv) => {
        const billingDays = inv.billing_days || 0;
        const usage = inv.total_usage_kwh || 0;
        return sum + (billingDays > 0 ? (usage / billingDays) * 365 : 0);
    }, 0);
    
    // Find maximum demand across all invoices
    const maxDemand = invoices.reduce((max, inv) => {
        const demand = inv.demand_kw || 0;
        return demand > max ? demand : max;
    }, 0);
    
    totalRow.push(
        '', // Off-peak rate column
        invoices.reduce((sum, inv) => sum + (inv.daily_supply_charge || 0), 0),
        invoices.reduce((sum, inv) => sum + (inv.total_inc_gst || 0), 0),
        maxDemand || '', // Maximum demand across all invoices
        invoices.reduce((sum, inv) => sum + (inv.demand_charges || 0), 0),
        invoices.reduce((sum, inv) => sum + (inv.meter_charges || 0), 0),
        totalUsage,
        totalMonthlyUsage ?? '',
        totalAnnualUsage ?? ''
    );
    
    sheet.addRow(totalRow);
    const totalsRowObj = sheet.getRow(sheet.rowCount);
    totalsRowObj.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: TOTALS_BG_COLOR }
    };
    totalsRowObj.font = { bold: true };

    // Format currency columns (adjust column indices based on whether shoulder is present)
    const dailySupplyCol = hasShoulder ? 12 : 11;
    const totalCol = hasShoulder ? 13 : 12;
    const demandChargesCol = hasShoulder ? 15 : 14;
    const meterChargesCol = hasShoulder ? 16 : 15;
    const monthlyUsageCol = hasShoulder ? 18 : 17;
    const annualUsageCol = hasShoulder ? 19 : 18;
    sheet.getColumn(dailySupplyCol).numFmt = '$#,##0.00';
    sheet.getColumn(totalCol).numFmt = '$#,##0.00';
    sheet.getColumn(demandChargesCol).numFmt = '$#,##0.00';
    sheet.getColumn(meterChargesCol).numFmt = '$#,##0.00';
    sheet.getColumn(monthlyUsageCol).numFmt = '#,##0.00';
    sheet.getColumn(annualUsageCol).numFmt = '#,##0.00';
}

function buildGasSheet(sheet: ExcelJS.Worksheet, invoices: ExtractedInvoice[]) {
    if (invoices.length === 0) {
        sheet.addRow(['No gas invoices']);
        return;
    }

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
        // Calculate monthly usage: (total usage / billing days) * 30
        const monthlyUsage = billingDays > 0 ? (totalUsage / billingDays) * 30 : null;
        // Calculate annual usage: (total usage / billing days) * 365
        const annualUsage = billingDays > 0 ? (totalUsage / billingDays) * 365 : null;
        
        sheet.addRow([
            inv.invoice_date || '',
            inv.supplier || '',
            inv.mrin || '',
            inv.site_address || '',
            billingDays || '',
            totalUsage,
            inv.gas_rate_per_gj ?? '',
            inv.daily_supply_charge ?? '',
            inv.total_inc_gst || 0,
            monthlyUsage ?? '',
            annualUsage ?? ''
        ]);
    });

    // Calculate totals for monthly and annual usage from total usage (not sum of individual monthly calculations)
    const totalUsage = invoices.reduce((sum, inv) => sum + (inv.total_usage_gj || 0), 0);
    // Use average billing days for total calculation, or default to 30 if no billing days
    const avgBillingDays = invoices.length > 0 
        ? invoices.reduce((sum, inv) => sum + (inv.billing_days || 0), 0) / invoices.length 
        : 30;
    const totalMonthlyUsage = avgBillingDays > 0 ? (totalUsage / avgBillingDays) * 30 : null;
    const totalAnnualUsage = avgBillingDays > 0 ? (totalUsage / avgBillingDays) * 365 : null;

    const totalRow = sheet.addRow([
        'TOTAL', '', '', '', '', // Invoice Date, Supplier, MRIN, Site Address, Billing Days
        totalUsage,
        '', '', // Rate, Daily Supply
        invoices.reduce((sum, inv) => sum + (inv.total_inc_gst || 0), 0),
        totalMonthlyUsage,
        totalAnnualUsage
    ]);
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTALS_BG_COLOR } };
    totalRow.font = { bold: true };

    sheet.getColumn(7).numFmt = '$#,##0.00'; // Rate
    sheet.getColumn(8).numFmt = '$#,##0.00'; // Daily Supply
    sheet.getColumn(9).numFmt = '$#,##0.00'; // Total
    sheet.getColumn(10).numFmt = '#,##0.00'; // Monthly Usage
    sheet.getColumn(11).numFmt = '#,##0.00'; // Annual Usage
}

function buildWasteSheet(sheet: ExcelJS.Worksheet, invoices: ExtractedInvoice[]) {
    if (invoices.length === 0) {
        sheet.addRow(['No waste invoices']);
        return;
    }

    const headers = ['Invoice Date', 'Invoice Number', 'Supplier', 'Site Address', 'Service Type', 'Frequency', 
                    'Pickup Date', 'Unit Cost', 'Total (ex GST)', 'GST', 'Total (inc GST)'];
    sheet.addRow(headers);
    
    const headerRow = sheet.getRow(1);
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
    headerRow.font = { color: { argb: 'FFFFFF' }, bold: true };
    headerRow.alignment = { horizontal: 'center' };

    // Check if any invoice has waste_services array
    const hasServiceBreakdown = invoices.some(inv => inv.waste_services && inv.waste_services.length > 0);

    if (hasServiceBreakdown) {
        // Output one row per pickup (if pickup_dates exist) or one row per service
        invoices.forEach(inv => {
            if (inv.waste_services && inv.waste_services.length > 0) {
                let isFirstRowForInvoice = true;
                inv.waste_services.forEach((service, serviceIndex) => {
                    const gstAmount = service.total_cost ? service.total_cost * 0.1 : null;
                    const totalIncGst = service.total_cost ? service.total_cost * 1.1 : null;
                    
                    // If pickup_dates exist, create one row per pickup date
                    if (service.pickup_dates && service.pickup_dates.length > 0) {
                        service.pickup_dates.forEach((pickupDate, pickupIndex) => {
                            const isFirstRow = isFirstRowForInvoice && pickupIndex === 0;
                            const unitCost = service.unit_cost ?? null;
                            const costPerPickup = service.total_cost && service.frequency 
                                ? service.total_cost / service.frequency 
                                : null;
                            
                            sheet.addRow([
                                isFirstRow ? (inv.invoice_date || '') : '', // Only show date on first row
                                isFirstRow ? (inv.invoice_number || '') : '', // Only show invoice number on first row
                                isFirstRow ? (inv.supplier || '') : '',     // Only show supplier on first row
                                isFirstRow ? (inv.site_address || '') : '', // Only show address on first row
                                service.service_type || '',
                                '1', // Frequency is 1 per pickup
                                pickupDate, // Pickup date
                                unitCost ?? '',
                                costPerPickup ?? '',
                                costPerPickup ? costPerPickup * 0.1 : '', // GST per pickup
                                costPerPickup ? costPerPickup * 1.1 : '' // Total inc GST per pickup
                            ]);
                            isFirstRowForInvoice = false;
                        });
                    } else {
                        // Fallback: one row per service if no pickup dates
                        const isFirstRow = isFirstRowForInvoice;
                        sheet.addRow([
                            isFirstRow ? (inv.invoice_date || '') : '', // Only show date on first service row
                            isFirstRow ? (inv.invoice_number || '') : '', // Only show invoice number on first service row
                            isFirstRow ? (inv.supplier || '') : '',     // Only show supplier on first service row
                            isFirstRow ? (inv.site_address || '') : '', // Only show address on first service row
                            service.service_type || '',
                            service.frequency ?? '',
                            '', // Pickup date (not available)
                            service.unit_cost ?? '',
                            service.total_cost ?? '',
                            gstAmount ?? '',
                            totalIncGst ?? ''
                        ]);
                        isFirstRowForInvoice = false;
                    }
                });
            } else {
                // Fallback: single row if no service breakdown
                sheet.addRow([
                    inv.invoice_date || '',
                    inv.invoice_number || '',
                    inv.supplier || '',
                    inv.site_address || '',
                    inv.tariff_type || '',
                    '',
                    '', // Pickup date
                    '',
                    inv.total_charges_ex_gst ?? '',
                    inv.gst_amount ?? '',
                    inv.total_inc_gst || 0
                ]);
            }
        });
    } else {
        // Fallback: single row per invoice if no service breakdown
        invoices.forEach(inv => {
            sheet.addRow([
                inv.invoice_date || '',
                inv.invoice_number || '',
                inv.supplier || '',
                inv.site_address || '',
                inv.tariff_type || '',
                '',
                '', // Pickup date
                '',
                inv.total_charges_ex_gst ?? '',
                inv.gst_amount ?? '',
                inv.total_inc_gst || 0
            ]);
        });
    }

    // Calculate totals
    let totalExGst = 0;
    let totalGst = 0;
    let totalIncGst = 0;

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
    
    // Recalculate totals from actual rows if we have pickup dates (since we split rows)
    // This ensures totals match the displayed rows
    if (hasServiceBreakdown) {
        let recalcExGst = 0;
        let recalcGst = 0;
        let recalcIncGst = 0;
        
        invoices.forEach(inv => {
            if (inv.waste_services && inv.waste_services.length > 0) {
                inv.waste_services.forEach(service => {
                    if (service.pickup_dates && service.pickup_dates.length > 0) {
                        // Calculate per pickup
                        const costPerPickup = service.total_cost && service.frequency 
                            ? service.total_cost / service.frequency 
                            : 0;
                        const gstPerPickup = costPerPickup * 0.1;
                        const totalPerPickup = costPerPickup * 1.1;
                        
                        recalcExGst += costPerPickup * service.pickup_dates.length;
                        recalcGst += gstPerPickup * service.pickup_dates.length;
                        recalcIncGst += totalPerPickup * service.pickup_dates.length;
                    } else if (service.total_cost) {
                        // Use original totals if no pickup dates
                        recalcExGst += service.total_cost;
                        recalcGst += service.total_cost * 0.1;
                        recalcIncGst += service.total_cost * 1.1;
                    }
                });
            }
        });
        
        // Use recalculated totals if they differ (meaning we have pickup dates)
        if (recalcExGst > 0 || recalcGst > 0 || recalcIncGst > 0) {
            totalExGst = recalcExGst;
            totalGst = recalcGst;
            totalIncGst = recalcIncGst;
        }
    }

    const totalRow = sheet.addRow([
        'TOTAL', '', '', '', '', '', '', // Invoice Date, Invoice Number, Supplier, Site Address, Service Type, Frequency, Pickup Date
        '', // Unit Cost
        totalExGst,
        totalGst,
        totalIncGst
    ]);
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTALS_BG_COLOR } };
    totalRow.font = { bold: true };

    // Format currency columns
    sheet.getColumn(8).numFmt = '$#,##0.00'; // Unit Cost
    sheet.getColumn(9).numFmt = '$#,##0.00'; // Total (ex GST)
    sheet.getColumn(10).numFmt = '$#,##0.00'; // GST
    sheet.getColumn(11).numFmt = '$#,##0.00'; // Total (inc GST)
}

function buildWaterSheet(sheet: ExcelJS.Worksheet, invoices: ExtractedInvoice[]) {
    if (invoices.length === 0) {
        sheet.addRow(['No water invoices']);
        return;
    }

    const headers = ['Invoice Date', 'Supplier', 'Site Address', 'Usage (kL)', 'Total (inc GST)'];
    sheet.addRow(headers);
    
    const headerRow = sheet.getRow(1);
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
    headerRow.font = { color: { argb: 'FFFFFF' }, bold: true };

    invoices.forEach(inv => {
        sheet.addRow([
            inv.invoice_date || '',
            inv.supplier || '',
            inv.site_address || '',
            inv.volume_m3 ? (inv.volume_m3 * 1000) : 0, // Convert m3 to kL
            inv.total_inc_gst || 0
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

function buildOilSheet(sheet: ExcelJS.Worksheet, invoices: ExtractedInvoice[]) {
    if (invoices.length === 0) {
        sheet.addRow(['No oil invoices']);
        return;
    }

    const headers = ['Invoice Date', 'Invoice Number', 'Supplier', 'Site Address', 'Service Type', 'Quantity', 
                    'Unit Cost', 'Total (ex GST)', 'GST', 'Total (inc GST)'];
    sheet.addRow(headers);
    
    const headerRow = sheet.getRow(1);
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
    headerRow.font = { color: { argb: 'FFFFFF' }, bold: true };
    headerRow.alignment = { horizontal: 'center' };

    // Check if any invoice has oil_services array
    const hasServiceBreakdown = invoices.some(inv => inv.oil_services && inv.oil_services.length > 0);

    if (hasServiceBreakdown) {
        // Output one row per service
        invoices.forEach(inv => {
            if (inv.oil_services && inv.oil_services.length > 0) {
                inv.oil_services.forEach((service, index) => {
                    const gstAmount = service.total_cost ? service.total_cost * 0.1 : null;
                    const totalIncGst = service.total_cost ? service.total_cost * 1.1 : null;
                    
                    sheet.addRow([
                        index === 0 ? (inv.invoice_date || '') : '', // Only show date on first service row
                        index === 0 ? (inv.invoice_number || '') : '', // Only show invoice number on first service row
                        index === 0 ? (inv.supplier || '') : '',     // Only show supplier on first service row
                        index === 0 ? (inv.site_address || '') : '', // Only show address on first service row
                        service.service_type || '',
                        service.quantity ?? '',
                        service.unit_cost ?? '',
                        service.total_cost ?? '',
                        gstAmount ?? '',
                        totalIncGst ?? ''
                    ]);
                });
            } else {
                // Fallback: single row if no service breakdown
                sheet.addRow([
                    inv.invoice_date || '',
                    inv.invoice_number || '',
                    inv.supplier || '',
                    inv.site_address || '',
                    inv.tariff_type || '',
                    '',
                    '',
                    inv.total_charges_ex_gst ?? '',
                    inv.gst_amount ?? '',
                    inv.total_inc_gst || 0
                ]);
            }
        });
    } else {
        // Fallback: single row per invoice if no service breakdown
        invoices.forEach(inv => {
            sheet.addRow([
                inv.invoice_date || '',
                inv.invoice_number || '',
                inv.supplier || '',
                inv.site_address || '',
                inv.tariff_type || '',
                '',
                '',
                inv.total_charges_ex_gst ?? '',
                inv.gst_amount ?? '',
                inv.total_inc_gst || 0
            ]);
        });
    }

    // Calculate totals
    let totalExGst = 0;
    let totalGst = 0;
    let totalIncGst = 0;

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

    const totalRow = sheet.addRow([
        'TOTAL', '', '', '', '', '', '', // Invoice Date, Invoice Number, Supplier, Site Address, Service Type, Quantity
        '', // Unit Cost
        totalExGst,
        totalGst,
        totalIncGst
    ]);
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTALS_BG_COLOR } };
    totalRow.font = { bold: true };

    // Format currency columns
    sheet.getColumn(7).numFmt = '$#,##0.00'; // Unit Cost
    sheet.getColumn(8).numFmt = '$#,##0.00'; // Total (ex GST)
    sheet.getColumn(9).numFmt = '$#,##0.00'; // GST
    sheet.getColumn(10).numFmt = '$#,##0.00'; // Total (inc GST)
}

function buildCostSummarySheet(sheet: ExcelJS.Worksheet, invoices: ExtractedInvoice[]) {
    const headers = ['Utility Type', 'Invoice Count', 'Total Cost (inc GST)'];
    sheet.addRow(headers);
    
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

    Object.entries(byType).forEach(([type, data]) => {
        sheet.addRow([type, data.count, data.total]);
    });

    const totalRow = sheet.addRow([
        'TOTAL',
        invoices.length,
        invoices.reduce((sum, inv) => sum + (inv.total_inc_gst || 0), 0)
    ]);
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTALS_BG_COLOR } };
    totalRow.font = { bold: true };

    sheet.getColumn(3).numFmt = '$#,##0.00';
}

function buildMeterDetailsSheet(sheet: ExcelJS.Worksheet, invoices: ExtractedInvoice[]) {
    const headers = ['Utility Type', 'Meter Number', 'NMI/MRIN', 'Site Address', 'Tariff Type'];
    sheet.addRow(headers);
    
    const headerRow = sheet.getRow(1);
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
    headerRow.font = { color: { argb: 'FFFFFF' }, bold: true };

    // Sort invoices by utility type
    const sortedInvoices = [...invoices].sort((a, b) => {
        const typeOrder: Record<string, number> = {
            'Electricity': 1,
            'Gas': 2,
            'Water': 3,
            'Waste': 4,
            'Oil': 5,
            'Cleaning': 6
        };
        const orderA = typeOrder[a.utility_type] || 99;
        const orderB = typeOrder[b.utility_type] || 99;
        if (orderA !== orderB) return orderA - orderB;
        // If same type, sort by site address
        return (a.site_address || '').localeCompare(b.site_address || '');
    });

    sortedInvoices.forEach(inv => {
        sheet.addRow([
            inv.utility_type,
            inv.meter_number || '',
            inv.nmi || inv.mrin || '',
            inv.site_address || '',
            inv.tariff_type || ''
        ]);
    });
}

function buildBase1AnalysisSheet(sheet: ExcelJS.Worksheet, data: ReportData) {
    // Benchmarking Results Table
    sheet.addRow(['Benchmarking Results']);
    sheet.getRow(1).font = { bold: true, size: 14 };
    sheet.addRow([]);
    
    const benchmarkHeaders = ['Category', 'Issue Type', 'Flag', 'Current Rate/Cost', 'Market Benchmark', 'Potential Annual Savings'];
    sheet.addRow(benchmarkHeaders);
    
    const headerRow = sheet.getRow(3);
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
    headerRow.font = { color: { argb: 'FFFFFF' }, bold: true };

    // Extract savings opportunities from invoices
    data.invoices.forEach(inv => {
        if (inv.low_hanging_fruit && inv.low_hanging_fruit.length > 0) {
            inv.low_hanging_fruit.forEach(opp => {
                const flag = opp.severity === 'high' ? '🔴' : opp.severity === 'medium' ? '🟡' : '🟢';
                sheet.addRow([
                    inv.utility_type,
                    opp.type,
                    flag,
                    '', // Current rate - would need calculation
                    '', // Market benchmark
                    opp.potential_savings || ''
                ]);
            });
        }
    });

    sheet.addRow([]);
    
    // Total Potential Savings
    if (data.savingsSummary) {
        sheet.addRow(['Total Potential Savings']);
        sheet.getRow(sheet.rowCount).font = { bold: true };
        sheet.addRow(['Conservative Estimate (70%):', `$${data.savingsSummary.conservative.toFixed(2)}`]);
        sheet.addRow(['Moderate Estimate (85%):', `$${data.savingsSummary.moderate.toFixed(2)}`]);
        sheet.addRow(['Optimistic Estimate (100%):', `$${data.savingsSummary.optimistic.toFixed(2)}`]);
        
        sheet.getColumn(2).numFmt = '$#,##0.00';
    }

    sheet.addRow([]);
    
    // Critical Issues
    if (data.savingsSummary && data.savingsSummary.criticalIssues.length > 0) {
        sheet.addRow(['🔴 CRITICAL ISSUES']);
        sheet.getRow(sheet.rowCount).font = { bold: true, color: { argb: 'FF0000' } };
        data.savingsSummary.criticalIssues.forEach(issue => {
            sheet.addRow([issue.issue, `$${issue.savings.toFixed(2)}/year`]);
        });
    }
}

