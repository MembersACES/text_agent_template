
'use client';

import { useState, useEffect } from 'react';

export default function PromptEditor() {
    // State for Config
    const [systemPrompt, setSystemPrompt] = useState('');
    const [welcomeMessage, setWelcomeMessage] = useState('');
    const [config, setConfig] = useState({ model: 'Gemini 3.0 Flash', language: 'Multilingual' });

    // State for UI
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    // Accordion states
    const [isPromptExpanded, setIsPromptExpanded] = useState(true);
    const [isWelcomeExpanded, setIsWelcomeExpanded] = useState(false);
    const [isKBExpanded, setIsKBExpanded] = useState(false);

    // KB Data
    const [kbFiles, setKbFiles] = useState<{ name: string }[]>([]);

    useEffect(() => {
        fetchConfig();
        fetchKB();
    }, []);

    const fetchKB = async () => {
        try {
            const res = await fetch('/api/knowledge-base/index');
            const data = await res.json();
            if (data.files) {
                setKbFiles(data.files);
            }
        } catch (error) {
            console.error('Failed to load KB files', error);
        }
    }

    const fetchConfig = async () => {
        try {
            const res = await fetch('/api/prompt');
            const data = await res.json();
            if (data.systemPrompt !== undefined) {
                setSystemPrompt(data.systemPrompt);
                setWelcomeMessage(data.welcomeMessage || '');
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
                    config
                }),
            });

            if (res.ok) {
                setMessage({ type: 'success', text: 'Saved successfully!' });
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
        <div className="w-full max-w-4xl mx-auto p-6 flex flex-col gap-6">

            {/* Prompt Config Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div
                    className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 bg-white border-b border-gray-100 transition-colors"
                    onClick={() => setIsPromptExpanded(!isPromptExpanded)}
                >
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <svg
                            className={`w-5 h-5 text-gray-500 transform transition-transform duration-200 ${isPromptExpanded ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        Prompt
                    </h3>
                </div>

                {isPromptExpanded && (
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
                    onClick={() => setIsKBExpanded(!isKBExpanded)}
                >
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <svg
                            className={`w-5 h-5 text-gray-500 transform transition-transform duration-200 ${isKBExpanded ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        Knowledge Base
                    </h3>
                </div>

                {isKBExpanded && (
                    <div className="p-6 bg-gray-50/30 animate-slide-down">
                        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                            {kbFiles.length === 0 ? (
                                <div className="p-8 text-center text-gray-500 text-sm">
                                    No documents indexed.
                                </div>
                            ) : (
                                <ul className="divide-y divide-gray-100">
                                    {kbFiles.map((file, idx) => (
                                        <li key={idx} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50">
                                            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                </svg>
                                            </div>
                                            <span className="text-sm text-gray-700 font-medium">{file.name}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Welcome Message Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div
                    className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 bg-white border-b border-gray-100 transition-colors"
                    onClick={() => setIsWelcomeExpanded(!isWelcomeExpanded)}
                >
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <svg
                            className={`w-5 h-5 text-gray-500 transform transition-transform duration-200 ${isWelcomeExpanded ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        Welcome Message
                    </h3>
                </div>

                {isWelcomeExpanded && (
                    <div className="p-6 bg-gray-50/30 animate-slide-down">
                        <div className="relative group">
                            <textarea
                                value={welcomeMessage}
                                onChange={(e) => setWelcomeMessage(e.target.value)}
                                className="w-full p-4 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 resize-none min-h-[100px] shadow-sm"
                                placeholder="Enter custom welcome message..."
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-between pt-4">
                <div className="flex-1">
                    {message && (
                        <span className={`text-sm font-medium ${message.type === 'success' ? 'text-green-600' : 'text-red-500'} animate-fade-in`}>
                            {message.text}
                        </span>
                    )}
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving || loading}
                    className="px-8 py-3 bg-black text-white text-sm font-bold rounded-xl shadow-lg hover:bg-gray-800 hover:shadow-xl hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:transform-none"
                >
                    {saving ? 'Saving...' : 'Save'}
                </button>
            </div>
        </div>
    );
}
