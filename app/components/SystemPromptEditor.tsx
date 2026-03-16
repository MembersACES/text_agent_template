'use client';

import { useState, useEffect } from 'react';

export default function SystemPromptEditor() {
    const [globalSystemPrompt, setGlobalSystemPrompt] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            const res = await fetch('/api/system-settings');
            const data = await res.json();
            if (data.globalSystemPrompt) {
                setGlobalSystemPrompt(data.globalSystemPrompt);
            }
            // Note: If no saved settings exist, the API returns the default from code
            // This ensures the editor always shows something editable
        } catch (error) {
            console.error('Failed to load system settings', error);
            setMessage({ type: 'error', text: 'Failed to load system settings' });
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch('/api/system-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ globalSystemPrompt }),
            });

            if (res.ok) {
                setMessage({ type: 'success', text: 'System settings saved successfully!' });
                setTimeout(() => setMessage(null), 3000);
            } else {
                const data = await res.json();
                setMessage({ type: 'error', text: data.error || 'Failed to save' });
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

    return (
        <div className="flex w-full flex-col gap-4">
            {/* Header with Save button */}
            <div className="mb-1 flex items-center justify-between">
                <div>
                    <h3 className="text-[15px] font-semibold tracking-tight text-gray-900">Global system prompt</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-gray-500">
                        These rules apply to all agents. Agent-specific prompts are added below this.
                    </p>
                    <p className="mt-1 text-[11px] italic text-gray-400">
                        Note: If no saved settings exist, the default from code is shown. Click Save to persist your changes.
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    {message && (
                        <span className={`text-[13px] font-medium ${message.type === 'success' ? 'text-emerald-600' : 'text-red-500'}`}>
                            {message.text}
                        </span>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="btn-primary"
                    >
                        {saving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>

            {/* Editor */}
            <div className="overflow-hidden rounded-2xl border border-gray-200/60 bg-white">
                <textarea
                    value={globalSystemPrompt}
                    onChange={(e) => setGlobalSystemPrompt(e.target.value)}
                    className="h-[420px] w-full resize-none border-none bg-gray-50/40 p-5 font-mono text-[13px] leading-relaxed text-gray-800 outline-none placeholder-gray-300 focus:bg-white"
                    placeholder="Enter global system prompt that applies to all agents..."
                    spellCheck={false}
                />
            </div>
        </div>
    );
}

