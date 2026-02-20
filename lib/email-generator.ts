import { ReportData } from './report-types';

/**
 * Generate a professional HTML email body for invoice report
 * Returns a self-contained HTML string with inline styles for email client compatibility
 */
export function generateReportEmail(data: ReportData): string {
    const { businessInfo, invoices, savingsSummary, generatedAt } = data;

    // Group invoices by utility type
    const invoicesByType = invoices.reduce((acc, inv) => {
        const type = inv.utility_type || 'Other';
        if (!acc[type]) {
            acc[type] = {
                count: 0,
                totalCost: 0,
            };
        }
        acc[type].count++;
        acc[type].totalCost += inv.total_inc_gst || 0;
        return acc;
    }, {} as Record<string, { count: number; totalCost: number }>);

    // Collect all savings opportunities, sorted by severity
    const allOpportunities = invoices
        .flatMap(inv => (inv.low_hanging_fruit || []).map(opp => ({
            ...opp,
            utilityType: inv.utility_type,
        })))
        .sort((a, b) => {
            const severityOrder = { high: 0, medium: 1, low: 2 };
            return severityOrder[a.severity] - severityOrder[b.severity];
        });

    // Format currency
    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-AU', {
            style: 'currency',
            currency: 'AUD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(amount);
    };

    // Format date
    const formatDate = (dateString: string) => {
        try {
            const date = new Date(dateString);
            return new Intl.DateTimeFormat('en-AU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            }).format(date);
        } catch {
            return dateString;
        }
    };

    // Build invoice summary table rows
    const invoiceSummaryRows = Object.entries(invoicesByType)
        .map(([type, stats]) => `
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid #e0e0e0;">${type}</td>
                <td style="padding: 8px; border-bottom: 1px solid #e0e0e0; text-align: center;">${stats.count}</td>
                <td style="padding: 8px; border-bottom: 1px solid #e0e0e0; text-align: right;">${formatCurrency(stats.totalCost)}</td>
            </tr>
        `)
        .join('');

    // Build savings opportunities table rows
    const savingsRows = allOpportunities
        .map(opp => `
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid #e0e0e0;">
                    <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${
                        opp.severity === 'high' ? '#d32f2f' : opp.severity === 'medium' ? '#f57c00' : '#388e3c'
                    }; margin-right: 8px;"></span>
                    ${opp.type}
                </td>
                <td style="padding: 8px; border-bottom: 1px solid #e0e0e0;">${opp.message}</td>
                <td style="padding: 8px; border-bottom: 1px solid #e0e0e0; text-align: right; font-weight: bold;">${opp.potential_savings || 'N/A'}</td>
            </tr>
        `)
        .join('');

    // Get critical issues (high severity only)
    const criticalIssues = savingsSummary?.criticalIssues || [];

    // Build critical issues list
    const criticalIssuesList = criticalIssues.length > 0
        ? criticalIssues
            .map(issue => `
                <li style="margin-bottom: 12px; padding-left: 8px;">
                    <strong>${issue.issue}</strong> - Potential savings: ${formatCurrency(issue.savings)}/year
                </li>
            `)
            .join('')
        : '<li style="margin-bottom: 12px; padding-left: 8px; color: #666;">No critical issues identified.</li>';

    // Build HTML email
    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Base 1 Review Report - ${businessInfo.name}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px 0;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <!-- Header -->
                    <tr>
                        <td style="background-color: #366092; padding: 30px 40px; text-align: center;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold;">ACES Solutions</h1>
                            <p style="margin: 8px 0 0 0; color: #e3f2fd; font-size: 16px;">Base 1 Review Report</p>
                        </td>
                    </tr>
                    
                    <!-- Greeting -->
                    <tr>
                        <td style="padding: 30px 40px 20px 40px;">
                            <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #333333;">
                                Dear ${businessInfo.name},
                            </p>
                            <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #333333;">
                                Thank you for providing your utility invoices for analysis. We've completed a comprehensive review and identified several opportunities to reduce your utility costs.
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Invoice Summary -->
                    <tr>
                        <td style="padding: 0 40px 20px 40px;">
                            <h2 style="margin: 0 0 16px 0; font-size: 20px; color: #366092; border-bottom: 2px solid #366092; padding-bottom: 8px;">
                                Invoice Summary
                            </h2>
                            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; margin-bottom: 24px;">
                                <thead>
                                    <tr style="background-color: #f5f5f5;">
                                        <th style="padding: 12px 8px; text-align: left; border-bottom: 2px solid #366092; font-weight: bold; color: #333333;">Utility Type</th>
                                        <th style="padding: 12px 8px; text-align: center; border-bottom: 2px solid #366092; font-weight: bold; color: #333333;">Count</th>
                                        <th style="padding: 12px 8px; text-align: right; border-bottom: 2px solid #366092; font-weight: bold; color: #333333;">Total Cost</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${invoiceSummaryRows}
                                </tbody>
                            </table>
                        </td>
                    </tr>
                    
                    <!-- Savings Opportunities -->
                    ${allOpportunities.length > 0 ? `
                    <tr>
                        <td style="padding: 0 40px 20px 40px;">
                            <h2 style="margin: 0 0 16px 0; font-size: 20px; color: #366092; border-bottom: 2px solid #366092; padding-bottom: 8px;">
                                Savings Opportunities
                            </h2>
                            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; margin-bottom: 24px;">
                                <thead>
                                    <tr style="background-color: #f5f5f5;">
                                        <th style="padding: 12px 8px; text-align: left; border-bottom: 2px solid #366092; font-weight: bold; color: #333333;">Type</th>
                                        <th style="padding: 12px 8px; text-align: left; border-bottom: 2px solid #366092; font-weight: bold; color: #333333;">Description</th>
                                        <th style="padding: 12px 8px; text-align: right; border-bottom: 2px solid #366092; font-weight: bold; color: #333333;">Potential Savings</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${savingsRows}
                                </tbody>
                            </table>
                        </td>
                    </tr>
                    ` : ''}
                    
                    <!-- Estimated Annual Savings -->
                    ${savingsSummary ? `
                    <tr>
                        <td style="padding: 0 40px 20px 40px;">
                            <div style="background-color: #e3f2fd; border-left: 4px solid #366092; padding: 20px; margin-bottom: 24px;">
                                <h3 style="margin: 0 0 12px 0; font-size: 18px; color: #366092;">Estimated Annual Savings</h3>
                                <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #333333;">
                                    Based on our analysis, we estimate potential annual savings in the range of 
                                    <strong style="color: #366092;">${formatCurrency(savingsSummary.conservative)}</strong> to 
                                    <strong style="color: #366092;">${formatCurrency(savingsSummary.moderate)}</strong>.
                                </p>
                            </div>
                        </td>
                    </tr>
                    ` : ''}
                    
                    <!-- Critical Issues -->
                    ${criticalIssues.length > 0 ? `
                    <tr>
                        <td style="padding: 0 40px 20px 40px;">
                            <div style="background-color: #ffebee; border-left: 4px solid #d32f2f; padding: 20px; margin-bottom: 24px;">
                                <h3 style="margin: 0 0 12px 0; font-size: 18px; color: #d32f2f;">Critical Issues Requiring Attention</h3>
                                <ul style="margin: 0; padding-left: 20px; color: #333333; font-size: 15px; line-height: 1.8;">
                                    ${criticalIssuesList}
                                </ul>
                            </div>
                        </td>
                    </tr>
                    ` : ''}
                    
                    <!-- Call to Action -->
                    <tr>
                        <td style="padding: 0 40px 30px 40px;">
                            <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #333333;">
                                We recommend scheduling a consultation to discuss these findings in detail and develop a customized action plan to maximize your savings.
                            </p>
                            <div style="background-color: #f8f9fa; border-left: 4px solid #366092; padding: 20px; margin: 24px 0; border-radius: 4px;">
                                <h3 style="margin: 0 0 12px 0; font-size: 18px; color: #366092;">Next Steps</h3>
                                <p style="margin: 0 0 12px 0; font-size: 16px; line-height: 1.6; color: #333333;">
                                    To proceed, please find attached our <strong>Letter of Authority Document</strong> and <strong>Service Fee Agreement Documents</strong>.
                                </p>
                                <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #333333;">
                                    The Letter of Authority enables us to speak with your current providers to obtain contract and usage information, allowing us to provide actual quotes rather than estimates. The Service Fee Agreement outlines our fee structure, which is the first month's savings for any service or goods we bring in and/or 20% of new revenues we bring in.
                                </p>
                            </div>
                            <p style="margin: 16px 0 0 0; font-size: 16px; line-height: 1.6; color: #333333;">
                                Please don't hesitate to contact us if you have any questions or would like to proceed with implementing these recommendations.
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f5f5f5; padding: 20px 40px; text-align: center; border-top: 1px solid #e0e0e0;">
                            <p style="margin: 0 0 8px 0; font-size: 12px; color: #666666;">
                                Report generated: ${formatDate(generatedAt)}
                            </p>
                            <p style="margin: 0 0 4px 0; font-size: 14px; font-weight: bold; color: #333333;">
                                Australian Circular Economy Solution
                            </p>
                            <p style="margin: 0 0 4px 0; font-size: 12px; color: #666666;">
                                470 St Kilda Road, Melbourne VIC 3004
                            </p>
                            <p style="margin: 0; font-size: 12px; color: #666666;">
                                Ph: 1300 938 638 | Website: <a href="https://acesolutions.com.au" style="color: #366092; text-decoration: none;">acesolutions.com.au</a>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `.trim();

    return html;
}

