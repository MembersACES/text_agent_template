
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
        <header className="fixed top-0 left-0 right-0 h-14 bg-white border-b border-gray-200 z-50 flex items-center justify-between px-4 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="text-gray-900 font-bold tracking-tight">ACES</div>
            <div className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-xs font-medium border border-gray-200">TEXT AGENT v1.1</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-red-50 text-red-600 text-[10px] font-bold border border-red-100 uppercase tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
              Locked
            </span>
          </div>
        </header>

        <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <LockScreen onUnlock={() => {
            sessionStorage.setItem('app-auth', 'true');
            setIsAuthorized(true);
          }} />
        </main>

        <footer className="fixed bottom-0 left-0 right-0 h-8 bg-white border-t border-gray-200 flex items-center justify-center text-[10px] text-gray-400">
          © Prograde IP Holdings 2026
        </footer>
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 overflow-y-auto">
      {/* Header */}
      <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 shadow-sm z-20 sticky top-0">
        <div className="flex items-center gap-2">
          <img src="/Logo3.png" alt="ACES Logo" className="h-6" />
          <div className="w-px h-4 bg-gray-200 mx-1"></div>
          <div className="text-gray-900 font-bold tracking-tight">ACES</div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center p-6 pb-24">
        <div className="w-full max-w-5xl">
          <PromptEditor />
        </div>
      </main>

      {/* Footer */}
      <footer className="h-12 border-t border-gray-200 flex items-center justify-center text-[10px] text-gray-400 bg-white">
        © Prograde IP Holdings 2026
      </footer>

      {/* Chat FAB/Window */}
      <ChatWindow />
    </div>
  );
}
