
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
        <div className="flex flex-col h-full bg-white relative shadow-xl rounded-l-2xl overflow-hidden border-l border-gray-200">
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
                    <h2 className="text-white text-lg font-semibold">Text Agent</h2>
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
                        {message.role === 'assistant' && index === 0 && (
                            <div className="flex flex-col items-center w-full space-y-5 pt-12 pb-6">
                                <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center">
                                    <svg className="w-9 h-9 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                                    </svg>
                                </div>
                                <div className="text-center px-8">
                                    <h3 className="text-xl font-semibold text-gray-700 mb-2">Hello!</h3>
                                    <p className="text-gray-400 text-sm leading-relaxed">
                                        {message.content.replace('Hello!\n\n', '')}
                                    </p>
                                </div>
                            </div>
                        )}
                        {(message.role === 'user' || index > 0) && (
                            <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${message.role === 'user' ? 'bg-orange-500 text-white' : 'bg-white text-gray-800 shadow-sm'}`}>
                                <p className="whitespace-pre-line text-sm">{message.content}</p>
                            </div>
                        )}
                    </div>
                ))}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-white rounded-2xl px-4 py-3 shadow-sm">
                            <div className="flex space-x-2">
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
            <div className="p-5 bg-white border-t border-gray-100 shrink-0">
                <div className="flex items-center gap-3 bg-white rounded-full px-5 py-2.5 border border-gray-200">
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
