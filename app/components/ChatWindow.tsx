
'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

interface ChatWindowProps {
}

export default function ChatWindow({ }: ChatWindowProps) {
    const [messages, setMessages] = useState<Message[]>([
        {
            role: 'assistant',
            content: "Loading...",
        },
    ]);
    const [welcomeMessage, setWelcomeMessage] = useState("Hello!\n\nI'm your AI assistant. How can I help you today?");
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [showEndChatPopup, setShowEndChatPopup] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const res = await fetch('/api/prompt');
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
            } catch (error) {
                console.error("Failed to load welcome message", error);
                setMessages([{
                    role: 'assistant',
                    content: "Hello!\n\nI'm your AI assistant. How can I help you today?"
                }]);
            }
        };
        fetchConfig();
    }, []);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

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
                body: JSON.stringify({ message: userMessage, useKnowledgeBase: true }),
            });

            const data = await response.json();

            if (!response.ok) throw new Error(data.error || 'Failed to get response');

            setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
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

    const confirmEndChat = async () => {
        try {
            await fetch('/api/end-of-chat-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: messages, dynamicVariables: [] })
            });
        } catch (err) { console.error("Failed to save chat logs", err); }

        setShowEndChatPopup(false);
        setMessages([{ role: 'assistant', content: welcomeMessage }]);
        setInput('');
    };

    return (
        <>
            {/* FAB Button */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-8 right-8 w-16 h-16 bg-gray-900 hover:bg-gray-800 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 hover:scale-105 z-50 group border-4 border-blue-500"
                    aria-label="Open chat"
                >
                    <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                </button>
            )}

            {/* Chat Window */}
            {isOpen && (
                <>
                    <div className="fixed inset-0 bg-black/30 z-40 animate-fade-in" onClick={() => setIsOpen(false)} />
                    <div className="fixed bottom-28 right-8 w-[500px] h-[700px] bg-white rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden animate-slide-up">

                        {/* Header */}
                        <div className="bg-gradient-to-r from-orange-400 to-orange-500 px-5 py-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                                    </svg>
                                </div>
                                <h2 className="text-white font-bold text-lg">Design AI</h2>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setShowEndChatPopup(true)}
                                    className="p-2 hover:bg-white/20 rounded-lg text-white transition-colors"
                                    title="End Chat"
                                >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </button>
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="p-2 hover:bg-white/20 rounded-lg text-white transition-colors"
                                >
                                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto p-6 bg-gray-50 space-y-4">
                            {messages.map((message, index) => (
                                <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    {message.role === 'assistant' && index === 0 && (
                                        <div className="w-full flex flex-col items-center py-8">
                                            <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mb-4">
                                                <svg className="w-8 h-8 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                                                </svg>
                                            </div>
                                            <div className="text-center px-4">
                                                <p className="text-gray-600 text-sm whitespace-pre-wrap">{message.content}</p>
                                            </div>
                                        </div>
                                    )}
                                    {(message.role === 'user' || index > 0) && (
                                        <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${message.role === 'user' ? 'bg-orange-500 text-white' : 'bg-white text-gray-800 shadow-sm border border-gray-100'
                                            }`}>
                                            <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                                        </div>
                                    )}
                                </div>
                            ))}
                            {isLoading && (
                                <div className="flex justify-start">
                                    <div className="bg-white rounded-2xl px-4 py-3 shadow-sm border border-gray-100">
                                        <div className="flex space-x-1">
                                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input */}
                        <div className="p-4 bg-white border-t border-gray-100">
                            <div className="flex items-center gap-2 bg-gray-50 rounded-full px-4 py-2 border border-gray-200 focus-within:border-orange-500 focus-within:ring-2 focus-within:ring-orange-100 transition-all">
                                <input
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyPress={handleKeyPress}
                                    placeholder="Type your message..."
                                    className="flex-1 bg-transparent outline-none text-gray-700 placeholder-gray-400 text-sm"
                                    disabled={isLoading}
                                    autoFocus
                                />
                                <button
                                    onClick={handleSend}
                                    disabled={!input.trim() || isLoading}
                                    className="p-2 bg-orange-500 text-white rounded-full hover:bg-orange-600 disabled:opacity-50 disabled:hover:bg-orange-500 transition-colors"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        {/* End Chat Popup */}
                        {showEndChatPopup && (
                            <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/20 backdrop-blur-sm p-6">
                                <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col items-center animate-scale-in">
                                    <h3 className="text-lg font-bold text-gray-900 mb-6">End this chat?</h3>
                                    <div className="w-full space-y-3">
                                        <button onClick={confirmEndChat} className="w-full py-3 bg-red-50 text-red-600 font-bold rounded-xl hover:bg-red-100 transition-colors">
                                            Yes, End Chat
                                        </button>
                                        <button onClick={() => setShowEndChatPopup(false)} className="w-full py-3 text-gray-600 font-medium hover:bg-gray-50 rounded-xl transition-colors">
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
        </>
    );
}
