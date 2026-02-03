'use client';

import { useState, useEffect } from 'react';
import ChatWindow from './components/ChatWindow';
import PromptEditor from './components/PromptEditor';

const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

interface LockScreenProps {
  onUnlock: () => void;
}

function LockScreen({ onUnlock }: LockScreenProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        onUnlock();
      } else {
        setError(true);
        setTimeout(() => setError(false), 2000);
      }
    } catch (err) {
      console.error(err);
      setError(true);
      setTimeout(() => setError(false), 2000);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-icon-wrapper">
            <LockIcon />
          </div>
          <div className="auth-title">ACCESS RESTRICTED</div>
        </div>

        <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <input
            type="password"
            className="auth-input"
            placeholder="ENTER PASSWORD"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />

          {error && <div className="error-msg">ACCESS DENIED</div>}

          <button type="submit" className="auth-btn">
            UNLOCK
          </button>
        </form>
      </div>
      <div style={{ marginTop: '2rem', color: '#888', fontSize: '0.75rem' }}>
        AUTHORIZED PERSONNEL ONLY
      </div>
    </div>
  );
}

export default function Home() {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const auth = sessionStorage.getItem('app-auth');
    if (auth === 'true') {
      setIsAuthorized(true);
    }
    setChecking(false);
  }, []);

  if (checking) return null;

  if (!isAuthorized) {
    return (
      <>
        <header className="top-status-bar">
          <div className="agent-version">ACES TEXT AGENT v1.0</div>
          <div className="header-logo">
            <img src="/Logo3.png" alt="ACES Logo" />
          </div>
          <div className="status-indicators">
            <div className="indicator">
              <span className="dot" style={{ background: '#888' }}></span>
              <span>LOCKED</span>
            </div>
          </div>
        </header>

        <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <LockScreen onUnlock={() => {
            sessionStorage.setItem('app-auth', 'true');
            setIsAuthorized(true);
          }} />
        </main>

        <footer>
          © Prograde IP Holdings 2026
        </footer>
      </>
    );
  }

  return (
    <>
      <header className="top-status-bar">
        <div className="agent-version">ACES TEXT AGENT v1.0</div>
        <div className="header-logo">
          <img src="/Logo3.png" alt="ACES Logo" />
        </div>
        <div className="status-indicators"></div>
      </header>

      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        {/* Chat Button */}
        <button
          onClick={() => setIsChatOpen(true)}
          className="fixed bottom-6 right-6 w-16 h-16 bg-gradient-to-br from-orange-400 to-orange-500 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110 flex items-center justify-center group z-40"
          aria-label="Open chat"
        >
          <svg
            className="w-8 h-8 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
            />
          </svg>
        </button>

        {/* Edit Prompt Button - Only visible when authorized */}
        <button
          onClick={() => setShowPromptEditor(true)}
          className="fixed bottom-6 left-6 px-4 py-2 bg-white text-gray-600 rounded-lg shadow hover:shadow-md transition-all duration-300 text-sm font-medium border border-gray-200 flex items-center gap-2 z-40"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Edit Prompt
        </button>

        {/* Chat Window */}
        {isChatOpen && (
          <ChatWindow onClose={() => setIsChatOpen(false)} />
        )}

        {/* Prompt Editor */}
        {showPromptEditor && (
          <PromptEditor onClose={() => setShowPromptEditor(false)} />
        )}

        {/* Main Content */}
        <div className="text-center max-w-2xl">
          <h1 className="text-5xl font-bold text-gray-900 mb-5 leading-tight">
            Welcome to <span className="text-gradient">ACES TEXT AGENT</span>
          </h1>
          <p className="text-gray-600 text-lg mb-8 leading-relaxed">
            Experience the next generation of conversational AI. Click the chat button in the bottom right to start an intelligent conversation.
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span>Model used: Gemini Flash</span>
          </div>
        </div>
      </main>

      <footer>
        © Prograde IP Holdings 2026
      </footer>
    </>
  );
}

