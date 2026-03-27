'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ChatWindow from '../../components/ChatWindow';
import PromptEditor from '../../components/PromptEditor';

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
    } catch {
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
          <div className="auth-title">Restricted workspace</div>
          <p className="text-[11px] text-gray-400">Enter the shared passphrase to continue.</p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="w-full flex flex-col gap-4"
        >
          <input
            type="password"
            className="auth-input"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          {error && <div className="error-msg">Incorrect password. Try again.</div>}
          <button type="submit" className="auth-btn">
            Unlock workspace
          </button>
        </form>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-gray-50 px-2.5 py-1 text-[10px] font-medium text-gray-500 border border-gray-200/70">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-gray-400 animate-subtle-pulse" />
          Locked for authorized teams only
        </div>
      </div>
    </div>
  );
}

export default function AgentPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.agentId as string;
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    const auth = sessionStorage.getItem('app-auth');
    if (auth === 'true') setIsAuthorized(true);
    setChecking(false);
  }, []);

  if (checking) return null;

  if (!isAuthorized) {
    return (
      <>
        <header className="frosted-header fixed top-0 left-0 right-0 z-50 flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="text-[13px] font-semibold tracking-tight text-gray-900">ACES</div>
            <div className="rounded-full border border-gray-200/70 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500">
              Text Agent · v1.1
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200/80 bg-white/80 px-2 py-0.5 text-[10px] font-medium text-gray-500">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-subtle-pulse" />
              Locked
            </span>
          </div>
        </header>
        <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <LockScreen onUnlock={() => { sessionStorage.setItem('app-auth', 'true'); setIsAuthorized(true); }} />
        </main>
        <footer className="fixed bottom-0 left-0 right-0 flex h-8 items-center justify-center border-t border-gray-200/60 bg-white/90 text-[10px] text-gray-400 backdrop-blur">
          © Prograde IP Holdings & Carbon Zero Australasia 2026
        </footer>
      </>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50">
      {/* Header */}
      <header className="frosted-header sticky top-0 z-20 flex shrink-0 items-center">
        <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-center px-5">
          <div className="flex flex-col items-center gap-2 py-2 text-center">
            <div className="flex items-center gap-2">
              <img src="/Logo3.png" alt="ACES Logo" className="h-8" />
              <div className="mx-1.5 h-5 w-px bg-gray-200/80" />
              <span className="text-[15px] font-semibold tracking-tight text-gray-900">
                Agent Console
              </span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[11px] text-gray-500">
                Configuring <span className="font-mono text-gray-700">{agentId}</span>
              </span>
              <span className="text-[11px] text-gray-500">
                {agentId === 'honest-to-goodness-agent'
                  ? 'Configure your Honest to Goodness support agent.'
                  : 'Configure this agent’s behaviour, knowledge, and tools.'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Split View */}
      <main className="gradient-mesh flex flex-1 min-h-0 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto flex w-full max-w-7xl flex-1 min-h-0 gap-0 px-4 pb-4 pt-3">
          <div className="flex w-[52%] max-w-[720px] min-h-0 flex-col rounded-2xl border border-gray-200/60 bg-gray-50/60">
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <button
                onClick={() => router.push('/')}
                className="rounded-full border border-gray-200 bg-white/80 px-3 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
              >
                ← Back to dashboard
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <PromptEditor agentId={agentId} onSaveSuccess={() => setRefreshTrigger(prev => prev + 1)} />
            </div>
          </div>
          <div className="mx-3 my-2 w-px bg-gray-200/60" />
          <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/60 bg-white">
            <ChatWindow agentId={agentId} refreshTrigger={refreshTrigger} />
          </div>
        </div>
      </main>

      <footer className="flex h-8 shrink-0 items-center justify-center border-t border-gray-200/60 bg-white/95 text-[10px] text-gray-400 backdrop-blur">
        © Prograde IP Holdings & Carbon Zero Australasia 2026
      </footer>
    </div>
  );
}
