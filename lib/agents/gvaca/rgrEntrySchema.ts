/** Discriminator for API/UI — RGR structured records vs other extractedData (e.g. invoices). */
export const GVACA_RGR_ENTRY_SCHEMA = 'gvaca_rgr_entry_v1' as const;

export type GvacaRgrInteractionType =
    | 'patron_observation'
    | 'id_check'
    | 'self_exclusion_check'
    | 'yourplay_issue'
    | 'positive_interaction'
    | 'other';

export type GvacaRgrFollowUpDelegate =
    | 'Gaming Manager'
    | 'Chef'
    | 'Operations'
    | 'HR'
    | 'External';

export interface GvacaRgrEntryV1 {
    schema: typeof GVACA_RGR_ENTRY_SCHEMA;
    /** Tenant/venue key for storage partitioning (never omit on new writes). */
    venue_id: string;
    /** Server timestamp when the tool recorded the entry (ISO 8601 UTC). */
    recorded_at_utc: string;
    entry_date: string;
    /** Time this log line is being recorded (HH:MM), often “now” for the duty manager. */
    entry_time: string;
    /**
     * When the observation/incident actually occurred (HH:MM), if different from entry_time
     * (e.g. retrospective gap closure or late logging).
     */
    incident_time?: string;
    staff_name: string;
    interaction_type: GvacaRgrInteractionType | string;
    description: string;
    action_taken: string;
    follow_up_required: boolean;
    follow_up_delegate: string;
    follow_up_detail: string;
}

export const RGR_INTERACTION_TYPES: GvacaRgrInteractionType[] = [
    'patron_observation',
    'id_check',
    'self_exclusion_check',
    'yourplay_issue',
    'positive_interaction',
    'other',
];

export const RGR_FOLLOW_UP_DELEGATES: GvacaRgrFollowUpDelegate[] = [
    'Gaming Manager',
    'Chef',
    'Operations',
    'HR',
    'External',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Full payload check for API persistence and chat UI recognition. */
export function isGvacaRgrEntryV1(value: unknown): value is GvacaRgrEntryV1 {
    if (typeof value !== 'object' || value === null) return false;
    const o = value as Record<string, unknown>;
    if (o.schema !== GVACA_RGR_ENTRY_SCHEMA) return false;
    if (typeof o.venue_id !== 'string' || o.venue_id.length === 0) return false;
    if (typeof o.recorded_at_utc !== 'string' || o.recorded_at_utc.length === 0) return false;
    if (typeof o.entry_date !== 'string' || !DATE_RE.test(o.entry_date)) return false;
    if (typeof o.entry_time !== 'string' || o.entry_time.length === 0) return false;
    if (o.incident_time !== undefined && typeof o.incident_time !== 'string') return false;
    if (typeof o.staff_name !== 'string' || o.staff_name.length === 0) return false;
    if (typeof o.interaction_type !== 'string' || o.interaction_type.length === 0) return false;
    if (typeof o.description !== 'string' || o.description.length === 0) return false;
    if (typeof o.action_taken !== 'string') return false;
    if (typeof o.follow_up_required !== 'boolean') return false;
    if (typeof o.follow_up_delegate !== 'string') return false;
    if (typeof o.follow_up_detail !== 'string') return false;
    return true;
}
