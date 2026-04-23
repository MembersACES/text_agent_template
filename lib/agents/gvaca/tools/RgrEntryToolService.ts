/**
 * GVACA Responsible Gambling Register — structured log line via Gemini function call.
 * Produces audit-friendly JSON (timestamped server-side) for storage and regulator-facing exports.
 */

import { FunctionDeclarationsTool, SchemaType } from '@google/generative-ai';
import {
    GVACA_RGR_ENTRY_SCHEMA,
    GvacaRgrEntryV1,
    RGR_FOLLOW_UP_DELEGATES,
    RGR_INTERACTION_TYPES,
} from '@/lib/agents/gvaca/rgrEntrySchema';
import { resolveVenueIdForRequest } from '@/lib/agents/gvaca/venueContext';
import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';
import { AgentTool, ToolExecutionParams, ToolExecutionResult, ToolMetadata } from '@/lib/services/tools/AgentTool';

const logger = getLogger('RgrEntryToolService');

function normalizeInteractionType(raw: string): string {
    const s = raw.trim().toLowerCase().replace(/\s+/g, '_');
    const match = RGR_INTERACTION_TYPES.find((t) => t === s);
    if (match) return match;
    const legacy = raw.trim().toLowerCase();
    if (legacy.includes('self') && legacy.includes('exclusion')) return 'self_exclusion_check';
    if (legacy.includes('yourplay') || legacy.includes('your play')) return 'yourplay_issue';
    return 'other';
}

function normalizeDelegate(raw: string, followUpRequired: boolean): string {
    if (!followUpRequired) return '';
    const trimmed = raw.trim();
    const found = RGR_FOLLOW_UP_DELEGATES.find((d) => d.toLowerCase() === trimmed.toLowerCase());
    if (found) return found;
    return trimmed || 'Operations';
}

/** Request-scoped venue (body/header + env default), then optional model-supplied fallback only if still empty. */
function resolveRecordVenueId(params: ToolExecutionParams): string {
    return resolveVenueIdForRequest(params.venueId) || String(params.args.venue_id ?? '').trim();
}

export class RgrEntryToolService implements AgentTool {
    get metadata(): ToolMetadata {
        return {
            name: 'Record RGR entry',
            description:
                'Logs one Responsible Gambling Register line as structured data (venue, date, time, staff, interaction type, actions, follow-up). Call when the user has given enough detail to make a register entry.',
        };
    }

    get declaration(): FunctionDeclarationsTool {
        const interactionEnum = RGR_INTERACTION_TYPES.join(' | ');
        const delegateEnum = RGR_FOLLOW_UP_DELEGATES.join(' | ');
        return {
            functionDeclarations: [
                {
                    name: 'record_rgr_entry',
                    description:
                        'Record a single Responsible Gambling Register entry for audit and handover. ' +
                        'Call this when the conversation contains enough facts to log (who, when, what was observed, what was done). ' +
                        `interaction_type must be one of: ${interactionEnum}. ` +
                        `If follow_up_required is true, follow_up_delegate must be one of: ${delegateEnum}. ` +
                        'venue_id: omit unless the user explicitly stated a venue id that matches your org registry; the host usually supplies the venue. ' +
                        'After calling, still summarise in plain language for the staff member.',
                    parameters: {
                        type: SchemaType.OBJECT,
                        properties: {
                            venue_id: {
                                type: SchemaType.STRING,
                                description:
                                    'Optional. Venue identifier. Prefer leaving unset — the application sets this from the authenticated venue.',
                            },
                            entry_date: {
                                type: SchemaType.STRING,
                                description: 'Date of the observation or shift segment (YYYY-MM-DD).',
                            },
                            entry_time: {
                                type: SchemaType.STRING,
                                description: 'Time this log line is being recorded (24h HH:MM), often “now”.',
                            },
                            incident_time: {
                                type: SchemaType.STRING,
                                description:
                                    'Time the incident or observation actually occurred (HH:MM), if different from entry_time. ' +
                                    'Use for retrospective logging (e.g. observation at 2pm logged at 4pm). Omit if same as entry_time.',
                            },
                            staff_name: {
                                type: SchemaType.STRING,
                                description: 'Staff member making the entry or reporting the observation.',
                            },
                            interaction_type: {
                                type: SchemaType.STRING,
                                description: `One of: ${interactionEnum}`,
                            },
                            description: {
                                type: SchemaType.STRING,
                                description: 'What was observed or checked (register-ready narrative).',
                            },
                            action_taken: {
                                type: SchemaType.STRING,
                                description: 'Actions taken at the time, if any; use empty string if none.',
                            },
                            follow_up_required: {
                                type: SchemaType.BOOLEAN,
                                description: 'Whether another role must complete a follow-up task.',
                            },
                            follow_up_delegate: {
                                type: SchemaType.STRING,
                                description: `If follow_up_required: one of ${delegateEnum}. Otherwise empty string.`,
                            },
                            follow_up_detail: {
                                type: SchemaType.STRING,
                                description: 'Specific follow-up action; empty if follow_up_required is false.',
                            },
                        },
                        required: [
                            'entry_date',
                            'entry_time',
                            'staff_name',
                            'interaction_type',
                            'description',
                            'action_taken',
                            'follow_up_required',
                            'follow_up_delegate',
                            'follow_up_detail',
                        ],
                    },
                },
            ],
        };
    }

    canHandle(functionCallName: string): boolean {
        return functionCallName === 'record_rgr_entry';
    }

    async execute(params: ToolExecutionParams): Promise<ToolExecutionResult> {
        const a = params.args;
        const venue_id = resolveRecordVenueId(params);

        if (!venue_id) {
            logger.warn('record_rgr_entry rejected: no venue_id (set GVACA_DEFAULT_VENUE_ID or pass venueId on /api/chat)');
            return {
                toolResponse: {
                    status: 'error',
                    message:
                        'Cannot record RGR entry: no venue is configured. Set environment variable GVACA_DEFAULT_VENUE_ID or pass venueId in the chat request (or x-gvaca-venue-id header).',
                },
            };
        }

        const entry_date = String(a.entry_date ?? '').trim();
        const entry_time = String(a.entry_time ?? '').trim();
        const staff_name = String(a.staff_name ?? '').trim();
        const description = String(a.description ?? '').trim();
        const action_taken = String(a.action_taken ?? '').trim();
        const follow_up_required = Boolean(a.follow_up_required);

        if (!entry_date || !entry_time || !staff_name || !description) {
            logger.warn('record_rgr_entry missing required fields');
            return {
                toolResponse: {
                    status: 'error',
                    message: 'Missing required fields: entry_date, entry_time, staff_name, and description are required.',
                },
            };
        }

        const interaction_type = normalizeInteractionType(String(a.interaction_type ?? 'other'));
        const follow_up_delegate = normalizeDelegate(String(a.follow_up_delegate ?? ''), follow_up_required);
        const follow_up_detail = follow_up_required ? String(a.follow_up_detail ?? '').trim() : '';

        const incidentRaw = String(a.incident_time ?? '').trim();

        const recorded: GvacaRgrEntryV1 = {
            schema: GVACA_RGR_ENTRY_SCHEMA,
            venue_id,
            recorded_at_utc: new Date().toISOString(),
            entry_date,
            entry_time,
            staff_name,
            interaction_type,
            description,
            action_taken,
            follow_up_required,
            follow_up_delegate,
            follow_up_detail,
        };

        if (incidentRaw) {
            recorded.incident_time = incidentRaw;
        }

        logger.info(`Recorded RGR entry venue=${venue_id} ${entry_date} ${entry_time} (${interaction_type})`);

        let persisted = false;
        const base = settings.app.publicBaseUrl;
        if (base) {
            try {
                const res = await fetch(
                    `${base}/api/venues/${encodeURIComponent(venue_id)}/rgr-entries`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(recorded),
                    },
                );
                persisted = res.ok;
                if (!persisted) {
                    const errText = await res.text();
                    logger.warn(`RGR persistence HTTP ${res.status}: ${errText}`);
                }
            } catch (err) {
                logger.error(`[RgrEntryToolService] persistence failed: ${err}`);
            }
        } else {
            logger.warn('NEXT_PUBLIC_APP_URL not set — RGR entry not POSTed to /api/venues/.../rgr-entries');
        }

        return {
            toolResponse: {
                status: 'recorded',
                message: 'Entry captured as structured data for the compliance log.',
                entry: recorded,
                persisted,
            },
            extractedData: recorded,
        };
    }
}
