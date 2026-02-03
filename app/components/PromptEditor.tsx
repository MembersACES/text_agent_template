
'use client';

import { useState, useEffect } from 'react';

interface PromptEditorProps {
    onClose: () => void;
}

export default function PromptEditor({ onClose }: PromptEditorProps) {
    const [template, setTemplate] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        fetchPrompt();
    }, []);

    const fetchPrompt = async () => {
        try {
            const res = await fetch('/api/prompt');
            const data = await res.json();
            if (data.template) {
                setTemplate(data.template);
            }
        } catch (error) {
            console.error('Failed to load prompt', error);
            setMessage({ type: 'error', text: 'Failed to load prompt template' });
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
                body: JSON.stringify({ template }),
            });

            if (res.ok) {
                setMessage({ type: 'success', text: 'Prompt saved successfully!' });
                setTimeout(() => {
                    setMessage(null);
                    onClose();
                }, 1500);
            } else {
                setMessage({ type: 'error', text: 'Failed to save prompt' });
            }
        } catch (error) {
            console.error('Failed to save prompt', error);
            setMessage({ type: 'error', text: 'Failed to save prompt' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <h2 className="text-xl font-bold text-gray-800">System Prompt Editor</h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-6 flex-1 overflow-auto bg-gray-50">
                    {loading ? (
                        <div className="flex justify-center items-center h-40">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
                        </div>
                    ) : (
                        <div className="space-y-4 h-full flex flex-col">
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                                <strong>Instructions:</strong> Use <code>{'{'}{'{'}context{'}'}{'}'}</code> where the documentation chunks should appear, and <code>{'{'}{'{'}message{'}'}{'}'}</code> for the user's message.
                            </div>

                            <textarea
                                value={template}
                                onChange={(e) => setTemplate(e.target.value)}
                                className="w-full h-full min-h-[400px] p-4 font-mono text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none resize-none"
                                placeholder="Enter system prompt..."
                            />
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-gray-100 bg-white flex justify-between items-center">
                    <div>
                        {message && (
                            <span className={`text-sm ${message.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                                {message.text}
                            </span>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            disabled={saving}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving || loading}
                            className="px-6 py-2 bg-gradient-to-r from-orange-400 to-orange-500 text-white rounded-lg shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {saving ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
