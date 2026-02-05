import ExcelJS from 'exceljs';
import { ReportData, ExtractedInvoice } from './report-types';

const HEADER_BG_COLOR = '366092'; // Blue
const TOTALS_BG_COLOR = 'FFD966'; // Yellow

export async function generateBase1Workbook(data: ReportData): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    
    // Create all 8 sheets
    const overviewSheet = workbook.addWorksheet('Overview');
    const electricitySheet = workbook.addWorksheet('Electricity Data');
    const gasSheet = workbook.addWorksheet('Gas Data');
    const wasteSheet = workbook.addWorksheet('Waste Data');
    const waterSheet = workbook.addWorksheet('Water Data');
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

    buildElectricitySheet(electricitySheet, electricityInvoices);
    buildGasSheet(gasSheet, gasInvoices);
    buildWasteSheet(wasteSheet, wasteInvoices);
    buildWaterSheet(waterSheet, waterInvoices);
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

    // Headers
    const headers = ['Invoice Date', 'Supplier', 'NMI', 'Site Address', 'Peak Usage (kWh)', 
                    'Off-Peak Usage (kWh)', 'Peak Rate (c/kWh)', 'Off-Peak Rate (c/kWh)',
                    'Daily Supply ($)', 'Total (inc GST)'];
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
        sheet.addRow([
            inv.invoice_date || '',
            inv.supplier || '',
            inv.nmi || '',
            inv.site_address || '',
            inv.peak_usage_kwh || 0,
            inv.off_peak_usage_kwh || 0,
            inv.peak_rate_c_per_kwh || 0,
            inv.off_peak_rate_c_per_kwh || 0,
            inv.daily_supply_charge || 0,
            inv.total_inc_gst || 0
        ]);
    });

    // Totals row
    const totalRow = sheet.addRow([
        'TOTAL', '', '', '',
        invoices.reduce((sum, inv) => sum + (inv.peak_usage_kwh || 0), 0),
        invoices.reduce((sum, inv) => sum + (inv.off_peak_usage_kwh || 0), 0),
        '', '',
        invoices.reduce((sum, inv) => sum + (inv.daily_supply_charge || 0), 0),
        invoices.reduce((sum, inv) => sum + (inv.total_inc_gst || 0), 0)
    ]);
    totalRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: TOTALS_BG_COLOR }
    };
    totalRow.font = { bold: true };

    // Format currency columns
    sheet.getColumn(9).numFmt = '$#,##0.00';
    sheet.getColumn(10).numFmt = '$#,##0.00';
}

function buildGasSheet(sheet: ExcelJS.Worksheet, invoices: ExtractedInvoice[]) {
    if (invoices.length === 0) {
        sheet.addRow(['No gas invoices']);
        return;
    }

    const headers = ['Invoice Date', 'Supplier', 'MRIN', 'Site Address', 'Usage (GJ)', 
                    'Rate ($/GJ)', 'Daily Supply ($)', 'Total (inc GST)'];
    sheet.addRow(headers);
    
    const headerRow = sheet.getRow(1);
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
    headerRow.font = { color: { argb: 'FFFFFF' }, bold: true };
    headerRow.alignment = { horizontal: 'center' };

    invoices.forEach(inv => {
        sheet.addRow([
            inv.invoice_date || '',
            inv.supplier || '',
            inv.mrin || '',
            inv.site_address || '',
            inv.total_usage_gj || 0,
            inv.total_usage_gj ? (inv.usage_charges_ex_gst || 0) / (inv.total_usage_gj || 1) : 0,
            inv.daily_supply_charge || 0,
            inv.total_inc_gst || 0
        ]);
    });

    const totalRow = sheet.addRow([
        'TOTAL', '', '', '',
        invoices.reduce((sum, inv) => sum + (inv.total_usage_gj || 0), 0),
        '', '',
        invoices.reduce((sum, inv) => sum + (inv.total_inc_gst || 0), 0)
    ]);
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTALS_BG_COLOR } };
    totalRow.font = { bold: true };

    sheet.getColumn(6).numFmt = '$#,##0.00';
    sheet.getColumn(7).numFmt = '$#,##0.00';
    sheet.getColumn(8).numFmt = '$#,##0.00';
}

function buildWasteSheet(sheet: ExcelJS.Worksheet, invoices: ExtractedInvoice[]) {
    if (invoices.length === 0) {
        sheet.addRow(['No waste invoices']);
        return;
    }

    const headers = ['Invoice Date', 'Supplier', 'Site Address', 'Service Type', 'Total (inc GST)'];
    sheet.addRow(headers);
    
    const headerRow = sheet.getRow(1);
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_COLOR } };
    headerRow.font = { color: { argb: 'FFFFFF' }, bold: true };

    invoices.forEach(inv => {
        sheet.addRow([
            inv.invoice_date || '',
            inv.supplier || '',
            inv.site_address || '',
            inv.tariff_type || '',
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

    invoices.forEach(inv => {
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

