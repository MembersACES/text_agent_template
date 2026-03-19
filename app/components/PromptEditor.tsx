
'use client';

import { useState, useEffect } from 'react';

type KnowledgeSource = 'zoho' | 'drive' | 'both';

type AgentConfig = {
    model?: string;
    language?: string;
    kbFolderId?: string;
    allowFileUploads?: boolean;
    persona?: string;
    subtitle?: string;
    description?: string;
    internalNotes?: string;
    knowledgeSource?: KnowledgeSource;
    zohoDesk?: {
        enabled: boolean;
        publicPortalIds?: string[];
    };
};

export default function PromptEditor({ onSaveSuccess, agentId }: { onSaveSuccess?: () => void; agentId?: string }) {
    // State for Config
    const [systemPrompt, setSystemPrompt] = useState('');
    const [welcomeMessage, setWelcomeMessage] = useState('');
    const [agentName, setAgentName] = useState('');
    const [config, setConfig] = useState<AgentConfig>({
        model: 'Gemini 3.0 Flash',
        language: 'Multilingual',
    });

    // State for UI
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    // Accordion state - only one open at a time
    // Default: all sections collapsed when the agent page first loads
    const [expandedSection, setExpandedSection] = useState<'prompt' | 'knowledge' | 'agent' | null>(null);

    // Zoho portal ID input
    const [newPortalId, setNewPortalId] = useState('');

    // Zoho portal IDs: tool uses only the first two IDs (index 0 then index 1)
    const ZOHO_PORTAL_URL_GROUP = 'https://support.group.goodness.com.au/portal/en/kb/group-goodness';
    const ZOHO_PORTAL_URL_SUPPORT = 'https://support.goodness.com.au/portal/en/kb/contact-us-faqs';

    // KB Data
    interface KBFile {
        id: string;
        name: string;
        webViewLink?: string;
        modifiedTime: string;
        indexedAt?: string;
        chunkCount?: number;
        isStale?: boolean;
    }
    const [kbData, setKbData] = useState<{
        indexed: KBFile[],
        pending: KBFile[],
        removed: KBFile[]
    }>({ indexed: [], pending: [], removed: [] });
    const [updatingKB, setUpdatingKB] = useState(false);

    useEffect(() => {
        fetchConfig();
        fetchKB();
    }, [agentId]);

    const fetchKB = async () => {
        try {
            const url = agentId ? `/api/knowledge-base/index?agentId=${agentId}` : '/api/knowledge-base/index';
            const res = await fetch(url);
            const data = await res.json();
            if (data.indexed) {
                setKbData({
                    indexed: data.indexed,
                    pending: data.pending,
                    removed: data.removed
                });
            }
        } catch (error) {
            console.error('Failed to load KB files', error);
        }
    }

    const handleUpdateKB = async (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent accordion toggle
        setUpdatingKB(true);
        setMessage(null);
        try {
            const res = await fetch('/api/knowledge-base/index', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentId: agentId || undefined,
                    kbFolderId: config.kbFolderId || undefined,
                })
            });
            const data = await res.json();

            if (res.ok) {
                setMessage({ type: 'success', text: 'Knowledge base updated!' });
                fetchKB(); // Refresh list
                setTimeout(() => setMessage(null), 3000);
            } else {
                setMessage({ type: 'error', text: data.error || 'Update failed' });
            }
        } catch (error) {
            console.error('Failed to update KB', error);
            setMessage({ type: 'error', text: 'Update failed' });
        } finally {
            setUpdatingKB(false);
        }
    };

    const fetchConfig = async () => {
        try {
            const url = agentId ? `/api/prompt?agentId=${agentId}` : '/api/prompt';
            const res = await fetch(url);
            const data = await res.json();
            if (data.systemPrompt !== undefined) {
                setSystemPrompt(data.systemPrompt);
                setWelcomeMessage(data.welcomeMessage || '');
                setAgentName(data.agentName || '');
                if (data.config) {
                    setConfig(data.config);
                }
            } else if (data.template) {
                setSystemPrompt(data.template);
            }
        } catch (error) {
            console.error('Failed to load prompt config', error);
            setMessage({ type: 'error', text: 'Failed to load configuration' });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch('/api/prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemPrompt,
                    welcomeMessage,
                    agentName,
                    config,
                    // Ensure we save config for the correct agent, not always the default
                    agentId: agentId || undefined,
                }),
            });

            if (res.ok) {
                setMessage({ type: 'success', text: 'Saved successfully!' });
                if (onSaveSuccess) onSaveSuccess();
                setTimeout(() => setMessage(null), 2000);
            } else {
                setMessage({ type: 'error', text: 'Failed to save' });
            }
        } catch (error) {
            console.error('Failed to save', error);
            setMessage({ type: 'error', text: 'Failed to save' });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-full flex-col items-center justify-center p-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-700" />
            </div>
        );
    }

    const personaLabels: Record<string, string> = {
        support: 'Support',
        sales: 'Sales',
        operations: 'Operations',
        internal: 'Internal',
        review: 'Review / QA',
        custom: 'Custom',
    };
    const personaLabel = config.persona ? (personaLabels[config.persona] ?? 'Custom') : 'Not set';

    const knowledgeSummary = (() => {
        const hasDrive = !!config.kbFolderId;
        const hasZoho = !!config.zohoDesk?.enabled;
        if (hasDrive && hasZoho) return 'Drive + Zoho';
        if (hasDrive) return 'Drive only';
        if (hasZoho) return 'Zoho only';
        return 'Not configured';
    })();

    const effectiveKnowledgeSource: KnowledgeSource =
        config.knowledgeSource ??
        (config.zohoDesk?.enabled && config.kbFolderId
            ? 'both'
            : config.zohoDesk?.enabled
                ? 'zoho'
                : config.kbFolderId
                    ? 'drive'
                    : 'drive');

    const uploadsSummary = config.allowFileUploads ? 'Uploads on' : 'Uploads off';

    return (
        <div className="relative flex h-full min-h-0 w-full flex-col gap-4 p-4">

            {/* Header with primary name + Save button */}
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="flex flex-1 flex-col gap-2 min-w-[220px]">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-col">
                            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                                Step 1 · Agent configuration
                            </span>
                            <h2 className="text-[15px] font-semibold tracking-tight text-gray-900">Agent configuration</h2>
                        </div>
                    </div>
                    <div>
                        <label className="mb-1 block text-[11px] font-semibold text-gray-500">Agent name</label>
                        <input
                            type="text"
                            value={agentName}
                            onChange={(e) => setAgentName(e.target.value)}
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-[13px] text-gray-700 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300"
                            placeholder="e.g. Honest To Goodness Agent"
                        />
                    </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {message && (
                        <span className={`text-[11px] font-medium ${message.type === 'success' ? 'text-emerald-600' : 'text-red-500'}`}>
                            {message.text}
                        </span>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={saving || loading}
                        className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-800 shadow-sm transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                    >
                        {saving ? 'Saving…' : 'Save changes'}
                    </button>
                </div>
            </div>

            {/* Compact summary row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-gray-100 bg-white/80 px-3 py-2 text-[11px] text-gray-500">
                <span className="truncate">
                    <span className="font-semibold text-gray-700">Name:</span>{' '}
                    {agentName || 'Untitled agent'}
                </span>
                <span className="truncate">
                    <span className="font-semibold text-gray-700">Persona:</span>{' '}
                    {personaLabel}
                </span>
                <span className="truncate">
                    <span className="font-semibold text-gray-700">Language:</span>{' '}
                    {config.language || 'Multilingual'}
                </span>
                <span className="truncate">
                    <span className="font-semibold text-gray-700">Knowledge:</span>{' '}
                    {knowledgeSummary}
                </span>
                <span className="truncate">
                    <span className="font-semibold text-gray-700">Uploads:</span>{' '}
                    {uploadsSummary}
                </span>
            </div>

            {/* Prompt Config Section (Step 1 · Prompt) */}
            <div className="rounded-2xl border border-gray-200/60 bg-white">
                <div
                    className="group flex cursor-pointer items-center justify-between border-b border-gray-100/80 bg-white/90 px-4 py-3 transition-colors hover:bg-gray-50"
                    onClick={() => setExpandedSection(expandedSection === 'prompt' ? null : 'prompt')}
                >
                    <div className="flex items-center gap-2.5">
                        <svg
                            className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${expandedSection === 'prompt' ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                                Step 1
                            </p>
                            <h3 className="text-[13px] font-semibold tracking-tight text-gray-900">Agent-Specific Prompt</h3>
                            <p className="mt-0.5 text-[11px] text-gray-500">Added below the global system prompt.</p>
                        </div>
                    </div>
                    <span className="rounded-md bg-gray-50 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
                        {systemPrompt ? 'Customised' : 'Using default'}
                    </span>
                </div>

                {expandedSection === 'prompt' && (
                    <div className="animate-slide-down h-[360px] max-h-[70vh] overflow-y-auto p-0">
                        <textarea
                            value={systemPrompt}
                            onChange={(e) => setSystemPrompt(e.target.value)}
                            className="h-full w-full resize-none border-none bg-gray-50/40 p-5 font-mono text-[13px] leading-relaxed text-gray-800 outline-none placeholder-gray-300 focus:bg-white"
                            placeholder="Enter system prompt..."
                            spellCheck={false}
                        />
                    </div>
                )}
            </div>

            {/* Knowledge & Tools Section (Step 2 · Knowledge & tools) */}
            <div className="rounded-2xl border border-gray-200/60 bg-white">
                <div
                    className="group flex cursor-pointer items-center justify-between border-b border-gray-100/80 bg-white/90 px-4 py-3 transition-colors hover:bg-gray-50"
                    onClick={() => setExpandedSection(expandedSection === 'knowledge' ? null : 'knowledge')}
                >
                    <div className="flex flex-1 items-center gap-2.5">
                        <svg
                            className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${expandedSection === 'knowledge' ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <div className="flex flex-col">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                                Step 2
                            </p>
                            <h3 className="text-[13px] font-semibold tracking-tight text-gray-900">
                                Knowledge & Tools
                            </h3>
                        </div>
                    </div>
                    <span className="mr-2 rounded-md bg-gray-50 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
                        {knowledgeSummary}
                    </span>
                </div>

                {expandedSection === 'knowledge' && (
                    <div className="animate-slide-down flex h-[360px] max-h-[70vh] flex-col gap-4 bg-gray-50/40 p-4 pb-16 overflow-y-auto">
                        {/* Knowledge base type selector */}
                        <div>
                            <label className="mb-2 block text-[11px] font-semibold text-gray-500">
                                Knowledge base type
                            </label>
                            <div className="flex flex-wrap gap-2">
                                {(['drive', 'zoho', 'both'] as const).map((source) => (
                                    <button
                                        key={source}
                                        type="button"
                                        onClick={() => setConfig(prev => ({ ...prev, knowledgeSource: source }))}
                                        className={`rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors ${
                                            effectiveKnowledgeSource === source
                                                ? 'border-gray-900 bg-gray-900 text-white'
                                                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                                        }`}
                                    >
                                        {source === 'drive'
                                            ? 'Internally hosted (Google Drive)'
                                            : source === 'zoho'
                                                ? 'Zoho Knowledge Base'
                                                : 'Both'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {(effectiveKnowledgeSource === 'drive' || effectiveKnowledgeSource === 'both') && (
                            <>
                                {/* Google Drive knowledge base */}
                                <div>
                                    <label className="mb-1.5 block text-[11px] font-semibold text-gray-500">
                                        Google Drive folder ID (knowledge base)
                                    </label>
                                    <input
                                        type="text"
                                        value={config.kbFolderId || ''}
                                        onChange={(e) => setConfig(prev => ({ ...prev, kbFolderId: e.target.value || undefined }))}
                                        className="w-full rounded-lg border border-gray-200 bg-white p-2.5 text-[12px] text-gray-700 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300"
                                        placeholder="Override default GOOGLE_DRIVE_FOLDER_ID for this agent"
                                    />
                                    <p className="mt-1 text-[11px] text-gray-500">
                                        If set, this agent will index and query documents from the specified Drive folder ID. If left blank, it falls
                                        back to the global <code className="font-mono">GOOGLE_DRIVE_FOLDER_ID</code>.
                                    </p>
                                </div>

                                {/* GCS index status list */}
                                {(kbData.pending.length > 0 || kbData.indexed.some(f => f.isStale)) && (
                                    <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                                        <div className="rounded-md bg-amber-100 p-1.5 text-amber-700">
                                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                            </svg>
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-[12px] font-semibold text-amber-900">Knowledge base is out of sync</p>
                                            <p className="mt-0.5 text-[11px] text-amber-700">
                                                Click <span className="font-semibold">Update</span> to refresh with the latest Drive changes.
                                            </p>
                                        </div>
                                    </div>
                                )}

                                <div className="max-h-72 overflow-y-auto rounded-xl border border-gray-200/70 bg-white">
                            <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3.5 py-2.5">
                                <span className="text-[11px] text-gray-500">
                                    Drive knowledge base status
                                </span>
                                <button
                                    type="button"
                                    onClick={handleUpdateKB}
                                    disabled={updatingKB}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-900 px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
                                >
                                    {updatingKB ? (
                                        <>
                                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                            Updating…
                                        </>
                                    ) : (
                                        <>
                                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                            </svg>
                                            Update
                                        </>
                                    )}
                                </button>
                            </div>
                            <ul className="divide-y divide-gray-100">
                                {[...kbData.indexed, ...kbData.pending]
                                    .sort((a, b) => {
                                        // Status priority: Not Indexed / Outdated > Indexed
                                        const getStatusScore = (f: KBFile) => {
                                            const isPending = kbData.pending.some(p => p.id === f.id);
                                            const isStale = kbData.indexed.find(i => i.id === f.id)?.isStale;
                                            if (isPending) return 0;
                                            if (isStale) return 1;
                                            return 2;
                                        };
                                        const scoreA = getStatusScore(a);
                                        const scoreB = getStatusScore(b);
                                        if (scoreA !== scoreB) return scoreA - scoreB;
                                        return a.name.localeCompare(b.name);
                                    })
                                    .map((file, idx) => {
                                        const isIndexed = kbData.indexed.some(f => f.id === file.id && !f.isStale);
                                        const isOutdated = kbData.indexed.some(f => f.id === file.id && f.isStale);
                                        const isNotIndexed = kbData.pending.some(f => f.id === file.id);

                                        return (
                                            <li key={file.id || idx} className="group flex items-center justify-between px-3.5 py-3 text-[12px] hover:bg-gray-50 transition-colors">
                                                <div className="flex items-center gap-3">
                                                    <div className={`rounded-md p-1.5 ${isIndexed ? 'bg-emerald-50 text-emerald-600' :
                                                        isOutdated ? 'bg-amber-50 text-amber-600' :
                                                            'bg-red-50 text-red-600'
                                                        }`}>
                                                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                        </svg>
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[12px] font-semibold text-gray-900">{file.name}</span>
                                                        </div>
                                                        <div className="mt-0.5 flex items-center gap-1.5 overflow-hidden whitespace-nowrap">
                                                            <span className="text-[11px] text-gray-400">
                                                                {file.indexedAt ? `Indexed: ${new Date(file.indexedAt).toLocaleString()}` : 'Not indexed'}
                                                                {` • `}
                                                                Last modified: {new Date(file.modifiedTime).toLocaleString()}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-3">
                                                    {/* Status Badge */}
                                                    {isIndexed && (
                                                        <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                                                            Indexed
                                                        </span>
                                                    )}
                                                    {isOutdated && (
                                                        <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                                                            Outdated
                                                        </span>
                                                    )}
                                                    {isNotIndexed && (
                                                        <span className="rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                                                            Not indexed
                                                        </span>
                                                    )}

                                                    {file.webViewLink && (
                                                        <a
                                                            href={file.webViewLink}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-700"
                                                            title="Open in Google Drive"
                                                        >
                                                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                            </svg>
                                                        </a>
                                                    )}
                                                </div>
                                            </li>
                                        );
                                    })}
                            </ul>
                        </div>

                                {kbData.removed.length > 0 && (
                                    <div className="flex items-center justify-between px-1 text-[11px] italic text-gray-400">
                                        <span>Note: {kbData.removed.length} documents in memory are no longer in Drive. Update to sync.</span>
                                    </div>
                                )}
                            </>
                        )}

                        {(effectiveKnowledgeSource === 'zoho' || effectiveKnowledgeSource === 'both') && (
                        <div className="space-y-4 rounded-xl border border-gray-200/70 bg-white p-4">
                            <div className="flex items-center justify-between">
                                <h4 className="text-[12px] font-semibold tracking-tight text-gray-900">
                                    Zoho knowledge base
                                </h4>
                                {config.zohoDesk?.enabled && (
                                    <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                                        Enabled
                                    </span>
                                )}
                            </div>

                            {/* Enable toggle */}
                            <div className="flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => setConfig(prev => ({
                                        ...prev,
                                        zohoDesk: {
                                            enabled: !prev.zohoDesk?.enabled,
                                            publicPortalIds: prev.zohoDesk?.publicPortalIds ?? [],
                                        },
                                    }))}
                                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${config.zohoDesk?.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${config.zohoDesk?.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
                                </button>
                                <span className="text-[12px] text-gray-600">
                                    {config.zohoDesk?.enabled ? 'Enabled: this agent will search Zoho Help Center.' : 'Disabled: Zoho KB tool will not be available for this agent.'}
                                </span>
                            </div>

                            {/* Portal IDs list */}
                            <div>
                                <label className="mb-1.5 block text-[11px] font-semibold text-gray-500">
                                    Public portal IDs
                                </label>
                                <div className="mb-3 flex flex-col gap-2">
                                    {(config.zohoDesk?.publicPortalIds ?? []).map((id, idx) => {
                                        const showOpen = idx === 0 || idx === 1;
                                        const url = idx === 0 ? ZOHO_PORTAL_URL_GROUP : ZOHO_PORTAL_URL_SUPPORT;

                                        return (
                                            <div
                                                key={idx}
                                                className="grid grid-cols-2 items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                                            >
                                                <div className="min-w-0">
                                                    <span className="block truncate font-mono text-[12px] text-gray-700">{id}</span>
                                                </div>

                                                <div className="flex items-center justify-end gap-2">
                                                    {showOpen && (
                                                        <a
                                                            href={url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                                                            title="Open corresponding Zoho help center portal"
                                                        >
                                                            Open
                                                        </a>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setConfig(prev => ({
                                                                ...prev,
                                                                zohoDesk: {
                                                                    ...prev.zohoDesk!,
                                                                    publicPortalIds: (prev.zohoDesk?.publicPortalIds ?? []).filter((_, i) => i !== idx),
                                                                },
                                                            }))
                                                        }
                                                        className="text-gray-300 transition-colors hover:text-red-500"
                                                    >
                                                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={newPortalId}
                                        onChange={(e) => setNewPortalId(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && newPortalId.trim()) {
                                                setConfig(prev => ({
                                                    ...prev,
                                                    zohoDesk: {
                                                        enabled: prev.zohoDesk?.enabled ?? false,
                                                        publicPortalIds: [...(prev.zohoDesk?.publicPortalIds ?? []), newPortalId.trim()],
                                                    },
                                                }));
                                                setNewPortalId('');
                                            }
                                        }}
                                        className="flex-1 rounded-lg border border-gray-200 bg-white p-2.5 font-mono text-[12px] text-gray-700 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300"
                                        placeholder="Enter portal ID..."
                                    />
                                    <button
                                        type="button"
                                        disabled={!newPortalId.trim()}
                                        onClick={() => {
                                            if (!newPortalId.trim()) return;
                                            setConfig(prev => ({
                                                ...prev,
                                                zohoDesk: {
                                                    enabled: prev.zohoDesk?.enabled ?? false,
                                                    publicPortalIds: [...(prev.zohoDesk?.publicPortalIds ?? []), newPortalId.trim()],
                                                },
                                            }));
                                            setNewPortalId('');
                                        }}
                                        className="btn-primary px-4 py-2 text-[12px]"
                                    >
                                        Add
                                    </button>
                                </div>
                                <p className="mt-2 text-[11px] text-gray-500">
                                    Portal IDs used for public Zoho Help Center searches. The tool checks ID #1 first, then ID #2 if ID #1 returns no relevant
                                    results.
                                </p>
                            </div>
                        </div>
                        )}
                    </div>
                )}
            </div>

            {/* Agent Settings Section (Step 3 · Behaviour & uploads) */}
            <div className="rounded-2xl border border-gray-200/60 bg-white">
                <div
                    className="group flex cursor-pointer items-center justify-between border-b border-gray-100/80 bg-white/90 px-4 py-3 transition-colors hover:bg-gray-50"
                    onClick={() => setExpandedSection(expandedSection === 'agent' ? null : 'agent')}
                >
                    <div className="flex items-center gap-2.5">
                        <svg
                            className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${expandedSection === 'agent' ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <div className="flex flex-col">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400">
                                Step 3
                            </p>
                            <h3 className="text-[13px] font-semibold tracking-tight text-gray-900">
                                Agent Settings
                            </h3>
                        </div>
                    </div>
                    <span className="rounded-md bg-gray-50 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
                        {uploadsSummary}
                    </span>
                </div>

                {expandedSection === 'agent' && (
                    <div className="animate-slide-down h-[360px] max-h-[70vh] overflow-y-auto bg-gray-50/40 p-4">
                        <div className="flex flex-col gap-5 pb-16">
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-end">
                                <div>
                                    <label className="mb-1.5 block text-[11px] font-semibold text-gray-500">Subtitle</label>
                                    <input
                                        type="text"
                                        value={config.subtitle || ''}
                                        onChange={(e) => setConfig(prev => ({ ...prev, subtitle: e.target.value || undefined }))}
                                        className="w-full rounded-lg border border-gray-200 bg-white p-2.5 text-[12px] text-gray-700 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300"
                                        placeholder="Short tagline shown alongside the agent name"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-[11px] font-semibold text-gray-500">Persona</label>
                                    <select
                                        value={config.persona || 'custom'}
                                        onChange={(e) => setConfig(prev => ({ ...prev, persona: e.target.value || undefined }))}
                                        className="w-full rounded-lg border border-gray-200 bg-white p-2.5 text-[12px] text-gray-700 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300"
                                    >
                                        <option value="support">Support</option>
                                        <option value="sales">Sales</option>
                                        <option value="operations">Operations</option>
                                        <option value="internal">Internal</option>
                                        <option value="review">Review / QA</option>
                                        <option value="custom">Custom</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="mb-1.5 block text-[11px] font-semibold text-gray-500">Description</label>
                                <textarea
                                    value={config.description || ''}
                                    onChange={(e) => setConfig(prev => ({ ...prev, description: e.target.value || undefined }))}
                                    className="min-h-[72px] w-full resize-none rounded-lg border border-gray-200 bg-white p-2.5 text-[12px] text-gray-700 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300"
                                    placeholder="Short description shown on the dashboard agent card."
                                    rows={3}
                                />
                            </div>
                            <div>
                                <label className="mb-1.5 block text-[11px] font-semibold text-gray-500">Welcome message</label>
                                <textarea
                                    value={welcomeMessage}
                                    onChange={(e) => setWelcomeMessage(e.target.value)}
                                    className="min-h-[90px] w-full resize-none rounded-lg border border-gray-200 bg-white p-3 text-[13px] text-gray-700 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300"
                                    placeholder="Enter custom welcome message..."
                                    rows={3}
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="mb-1 block text-[11px] font-semibold text-gray-500">
                                    File uploads
                                </label>
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setConfig(prev => ({ ...prev, allowFileUploads: !prev.allowFileUploads }))}
                                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${config.allowFileUploads ? 'bg-emerald-500' : 'bg-gray-300'
                                            }`}
                                    >
                                        <span
                                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${config.allowFileUploads ? 'translate-x-4' : 'translate-x-1'
                                                }`}
                                        />
                                    </button>
                                    <span className="text-[12px] text-gray-600">
                                        {config.allowFileUploads ? 'Enabled: this agent can accept file uploads.' : 'Disabled: this agent cannot accept file uploads.'}
                                    </span>
                                </div>
                                <p className="max-w-none text-[11px] text-gray-500">
                                    When enabled, the chat window will show a file upload control and uploaded files will be available for this
                                    agent to analyse during the current conversation only (they are not stored in the long-term knowledge base).
                                </p>
                            </div>

                        </div>
                    </div>
                )}
            </div>

        </div>
    );
}
