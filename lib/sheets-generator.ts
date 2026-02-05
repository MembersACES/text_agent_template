import { google } from 'googleapis';
import { getGoogleAuthWrite } from './google-auth';
import { ReportData, ExtractedInvoice } from './report-types';

const HEADER_BG_COLOR = { red: 0.212, green: 0.376, blue: 0.573 }; // #366092
const TOTALS_BG_COLOR = { red: 1.0, green: 0.851, blue: 0.4 }; // #FFD966

export async function createBase1GoogleSheet(data: ReportData, folderId?: string): Promise<{ spreadsheetId: string; url: string }> {
    const auth = getGoogleAuthWrite();
    
    // Ensure JWT client has valid token
    await auth.authorize();
    
    const sheets = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth });

    // Verify auth is working
    console.log('[Sheets Generator] JWT auth client created');
    console.log('[Sheets Generator] Service account email:', process.env.GCP_CLIENT_EMAIL);
    console.log('[Sheets Generator] Auth scopes:', auth.scopes);
    console.log('[Sheets Generator] Auth credentials scope:', auth.credentials?.scope || 'Not available');
    
    // Test auth and check quota info
    try {
        const about = await drive.about.get({ fields: 'user,storageQuota' });
        console.log('[Sheets Generator] Drive API test successful - authenticated as:', about.data.user?.emailAddress);
        
        // Log quota information if available
        if (about.data.storageQuota) {
            const quota = about.data.storageQuota;
            const limit = quota.limit ? parseInt(quota.limit, 10) : 0;
            const usage = quota.usage ? parseInt(quota.usage, 10) : 0;
            const usageInDrive = quota.usageInDrive ? parseInt(quota.usageInDrive, 10) : 0;
            const limitMB = (limit / (1024 * 1024)).toFixed(2);
            const usageMB = (usage / (1024 * 1024)).toFixed(2);
            const usageInDriveMB = (usageInDrive / (1024 * 1024)).toFixed(2);
            
            console.log('[Sheets Generator] Storage quota info:');
            console.log(`  - Limit: ${limitMB} MB (${limit} bytes)`);
            console.log(`  - Total Usage: ${usageMB} MB (${usage} bytes)`);
            console.log(`  - Usage in Drive: ${usageInDriveMB} MB (${usageInDrive} bytes)`);
            
            if (limit > 0) {
                const percentUsed = ((usage / limit) * 100).toFixed(1);
                console.log(`  - Percent Used: ${percentUsed}%`);
            }
        }
    } catch (authTestError: any) {
        console.warn('[Sheets Generator] Drive API auth test failed:', authTestError?.message || authTestError);
        if (authTestError?.response) {
            console.warn('[Sheets Generator] Auth test error details:', JSON.stringify(authTestError.response.data, null, 2));
        }
    }
    
    console.log('[Sheets Generator] Creating spreadsheet via Drive API...');
    const spreadsheetTitle = `Base 1 Review - ${data.businessInfo.name} - ${new Date(data.generatedAt).toLocaleDateString()}`;
    console.log('[Sheets Generator] Spreadsheet title:', spreadsheetTitle);

    // Create new spreadsheet using Drive API (bypasses Sheets API permission issues)
    // Create directly in the target folder if provided to avoid quota issues
    let spreadsheetId: string;
    try {
        const createRequest: any = {
            requestBody: {
                name: spreadsheetTitle,
                mimeType: 'application/vnd.google-apps.spreadsheet',
            },
            fields: 'id',
        };
        
        // If folderId is provided, create directly in that folder to avoid quota issues
        if (folderId) {
            createRequest.requestBody.parents = [folderId];
            console.log('[Sheets Generator] Creating spreadsheet directly in folder:', folderId);
        }
        
        const file = await drive.files.create(createRequest);
        spreadsheetId = file.data.id!;
        console.log('[Sheets Generator] Spreadsheet created successfully via Drive API:', spreadsheetId);
    } catch (createError: any) {
        console.error('[Sheets Generator] ========== SPREADSHEET CREATION ERROR ==========');
        console.error('[Sheets Generator] Error type:', createError?.constructor?.name);
        console.error('[Sheets Generator] Error message:', createError?.message);
        console.error('[Sheets Generator] Error code:', createError?.code);
        console.error('[Sheets Generator] Error status:', createError?.status);
        
        // Log full error object
        if (createError?.response) {
            console.error('[Sheets Generator] Response status:', createError.response.status);
            console.error('[Sheets Generator] Response statusText:', createError.response.statusText);
            console.error('[Sheets Generator] Response data:', JSON.stringify(createError.response.data, null, 2));
            
            // Extract specific error details
            if (createError.response.data?.error) {
                const errorData = createError.response.data.error;
                console.error('[Sheets Generator] Error details:');
                console.error('  - Code:', errorData.code);
                console.error('  - Message:', errorData.message);
                if (errorData.errors) {
                    console.error('  - Errors:', JSON.stringify(errorData.errors, null, 2));
                }
            }
        }
        
        // Log config if available
        if (createError?.config) {
            console.error('[Sheets Generator] Request config:', {
                method: createError.config.method,
                url: createError.config.url,
                headers: Object.keys(createError.config.headers || {}),
            });
        }
        
        console.error('[Sheets Generator] Full error object:', JSON.stringify(createError, Object.getOwnPropertyNames(createError), 2));
        
        // If quota error, provide additional guidance
        if (createError?.response?.data?.error?.errors?.[0]?.reason === 'storageQuotaExceeded') {
            console.error('[Sheets Generator] ========== QUOTA TROUBLESHOOTING ==========');
            console.error('[Sheets Generator] Even though the file is created in a shared folder,');
            console.error('[Sheets Generator] Google Drive checks the service account quota during creation.');
            console.error('[Sheets Generator] Solutions:');
            console.error('  1. Wait a few minutes after emptying trash (quota updates may be delayed)');
            console.error('  2. Check if there are files in trash: Run cleanup endpoint again');
            console.error('  3. The folder owner may also need to free up space');
            console.error('  4. Service account may need additional storage quota from Google Workspace admin');
            console.error('[Sheets Generator] ===========================================');
        }
        
        console.error('[Sheets Generator] ===============================================');
        throw createError;
    }

    // Note: If folderId was provided, the spreadsheet was already created directly in that folder
    // This avoids storage quota issues by using the folder owner's storage space

    // Get spreadsheet data to find default sheet ID
    const spreadsheetData = await sheets.spreadsheets.get({ spreadsheetId });
    const defaultSheetId = spreadsheetData.data.sheets?.[0]?.properties?.sheetId;
    if (defaultSheetId !== undefined) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    deleteSheet: { sheetId: defaultSheetId },
                }],
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
    await populateOverviewSheet(sheets, spreadsheetId, sheetIds[0], data);
    
    const electricityInvoices = data.invoices.filter(i => i.utility_type === 'Electricity');
    const gasInvoices = data.invoices.filter(i => i.utility_type === 'Gas');
    const wasteInvoices = data.invoices.filter(i => i.utility_type === 'Waste');
    const waterInvoices = data.invoices.filter(i => i.utility_type === 'Water');

    await populateElectricitySheet(sheets, spreadsheetId, sheetIds[1], electricityInvoices);
    await populateGasSheet(sheets, spreadsheetId, sheetIds[2], gasInvoices);
    await populateWasteSheet(sheets, spreadsheetId, sheetIds[3], wasteInvoices);
    await populateWaterSheet(sheets, spreadsheetId, sheetIds[4], waterInvoices);
    await populateCostSummarySheet(sheets, spreadsheetId, sheetIds[5], data.invoices);
    await populateMeterDetailsSheet(sheets, spreadsheetId, sheetIds[6], data.invoices);
    await populateBase1AnalysisSheet(sheets, spreadsheetId, sheetIds[7], data);

    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
    return { spreadsheetId, url };
}

async function populateOverviewSheet(sheets: any, spreadsheetId: string, sheetId: number, data: ReportData) {
    const values = [
        ['Base 1 Review Report'],
        [],
        ['Business Name:', data.businessInfo.name],
        ...(data.businessInfo.address ? [['Address:', data.businessInfo.address]] : []),
        ['Report Generated:', new Date(data.generatedAt).toLocaleString()],
        ['Total Invoices Analyzed:', data.invoices.length.toString()],
        [],
        ['Summary'],
    ];

    const totalCost = data.invoices.reduce((sum, inv) => sum + (inv.total_inc_gst || 0), 0);
    values.push(['Total Annual Cost (est):', `$${totalCost.toFixed(2)}`]);

    if (data.savingsSummary) {
        values.push(
            ['Potential Savings (Conservative):', `$${data.savingsSummary.conservative.toFixed(2)}`],
            ['Potential Savings (Moderate):', `$${data.savingsSummary.moderate.toFixed(2)}`],
            ['Potential Savings (Optimistic):', `$${data.savingsSummary.optimistic.toFixed(2)}`]
        );
    }

    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Overview!A1:B${values.length}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
    });

    // Format header
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
            requests: [
                {
                    repeatCell: {
                        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                        cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 16 } } },
                        fields: 'userEnteredFormat.textFormat',
                    },
                },
            ],
        },
    });
}

async function populateElectricitySheet(sheets: any, spreadsheetId: string, sheetId: number, invoices: ExtractedInvoice[]) {
    if (invoices.length === 0) {
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'Electricity Data!A1',
            valueInputOption: 'RAW',
            requestBody: { values: [['No electricity invoices']] },
        });
        return;
    }

    // Check if any invoice has shoulder data (optional - some states don't have shoulder)
    const hasShoulder = invoices.some(inv => 
        (inv.shoulder_usage_kwh !== null && inv.shoulder_usage_kwh !== undefined) ||
        (inv.shoulder_rate_c_per_kwh !== null && inv.shoulder_rate_c_per_kwh !== undefined)
    );

    // Headers - conditionally include shoulder columns
    const headers = ['Invoice Date', 'Supplier', 'NMI', 'Site Address', 'Peak Usage (kWh)'];
    if (hasShoulder) {
        headers.push('Shoulder Usage (kWh)');
    }
    headers.push('Off-Peak Usage (kWh)', 'Peak Rate (c/kWh)');
    if (hasShoulder) {
        headers.push('Shoulder Rate (c/kWh)');
    }
    headers.push('Off-Peak Rate (c/kWh)', 'Daily Supply ($)', 'Total (inc GST)', 
                 'Demand (kW/kVA)', 'Demand Charges ($)', 'Meter Charges ($)', 'Total Usage (kWh)');
    
    const values = [headers];
    invoices.forEach(inv => {
        const row: any[] = [
            inv.invoice_date || '',
            inv.supplier || '',
            inv.nmi || '',
            inv.site_address || '',
            (inv.peak_usage_kwh || 0).toString(),
        ];
        
        if (hasShoulder) {
            row.push((inv.shoulder_usage_kwh || 0).toString());
        }
        
        row.push(
            (inv.off_peak_usage_kwh || 0).toString(),
            (inv.peak_rate_c_per_kwh ?? '').toString(),
        );
        
        if (hasShoulder) {
            row.push((inv.shoulder_rate_c_per_kwh ?? '').toString());
        }
        
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

    // Add totals row
    const totalRow: any[] = [
        'TOTAL', '', '', '',
        invoices.reduce((sum, inv) => sum + (inv.peak_usage_kwh || 0), 0).toString(),
    ];
    
    if (hasShoulder) {
        totalRow.push(invoices.reduce((sum, inv) => sum + (inv.shoulder_usage_kwh || 0), 0).toString());
    }
    
    totalRow.push(
        invoices.reduce((sum, inv) => sum + (inv.off_peak_usage_kwh || 0), 0).toString(),
        '', // Peak rate column
    );
    
    if (hasShoulder) {
        totalRow.push(''); // Shoulder rate column
    }
    
    totalRow.push(
        '', // Off-peak rate column
        invoices.reduce((sum, inv) => sum + (inv.daily_supply_charge || 0), 0).toString(),
        invoices.reduce((sum, inv) => sum + (inv.total_inc_gst || 0), 0).toString(),
    );
    
    values.push(totalRow);

    // Determine range based on whether shoulder is present
    const lastCol = hasShoulder ? 'L' : 'J';
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Electricity Data!A1:${lastCol}${values.length}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
    });

    // Format header and totals
    await formatSheetHeaderAndTotals(sheets, spreadsheetId, sheetId, values.length - 1);
}

async function populateGasSheet(sheets: any, spreadsheetId: string, sheetId: number, invoices: ExtractedInvoice[]) {
    if (invoices.length === 0) {
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'Gas Data!A1',
            valueInputOption: 'RAW',
            requestBody: { values: [['No gas invoices']] },
        });
        return;
    }

    const headers = ['Invoice Date', 'Supplier', 'MRIN', 'Site Address', 'Usage (GJ)', 
                    'Rate ($/GJ)', 'Daily Supply ($)', 'Total (inc GST)'];
    
    const values = [headers];
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

    await formatSheetHeaderAndTotals(sheets, spreadsheetId, sheetId, values.length - 1);
}

async function populateWasteSheet(sheets: any, spreadsheetId: string, sheetId: number, invoices: ExtractedInvoice[]) {
    if (invoices.length === 0) {
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'Waste Data!A1',
            valueInputOption: 'RAW',
            requestBody: { values: [['No waste invoices']] },
        });
        return;
    }

    const headers = ['Invoice Date', 'Supplier', 'Site Address', 'Service Type', 'Frequency', 
                    'Unit Cost', 'Total (ex GST)', 'GST', 'Total (inc GST)'];
    
    const values = [headers];
    
    // Check if any invoice has waste_services array
    const hasServiceBreakdown = invoices.some(inv => inv.waste_services && inv.waste_services.length > 0);

    if (hasServiceBreakdown) {
        // Output one row per service
        invoices.forEach(inv => {
            if (inv.waste_services && inv.waste_services.length > 0) {
                inv.waste_services.forEach((service, index) => {
                    const gstAmount = service.total_cost ? service.total_cost * 0.1 : null;
                    const totalIncGst = service.total_cost ? service.total_cost * 1.1 : null;
                    
                    values.push([
                        index === 0 ? (inv.invoice_date || '') : '', // Only show date on first service row
                        index === 0 ? (inv.supplier || '') : '',     // Only show supplier on first service row
                        index === 0 ? (inv.site_address || '') : '', // Only show address on first service row
                        service.service_type || '',
                        (service.frequency ?? '').toString(),
                        (service.unit_cost ?? '').toString(),
                        (service.total_cost ?? '').toString(),
                        (gstAmount ?? '').toString(),
                        (totalIncGst ?? '').toString(),
                    ]);
                });
            } else {
                // Fallback: single row if no service breakdown
                values.push([
                    inv.invoice_date || '',
                    inv.supplier || '',
                    inv.site_address || '',
                    inv.tariff_type || '',
                    '',
                    '',
                    (inv.total_charges_ex_gst ?? '').toString(),
                    (inv.gst_amount ?? '').toString(),
                    (inv.total_inc_gst || 0).toString(),
                ]);
            }
        });
    } else {
        // Fallback: single row per invoice if no service breakdown
        invoices.forEach(inv => {
            values.push([
                inv.invoice_date || '',
                inv.supplier || '',
                inv.site_address || '',
                inv.tariff_type || '',
                '',
                '',
                (inv.total_charges_ex_gst ?? '').toString(),
                (inv.gst_amount ?? '').toString(),
                (inv.total_inc_gst || 0).toString(),
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

    values.push([
        'TOTAL', '', '', '', '', '',
        totalExGst.toString(),
        totalGst.toString(),
        totalIncGst.toString(),
    ]);

    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Waste Data!A1:I${values.length}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
    });

    await formatSheetHeaderAndTotals(sheets, spreadsheetId, sheetId, values.length - 1);
}

async function populateWaterSheet(sheets: any, spreadsheetId: string, sheetId: number, invoices: ExtractedInvoice[]) {
    if (invoices.length === 0) {
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'Water Data!A1',
            valueInputOption: 'RAW',
            requestBody: { values: [['No water invoices']] },
        });
        return;
    }

    const headers = ['Invoice Date', 'Supplier', 'Site Address', 'Usage (kL)', 'Total (inc GST)'];
    const values = [headers];
    
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

    await formatSheetHeaderAndTotals(sheets, spreadsheetId, sheetId, values.length - 1);
}

async function populateCostSummarySheet(sheets: any, spreadsheetId: string, sheetId: number, invoices: ExtractedInvoice[]) {
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

    await formatSheetHeaderAndTotals(sheets, spreadsheetId, sheetId, values.length - 1);
}

async function populateMeterDetailsSheet(sheets: any, spreadsheetId: string, sheetId: number, invoices: ExtractedInvoice[]) {
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

    await formatSheetHeader(sheets, spreadsheetId, sheetId);
}

async function populateBase1AnalysisSheet(sheets: any, spreadsheetId: string, sheetId: number, data: ReportData) {
    const values = [
        ['Benchmarking Results'],
        [],
        ['Category', 'Issue Type', 'Flag', 'Current Rate/Cost', 'Market Benchmark', 'Potential Annual Savings'],
    ];

    data.invoices.forEach(inv => {
        if (inv.low_hanging_fruit && inv.low_hanging_fruit.length > 0) {
            inv.low_hanging_fruit.forEach(opp => {
                const flag = opp.severity === 'high' ? '🔴' : opp.severity === 'medium' ? '🟡' : '🟢';
                values.push([
                    inv.utility_type,
                    opp.type,
                    flag,
                    '',
                    '',
                    opp.potential_savings || '',
                ]);
            });
        }
    });

    values.push([]);
    values.push(['Total Potential Savings']);

    if (data.savingsSummary) {
        values.push(
            ['Conservative Estimate (70%):', `$${data.savingsSummary.conservative.toFixed(2)}`],
            ['Moderate Estimate (85%):', `$${data.savingsSummary.moderate.toFixed(2)}`],
            ['Optimistic Estimate (100%):', `$${data.savingsSummary.optimistic.toFixed(2)}`]
        );
    }

    if (data.savingsSummary && data.savingsSummary.criticalIssues.length > 0) {
        values.push([]);
        values.push(['🔴 CRITICAL ISSUES']);
        data.savingsSummary.criticalIssues.forEach(issue => {
            values.push([issue.issue, `$${issue.savings.toFixed(2)}/year`]);
        });
    }

    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Base 1 Analysis!A1:B${values.length}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
    });

    await formatSheetHeader(sheets, spreadsheetId, sheetId);
}

async function formatSheetHeader(sheets: any, spreadsheetId: string, sheetId: number) {
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
            ],
        },
    });
}

async function formatSheetHeaderAndTotals(sheets: any, spreadsheetId: string, sheetId: number, totalsRowIndex: number) {
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

