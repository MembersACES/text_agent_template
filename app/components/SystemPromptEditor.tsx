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
            <div className="flex flex-col h-full items-center justify-center p-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
            </div>
        );
    }

    return (
        <div className="w-full flex flex-col gap-6">
            {/* Header with Save button */}
            <div className="flex items-center justify-between mb-2">
                <div>
                    <h3 className="text-lg font-bold text-gray-900 tracking-tight">Global System Prompt</h3>
                    <p className="text-sm text-gray-500 mt-1">
                        These rules apply to all agents. Agent-specific prompts are added below this.
                    </p>
                    <p className="text-xs text-gray-400 mt-1 italic">
                        Note: If no saved settings exist, the default from code is shown. Click Save to persist your changes.
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    {message && (
                        <span className={`text-sm font-medium ${message.type === 'success' ? 'text-green-600' : 'text-red-500'} animate-fade-in`}>
                            {message.text}
                        </span>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-6 py-2 bg-black text-white text-sm font-bold rounded-lg shadow-sm hover:bg-gray-800 transition-all disabled:opacity-50"
                    >
                        {saving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>

            {/* Editor */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <textarea
                    value={globalSystemPrompt}
                    onChange={(e) => setGlobalSystemPrompt(e.target.value)}
                    className="w-full h-[500px] p-6 border-none outline-none resize-none font-mono text-sm leading-relaxed text-gray-800 placeholder-gray-300 bg-gray-50/30 focus:bg-white transition-colors"
                    placeholder="Enter global system prompt that applies to all agents..."
                    spellCheck={false}
                />
            </div>
        </div>
    );
}

