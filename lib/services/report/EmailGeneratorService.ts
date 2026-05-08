import { ReportData, getSavingsEligibleOpportunities } from '@/lib/types/ReportTypes';

/** One-line summary for client-facing email (Base 1 estimate). */
function shortIssueSummary(issue: string, maxLen = 80): string {
    const trimmed = (issue || '').trim();
    const firstSentence = trimmed.split(/[.!?]/)[0]?.trim() || trimmed;
    if (firstSentence.length <= maxLen) return firstSentence;
    return firstSentence.slice(0, maxLen).trim() + '…';
}

export class EmailGeneratorService {
    generateEmail(data: ReportData): string {
        const { businessInfo, invoices, savingsSummary, generatedAt } = data;

        const invoicesByType = invoices.reduce((acc, inv) => {
            const type = inv.utility_type || 'Other';
            if (!acc[type]) acc[type] = { count: 0, totalCost: 0 };
            acc[type].count++;
            acc[type].totalCost += inv.total_inc_gst || 0;
            return acc;
        }, {} as Record<string, { count: number; totalCost: number }>);

        const memberFacingOpportunities = getSavingsEligibleOpportunities(invoices, {
            hideWasteForMemberReport: true,
        });
        const opportunityCount = memberFacingOpportunities.length;
        const utilityTypesWithIssues = [...new Set(memberFacingOpportunities.map(o => o.utilityType))];
        const summaryAreas = utilityTypesWithIssues.length > 0
            ? utilityTypesWithIssues.slice(0, 4).join(', ') + (utilityTypesWithIssues.length > 4 ? ' and others' : '')
            : 'your utilities';

        const formatCurrency = (amount: number) =>
            new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

        const formatDate = (dateString: string) => {
            try {
                return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(dateString));
            } catch { return dateString; }
        };

        const invoiceSummaryRows = Object.entries(invoicesByType)
            .map(([type, stats]) => `
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid #e0e0e0;">${type}</td>
                <td style="padding: 8px; border-bottom: 1px solid #e0e0e0; text-align: center;">${stats.count}</td>
                <td style="padding: 8px; border-bottom: 1px solid #e0e0e0; text-align: right;">${formatCurrency(stats.totalCost)}</td>
            </tr>`).join('');

        const criticalIssues = savingsSummary?.criticalIssues || [];
        const maxCriticalInEmail = 3;
        const criticalToShow = criticalIssues.slice(0, maxCriticalInEmail);
        const criticalIssuesList = criticalToShow.length > 0
            ? criticalToShow.map(issue => `
                <li style="margin-bottom: 8px; padding-left: 8px; font-size: 14px;">
                    ${shortIssueSummary(issue.issue)} — ${formatCurrency(issue.savings)}/year
                </li>`).join('')
            : '<li style="margin-bottom: 8px; padding-left: 8px; color: #666;">No critical issues identified.</li>';
        const moreIssuesNote = criticalIssues.length > maxCriticalInEmail
            ? `<p style="margin: 8px 0 0 0; font-size: 13px; color: #666;">Full details and ${criticalIssues.length - maxCriticalInEmail} additional item(s) are in the attached report.</p>`
            : '';

        return `
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
                    <tr>
                        <td style="background-color: #366092; padding: 30px 40px; text-align: center;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold;">ACES Solutions</h1>
                            <p style="margin: 8px 0 0 0; color: #e3f2fd; font-size: 16px;">Base 1 Review Report</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px 40px 20px 40px;">
                            <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #333333;">Dear ${businessInfo.name},</p>
                            <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #333333;">Thank you for providing your utility invoices. Please find below a <strong>high-level Base 1 estimate</strong> and your attached report for full detail.</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 40px 20px 40px;">
                            <h2 style="margin: 0 0 16px 0; font-size: 20px; color: #366092; border-bottom: 2px solid #366092; padding-bottom: 8px;">Invoice Summary</h2>
                            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; margin-bottom: 24px;">
                                <thead>
                                    <tr style="background-color: #f5f5f5;">
                                        <th style="padding: 12px 8px; text-align: left; border-bottom: 2px solid #366092; font-weight: bold; color: #333333;">Utility Type</th>
                                        <th style="padding: 12px 8px; text-align: center; border-bottom: 2px solid #366092; font-weight: bold; color: #333333;">Count</th>
                                        <th style="padding: 12px 8px; text-align: right; border-bottom: 2px solid #366092; font-weight: bold; color: #333333;">Total Cost</th>
                                    </tr>
                                </thead>
                                <tbody>${invoiceSummaryRows}</tbody>
                            </table>
                        </td>
                    </tr>
                    ${opportunityCount > 0 ? `
                    <tr>
                        <td style="padding: 0 40px 20px 40px;">
                            <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #333333;">We identified <strong>${opportunityCount} potential savings opportunities</strong> across ${summaryAreas}. The attached report contains the full breakdown; below is a high-level estimate and the main items to address.</p>
                        </td>
                    </tr>` : ''}
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
                    </tr>` : ''}
                    ${criticalToShow.length > 0 ? `
                    <tr>
                        <td style="padding: 0 40px 20px 40px;">
                            <div style="background-color: #ffebee; border-left: 4px solid #d32f2f; padding: 20px; margin-bottom: 24px;">
                                <h3 style="margin: 0 0 12px 0; font-size: 18px; color: #d32f2f;">Key items to address</h3>
                                <ul style="margin: 0; padding-left: 20px; color: #333333; font-size: 15px; line-height: 1.6;">${criticalIssuesList}</ul>${moreIssuesNote}
                            </div>
                        </td>
                    </tr>` : ''}
                    <tr>
                        <td style="padding: 0 40px 30px 40px;">
                            <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #333333;">We recommend scheduling a consultation to discuss these findings in detail and develop a customized action plan to maximize your savings.</p>
                            <div style="background-color: #f8f9fa; border-left: 4px solid #366092; padding: 20px; margin: 24px 0; border-radius: 4px;">
                                <h3 style="margin: 0 0 12px 0; font-size: 18px; color: #366092;">Next Steps</h3>
                                <p style="margin: 0 0 12px 0; font-size: 16px; line-height: 1.6; color: #333333;">To proceed, please find attached our <strong>Letter of Authority Document</strong> and <strong>Service Fee Agreement Documents</strong>.</p>
                                <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #333333;">The Letter of Authority enables us to speak with your current providers to obtain contract and usage information, allowing us to provide actual quotes rather than estimates. The Service Fee Agreement outlines our fee structure, which is the first month's savings for any service or goods we bring in and/or 20% of new revenues we bring in.</p>
                            </div>
                            <p style="margin: 16px 0 0 0; font-size: 16px; line-height: 1.6; color: #333333;">Please don't hesitate to contact us if you have any questions or would like to proceed with implementing these recommendations.</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color: #f5f5f5; padding: 20px 40px; text-align: center; border-top: 1px solid #e0e0e0;">
                            <p style="margin: 0 0 8px 0; font-size: 12px; color: #666666;">Report generated: ${formatDate(generatedAt)}</p>
                            <p style="margin: 0 0 4px 0; font-size: 14px; font-weight: bold; color: #333333;">Australian Circular Economy Solution</p>
                            <p style="margin: 0 0 4px 0; font-size: 12px; color: #666666;">470 St Kilda Road, Melbourne VIC 3004</p>
                            <p style="margin: 0; font-size: 12px; color: #666666;">Ph: 1300 938 638 | Website: <a href="https://acesolutions.com.au" style="color: #366092; text-decoration: none;">acesolutions.com.au</a></p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`.trim();
    }
}

export const emailGeneratorService = new EmailGeneratorService();
