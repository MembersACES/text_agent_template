
'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
    role: 'user' | 'assistant';
    content: string;
    actions?: Array<{
        type: 'download' | 'sheets-link';
        label: string;
        url: string;
    }>;
}

interface ExtractedInvoice {
    business_name: string | null;
    supplier: string | null;
    utility_type: "Electricity" | "Gas" | "Water" | "Waste" | "Oil" | "Cleaning";
    [key: string]: any;
}

interface ChatWindowProps {
    refreshTrigger?: number;
    agentId?: string;
}

export default function ChatWindow({ refreshTrigger, agentId }: ChatWindowProps) {
    const [messages, setMessages] = useState<Message[]>([
        {
            role: 'assistant',
            content: "Loading...",
        },
    ]);
    const [welcomeMessage, setWelcomeMessage] = useState("Hello!\n\nI'm your AI assistant. How can I help you today?");
    const [agentName, setAgentName] = useState("Text Agent");
    const [allowFileUploads, setAllowFileUploads] = useState(false);
    const [uploadedFiles, setUploadedFiles] = useState<{ name: string; content: string; mimeType?: string; fileBufferBase64?: string }[]>([]);
    const [extractedInvoices, setExtractedInvoices] = useState<ExtractedInvoice[]>([]);
    const [isGeneratingReport, setIsGeneratingReport] = useState(false);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const reportGenerationTriggered = useRef(false);
    const [showEndChatPopup, setShowEndChatPopup] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const url = agentId ? `/api/prompt?agentId=${agentId}` : '/api/prompt';
                const res = await fetch(url);
                const data = await res.json();
                if (data.welcomeMessage) {
                    setWelcomeMessage(data.welcomeMessage);
                    setMessages([{
                        role: 'assistant',
                        content: data.welcomeMessage
                    }]);
                } else {
                    setMessages([{
                        role: 'assistant',
                        content: "Hello!\n\nI'm your AI assistant. How can I help you today?"
                    }]);
                }
                if (data.agentName) {
                    setAgentName(data.agentName);
                }
                if (data.config && data.config.allowFileUploads) {
                    setAllowFileUploads(true);
                } else {
                    setAllowFileUploads(false);
                }
            } catch (error) {
                console.error("Failed to load welcome message", error);
                setMessages([{
                    role: 'assistant',
                    content: "Hello!\n\nI'm your AI assistant. How can I help you today?"
                }]);
            }
        };
        fetchConfig();
    }, [refreshTrigger, agentId]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMessage = input.trim();
        setInput('');

        setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
        setIsLoading(true);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMessage,
                    conversationHistory: messages, // Include full conversation history
                    useKnowledgeBase: true,
                    agentId: agentId,
                    uploadedFiles,
                }),
            });

            const data = await response.json();
            console.log('Chat API response length:', data.response?.length);
            console.log('Chat API response first 200:', data.response?.substring(0, 200));
            console.log('Chat API response last 200:', data.response?.substring(data.response.length - 200));


            if (!response.ok) throw new Error(data.error || 'Failed to get response');

            // Extract structured data if present (silent accumulation)
            // Use functional setState to avoid stale closure issues
            if (data.extractedData) {
                setExtractedInvoices(prev => {
                    // Handle both single object and array from extractedData
                    const newInvoices = Array.isArray(data.extractedData) 
                        ? data.extractedData 
                        : [data.extractedData];
                    
                    // Merge with existing invoices, avoiding duplicates by invoice_number if available
                    const merged = [...prev];
                    newInvoices.forEach((newInvoice: ExtractedInvoice) => {
                        // Check if invoice already exists (by invoice_number if available, or by content)
                        const exists = merged.some(existing => {
                            if (newInvoice.invoice_number && existing.invoice_number) {
                                return existing.invoice_number === newInvoice.invoice_number;
                            }
                            // Fallback: compare key fields if no invoice_number
                            return existing.invoice_date === newInvoice.invoice_date &&
                                   existing.total_inc_gst === newInvoice.total_inc_gst &&
                                   existing.supplier === newInvoice.supplier;
                        });
                        
                        if (!exists) {
                            merged.push(newInvoice);
                        }
                    });
                    
                    console.log(`[ChatWindow] Accumulated ${merged.length} invoice(s) (added ${newInvoices.length} new)`);
                    return merged;
                });
            }

            // Check if report generation is requested
            // Only trigger on explicit flag from API (not from checking user message, as that could trigger twice)
            if (data.generateReport) {
                // Clean the response to remove [GENERATE_REPORT] marker if present
                const cleanedResponse = data.response.replace(/\[GENERATE_REPORT\]/g, '').trim();
                
                // Use a ref to prevent duplicate report generation calls (React Strict Mode can cause double renders)
                if (!reportGenerationTriggered.current) {
                    reportGenerationTriggered.current = true;
                    
                    // Use functional update to get the latest invoices state, then trigger report generation
                    setExtractedInvoices(currentInvoices => {
                        if (currentInvoices.length > 0) {
                            // Trigger report generation with current invoices (only once)
                            setTimeout(() => {
                                handleGenerateReportWithInvoices(currentInvoices);
                                // Reset the flag after a delay to allow for future report generations
                                setTimeout(() => {
                                    reportGenerationTriggered.current = false;
                                }, 2000);
                            }, 100);
                        } else {
                            setMessages(prev => [...prev, {
                                role: 'assistant',
                                content: 'No invoice data available to generate a report. Please provide invoices first.',
                            }]);
                            reportGenerationTriggered.current = false;
                        }
                        return currentInvoices; // Return unchanged state
                    });
                }
                // Skip adding the assistant's response message here - handleGenerateReportWithInvoices will add its own message
                // This prevents duplicate messages when report generation is triggered
                // Only add the cleaned response if it has meaningful content (not just the marker)
                if (cleanedResponse && cleanedResponse.length > 0 && !cleanedResponse.match(/^\s*$/)) {
                    setMessages(prev => [...prev, { 
                        role: 'assistant', 
                        content: cleanedResponse,
                    }]);
                }
            } else {
                // Reset the flag when report generation is not requested
                reportGenerationTriggered.current = false;
                // Only add assistant's response if report generation is NOT being triggered
                // Create message with actions if report was just generated
                const messageActions = data.downloadUrl ? [
                    { type: 'download' as const, label: 'Download .xlsx', url: data.downloadUrl },
                ] : undefined;

                setMessages(prev => [...prev, { 
                    role: 'assistant', 
                    content: data.response,
                    actions: messageActions,
                }]);
            }
        } catch (error) {
            console.error('Error:', error);
            setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleGenerateReport = async () => {
        handleGenerateReportWithInvoices(extractedInvoices);
    };

    const handleGenerateReportWithInvoices = async (invoices: ExtractedInvoice[]) => {
        // Prevent duplicate report generation
        if (isGeneratingReport) {
            console.log('[ChatWindow] Report generation already in progress, skipping duplicate request');
            return;
        }

        if (invoices.length === 0) {
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: 'No invoice data available to generate a report. Please provide invoices first.',
            }]);
            return;
        }

        setIsGeneratingReport(true);
        try {
            // Extract business info from first invoice
            const businessInfo = {
                name: invoices[0].business_name || 'Unknown Business',
                address: invoices[0].site_address || undefined,
            };

            const response = await fetch('/api/export/generate-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    invoices,
                    businessInfo,
                    agentId,
                    uploadedFiles: uploadedFiles, // Include uploaded invoice files for Drive upload
                }),
            });

            const data = await response.json();

            if (!response.ok) throw new Error(data.error || 'Failed to generate report');

            // Add message with download button and Drive links
            const actions: Array<{ type: 'download' | 'sheets-link'; label: string; url: string }> = [
                { type: 'download', label: 'Download .xlsx', url: data.downloadUrl },
            ];

            // Add Drive links if files were uploaded
            if (data.driveUploads && data.driveUploads.length > 0) {
                data.driveUploads.forEach((upload: { url: string; fileName: string }) => {
                    actions.push({
                        type: 'sheets-link',
                        label: `Open ${upload.fileName} in Drive`,
                        url: upload.url,
                    });
                });
            }

            let content = 'Report generated successfully! You can download the Excel file.';
            if (data.driveUploads && data.driveUploads.length > 0) {
                content += `\n\n✅ ${data.driveUploads.length} file(s) uploaded to Google Drive:`;
                data.driveUploads.forEach((upload: { fileName: string }) => {
                    content += `\n  • ${upload.fileName}`;
                });
            }
            if (data.driveUploadError) {
                content += `\n\n⚠️ Drive upload warning: ${data.driveUploadError}`;
            }
            if (data.note && !data.driveUploads) {
                content += `\n\n${data.note}`;
            }

            // Check if this message already exists to prevent duplicates
            setMessages(prev => {
                // Check if the last message is already the report generation message
                const lastMessage = prev[prev.length - 1];
                if (lastMessage && lastMessage.content === content && lastMessage.actions?.length === actions.length) {
                    console.log('[ChatWindow] Report generation message already exists, skipping duplicate');
                    return prev;
                }
                return [...prev, {
                    role: 'assistant',
                    content,
                    actions,
                }];
            });
        } catch (error) {
            console.error('Error generating report:', error);
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: 'Sorry, I encountered an error while generating the report. Please try again.',
            }]);
        } finally {
            setIsGeneratingReport(false);
        }
    };

    const confirmEndChat = async () => {
        try {
            await fetch('/api/end-of-chat-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: messages, dynamicVariables: [], agentName: agentName })
            });
        } catch (err) { console.error("Failed to save chat logs", err); }

        setShowEndChatPopup(false);
        setMessages([{ role: 'assistant', content: welcomeMessage }]);
        setInput('');
        setExtractedInvoices([]); // Clear accumulated invoices
        setUploadedFiles([]); // Clear uploaded files
        setUploadError(null); // Clear any upload errors
    };

    return (
        <div className="flex flex-col h-full bg-white relative overflow-hidden border-l border-gray-200">
            {/* End Chat Popup Overlay */}
            {showEndChatPopup && (
                <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/20 backdrop-blur-sm p-6">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col items-center animate-scale-in border border-gray-100">
                        <h3 className="text-xl font-medium text-gray-900 mb-8 text-center leading-relaxed">
                            Do you want to end this chat?
                        </h3>

                        <div className="w-full space-y-3">
                            <button
                                onClick={confirmEndChat}
                                className="w-full py-3 px-4 bg-white border border-gray-200 rounded-xl text-gray-700 font-medium hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 group"
                            >
                                <svg className="w-5 h-5 text-gray-400 group-hover:text-green-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Yes, I'm done
                            </button>

                            <button
                                onClick={() => setShowEndChatPopup(false)}
                                className="w-full py-3 px-4 bg-white border border-gray-200 rounded-xl text-gray-700 font-medium hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 group"
                            >
                                <svg className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                </svg>
                                No, go back
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="bg-gradient-to-r from-orange-400 to-orange-500 px-5 py-4 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 bg-white bg-opacity-20 rounded-lg flex items-center justify-center">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                        </svg>
                    </div>
                    <h2 className="text-white text-lg font-semibold">{agentName}</h2>
                </div>
                <div className="flex items-center gap-1.5">
                    <button
                        onClick={() => setShowEndChatPopup(true)}
                        className="text-white hover:bg-white hover:bg-opacity-20 rounded-lg p-1.5 transition-colors"
                        aria-label="Clear Chat"
                        title="Clear Chat"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50">
                {messages.map((message, index) => (
                    <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${message.role === 'user' ? 'bg-orange-500 text-white' : 'bg-white text-gray-800 shadow-sm'}`}>
                            <p className="whitespace-pre-line text-sm">{message.content}</p>
                            {message.actions && message.actions.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {message.actions.map((action, actionIndex) => (
                                        action.type === 'download' ? (
                                            <a
                                                key={actionIndex}
                                                href={action.url}
                                                download
                                                className="px-3 py-1.5 bg-orange-500 text-white text-xs font-semibold rounded-lg hover:bg-orange-600 transition-colors inline-flex items-center gap-1.5"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                </svg>
                                                {action.label}
                                            </a>
                                        ) : (
                                            <a
                                                key={actionIndex}
                                                href={action.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="px-3 py-1.5 bg-orange-500 text-white text-xs font-semibold rounded-lg hover:bg-orange-600 transition-colors inline-flex items-center gap-1.5"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                </svg>
                                                {action.label}
                                            </a>
                                        )
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                {(isLoading || isGeneratingReport) && (
                    <div className="flex justify-start">
                        <div className="bg-white rounded-2xl px-4 py-3 shadow-sm">
                            <div className="flex items-center gap-2">
                                <div className="flex space-x-2">
                                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                                </div>
                                {isGeneratingReport && (
                                    <span className="text-xs text-gray-500 ml-2">Generating report...</span>
                                )}
                            </div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input + optional file upload */}
            <div className="p-5 bg-white border-t border-gray-100 shrink-0 space-y-3">
                {/* File chips - show uploaded files as badges */}
                {uploadedFiles.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {uploadedFiles.map((file, index) => (
                            <div
                                key={index}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-orange-50 border border-orange-200 rounded-lg text-xs text-orange-700"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                <span className="max-w-[150px] truncate">{file.name}</span>
                                <button
                                    onClick={() => {
                                        setUploadedFiles(prev => prev.filter((_, i) => i !== index));
                                    }}
                                    className="ml-1 text-orange-500 hover:text-orange-700 transition-colors"
                                    aria-label={`Remove ${file.name}`}
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Upload error message */}
                {uploadError && (
                    <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center justify-between">
                        <span>{uploadError}</span>
                        <button
                            onClick={() => setUploadError(null)}
                            className="text-red-500 hover:text-red-700"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                )}

                {/* Hidden file input */}
                {allowFileUploads && agentId && (
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".txt,.md,.json,.csv,.pdf,.doc,.docx,.xls,.xlsx,image/*"
                        className="hidden"
                        onChange={async (e) => {
                            const files = e.target.files;
                            if (!files || files.length === 0 || !agentId) return;

                            setUploadError(null);
                            try {
                                setIsLoading(true);
                                const uploadPromises = Array.from(files).map(async (file) => {
                                    const formData = new FormData();
                                    formData.append('file', file);
                                    formData.append('agentId', agentId);

                                    const res = await fetch('/api/uploads', {
                                        method: 'POST',
                                        body: formData,
                                    });
                                    const data = await res.json();
                                    if (!res.ok) {
                                        throw new Error(data.error || `Failed to upload "${file.name}"`);
                                    }
                                    return { 
                                        name: data.fileName || file.name, 
                                        content: data.content,
                                        mimeType: data.mimeType,
                                        fileBufferBase64: data.fileBufferBase64, // Store original file buffer for Drive upload
                                    };
                                });

                                const uploaded = await Promise.all(uploadPromises);
                                setUploadedFiles(prev => [...prev, ...uploaded]);
                            } catch (err: any) {
                                console.error('Upload error:', err);
                                setUploadError(err.message || 'An error occurred while uploading files.');
                            } finally {
                                setIsLoading(false);
                                if (e.target) e.target.value = '';
                            }
                        }}
                    />
                )}

                <div className="flex items-center gap-3 bg-white rounded-full px-5 py-2.5 border border-gray-200">
                    {/* File attachment button */}
                    {allowFileUploads && agentId && (
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isLoading}
                            className="text-gray-400 hover:text-orange-500 disabled:text-gray-200 transition-colors"
                            aria-label="Attach file"
                            title="Attach files"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                            </svg>
                        </button>
                    )}
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Type your message..."
                        className="flex-1 bg-transparent outline-none text-gray-800 placeholder-gray-400 text-sm"
                        disabled={isLoading}
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isLoading}
                        className="text-gray-300 hover:text-orange-500 disabled:text-gray-200 transition-colors"
                        aria-label="Send message"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
}
