
'use client';

import { useState, useEffect } from 'react';

type AgentConfig = {
    model?: string;
    language?: string;
    kbFolderId?: string;
    allowFileUploads?: boolean;
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
    const [expandedSection, setExpandedSection] = useState<'prompt' | 'kb' | 'zoho' | 'agent' | null>(null);

    // Zoho portal ID input
    const [newPortalId, setNewPortalId] = useState('');

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
            <div className="flex flex-col h-full items-center justify-center p-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
            </div>
        );
    }

    return (
        <div className="w-full max-w-4xl mx-auto p-6 flex flex-col gap-6 relative">

            {/* Header with Save button */}
            <div className="flex items-center justify-between mb-2">
                <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Configuration</h2>
                <div className="flex items-center gap-4">
                    {message && (
                        <span className={`text-sm font-medium ${message.type === 'success' ? 'text-green-600' : 'text-red-500'} animate-fade-in`}>
                            {message.text}
                        </span>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={saving || loading}
                        className="px-6 py-2 bg-black text-white text-sm font-bold rounded-lg shadow-sm hover:bg-gray-800 transition-all disabled:opacity-50"
                    >
                        {saving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>

            {/* Prompt Config Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div
                    className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 bg-white border-b border-gray-100 transition-colors"
                    onClick={() => setExpandedSection(expandedSection === 'prompt' ? null : 'prompt')}
                >
                    <div className="flex items-center gap-2">
                        <svg
                            className={`w-5 h-5 text-gray-500 transform transition-transform duration-200 ${expandedSection === 'prompt' ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <div>
                            <h3 className="text-lg font-bold text-gray-900">Agent-Specific Prompt</h3>
                            <p className="text-xs text-gray-500 mt-0.5">This prompt is added below the global system prompt</p>
                        </div>
                    </div>
                </div>

                {expandedSection === 'prompt' && (
                    <div className="p-0 animate-slide-down">
                        <textarea
                            value={systemPrompt}
                            onChange={(e) => setSystemPrompt(e.target.value)}
                            className="w-full h-[500px] p-6 border-none outline-none resize-none font-mono text-sm leading-relaxed text-gray-800 placeholder-gray-300 bg-gray-50/30 focus:bg-white transition-colors"
                            placeholder="Enter system prompt..."
                            spellCheck={false}
                        />
                    </div>
                )}
            </div>

            {/* Knowledge Base Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div
                    className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 bg-white border-b border-gray-100 transition-colors"
                    onClick={() => setExpandedSection(expandedSection === 'kb' ? null : 'kb')}
                >
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2 flex-1">
                        <svg
                            className={`w-5 h-5 text-gray-500 transform transition-transform duration-200 ${expandedSection === 'kb' ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        Knowledge Base
                    </h3>
                    <button
                        onClick={handleUpdateKB}
                        disabled={updatingKB}
                        className="px-3 py-1 bg-blue-600 text-white text-xs font-bold rounded-md shadow-sm hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center gap-1.5"
                    >
                        {updatingKB ? (
                            <>
                                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                Updating...
                            </>
                        ) : (
                            <>
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                Update
                            </>
                        )}
                    </button>
                </div>

                {expandedSection === 'kb' && (
                    <div className="p-6 bg-gray-50/30 animate-slide-down flex flex-col gap-4">
                        {(kbData.pending.length > 0 || kbData.indexed.some(f => f.isStale)) && (
                            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-center gap-3">
                                <div className="p-1.5 bg-orange-100 text-orange-600 rounded-full">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                </div>
                                <div className="flex-1">
                                    <p className="text-xs font-semibold text-orange-800">Knowledge base is out of sync</p>
                                    <p className="text-[10px] text-orange-600">Click <b>Update</b> above to refresh with the latest Drive changes.</p>
                                </div>
                            </div>
                        )}

                        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
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
                                            <li key={file.id || idx} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50 group transition-colors">
                                                <div className="flex items-center gap-3">
                                                    <div className={`p-2 rounded-lg ${isIndexed ? 'bg-green-50 text-green-600' :
                                                        isOutdated ? 'bg-orange-50 text-orange-600' :
                                                            'bg-red-50 text-red-600'
                                                        }`}>
                                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                        </svg>
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm text-gray-900 font-semibold">{file.name}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 mt-0.5 whitespace-nowrap overflow-hidden">
                                                            <span className="text-[10px] text-gray-400">
                                                                {file.indexedAt ? `Indexed: ${new Date(file.indexedAt).toLocaleString()}` : 'Not Indexed'}
                                                                {` • `}
                                                                Last Modified: {new Date(file.modifiedTime).toLocaleString()}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-3">
                                                    {/* Status Badge */}
                                                    {isIndexed && <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded uppercase tracking-wider">Indexed</span>}
                                                    {isOutdated && <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-[10px] font-bold rounded uppercase tracking-wider">Outdated</span>}
                                                    {isNotIndexed && <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded uppercase tracking-wider">Not Indexed</span>}

                                                    {file.webViewLink && (
                                                        <a
                                                            href={file.webViewLink}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="p-2 text-gray-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                                            title="Open in Google Drive"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                            <div className="px-1 text-[10px] text-gray-400 flex items-center justify-between italic">
                                <span>Note: {kbData.removed.length} documents in memory are no longer in Drive. Update to sync.</span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Zoho Knowledge Base Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div
                    className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 bg-white border-b border-gray-100 transition-colors"
                    onClick={() => setExpandedSection(expandedSection === 'zoho' ? null : 'zoho')}
                >
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <svg
                            className={`w-5 h-5 text-gray-500 transform transition-transform duration-200 ${expandedSection === 'zoho' ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        Zoho Knowledge Base
                    </h3>
                    {config.zohoDesk?.enabled && (
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded uppercase tracking-wider">Enabled</span>
                    )}
                </div>

                {expandedSection === 'zoho' && (
                    <div className="p-6 bg-gray-50/30 animate-slide-down flex flex-col gap-6">
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
                                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${config.zohoDesk?.enabled ? 'bg-green-500' : 'bg-gray-300'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${config.zohoDesk?.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
                            </button>
                            <span className="text-xs text-gray-600">
                                {config.zohoDesk?.enabled ? 'Enabled: this agent will search Zoho Help Center.' : 'Disabled: Zoho KB tool will not be available for this agent.'}
                            </span>
                        </div>

                        {/* Portal IDs list */}
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                                Public Portal IDs
                            </label>
                            <div className="flex flex-col gap-2 mb-3">
                                {(config.zohoDesk?.publicPortalIds ?? []).map((id, idx) => (
                                    <div key={idx} className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
                                        <span className="flex-1 text-xs font-mono text-gray-700">{id}</span>
                                        <button
                                            type="button"
                                            onClick={() => setConfig(prev => ({
                                                ...prev,
                                                zohoDesk: {
                                                    ...prev.zohoDesk!,
                                                    publicPortalIds: (prev.zohoDesk?.publicPortalIds ?? []).filter((_, i) => i !== idx),
                                                },
                                            }))}
                                            className="text-gray-300 hover:text-red-500 transition-colors"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    </div>
                                ))}
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
                                    className="flex-1 p-2.5 bg-white border border-gray-200 rounded-lg text-xs font-mono text-gray-700 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 shadow-sm transition-all"
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
                                    className="px-4 py-2 bg-black text-white text-xs font-bold rounded-lg shadow-sm hover:bg-gray-800 transition-all disabled:opacity-30"
                                >
                                    Add
                                </button>
                            </div>
                            <p className="mt-2 text-[11px] text-gray-500">
                                Portal IDs used for public Zoho Help Center searches. The first ID is the primary portal; if it returns no relevant results, the second is tried as a fallback.
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Agent Settings Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div
                    className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 bg-white border-b border-gray-100 transition-colors"
                    onClick={() => setExpandedSection(expandedSection === 'agent' ? null : 'agent')}
                >
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <svg
                            className={`w-5 h-5 text-gray-500 transform transition-transform duration-200 ${expandedSection === 'agent' ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        Agent Settings
                    </h3>
                </div>

                {expandedSection === 'agent' && (
                    <div className="p-6 bg-gray-50/30 animate-slide-down">
                        <div className="flex flex-col gap-6">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Agent Name</label>
                                <input
                                    type="text"
                                    value={agentName}
                                    onChange={(e) => setAgentName(e.target.value)}
                                    className="w-full p-3 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 shadow-sm transition-all"
                                    placeholder="e.g. Text Agent"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Welcome Message</label>
                                <textarea
                                    value={welcomeMessage}
                                    onChange={(e) => setWelcomeMessage(e.target.value)}
                                    className="w-full p-4 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 resize-none min-h-[120px] shadow-sm transition-all"
                                    placeholder="Enter custom welcome message..."
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                                        Google Drive Folder ID (Knowledge Base)
                                    </label>
                                    <input
                                        type="text"
                                        value={config.kbFolderId || ''}
                                        onChange={(e) => setConfig(prev => ({ ...prev, kbFolderId: e.target.value || undefined }))}
                                        className="w-full p-3 bg-white border border-gray-200 rounded-lg text-xs text-gray-700 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 shadow-sm transition-all"
                                        placeholder="Override default GOOGLE_DRIVE_FOLDER_ID for this agent"
                                    />
                                    <p className="mt-1 text-[11px] text-gray-500">
                                        If set, this agent will index and query documents from the specified Drive folder ID.
                                        If left blank, it falls back to the global <code className="font-mono">GOOGLE_DRIVE_FOLDER_ID</code>.
                                    </p>
                                </div>

                                <div className="flex flex-col gap-2">
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                                        File Uploads
                                    </label>
                                    <div className="flex items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setConfig(prev => ({ ...prev, allowFileUploads: !prev.allowFileUploads }))}
                                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${config.allowFileUploads ? 'bg-green-500' : 'bg-gray-300'
                                                }`}
                                        >
                                            <span
                                                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${config.allowFileUploads ? 'translate-x-4' : 'translate-x-1'
                                                    }`}
                                            />
                                        </button>
                                        <span className="text-xs text-gray-600">
                                            {config.allowFileUploads ? 'Enabled: this agent can accept file uploads.' : 'Disabled: this agent cannot accept file uploads.'}
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-gray-500">
                                        When enabled, the chat window will show a file upload control and uploaded files will be available for this agent to analyse during the current conversation only (they are not stored in the long-term knowledge base).
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

        </div>
    );
}
