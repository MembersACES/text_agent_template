'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import SystemPromptEditor from './components/SystemPromptEditor';

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

interface Agent {
  id: string;
  name: string;
  description?: string;
}

export default function Home() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const auth = sessionStorage.getItem('app-auth');
    if (auth === 'true') {
      setIsAuthorized(true);
    }
    setChecking(false);
  }, []);

  useEffect(() => {
    if (isAuthorized) {
      fetchAgents();
    }
  }, [isAuthorized]);

  const fetchAgents = async () => {
    try {
      const res = await fetch('/api/agents');
      const data = await res.json();
      if (Array.isArray(data.agents)) {
        setAgents(data.agents);
      }
    } catch (error) {
      console.error('Failed to fetch agents', error);
    } finally {
      setLoadingAgents(false);
    }
  };

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
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      {/* Header */}
      <header className="sticky top-0 bg-white border-b border-gray-200 shadow-sm z-20 shrink-0">
        <div className="h-14 flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <img src="/Logo3.png" alt="ACES Logo" className="h-6" />
            <div className="w-px h-4 bg-gray-200 mx-1"></div>
            <div className="text-gray-900 font-bold tracking-tight">ACES</div>
            <div className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-xs font-medium border border-gray-200">
              Agent Management
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6 space-y-6">
          {/* Agents List Section */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">Agents</h2>
              <p className="text-sm text-gray-500 mt-1">Manage and configure your AI agents</p>
            </div>
            <div className="p-6">
              {loadingAgents ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500"></div>
                </div>
              ) : agents.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p className="text-sm">No agents found.</p>
                  <p className="text-xs mt-2 text-gray-400">
                    Navigate to <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">/agent/[agentId]</code> to create one.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {agents.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => router.push(`/agent/${agent.id}`)}
                      className="p-4 border border-gray-200 rounded-lg hover:border-orange-400 hover:bg-orange-50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-5 h-5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                        <span className="font-semibold text-gray-900">{agent.name}</span>
                      </div>
                      <p className="text-xs text-gray-500">{agent.description ?? `ID: ${agent.id}`}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Global System Prompt Section */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">Global System Prompt</h2>
              <p className="text-sm text-gray-500 mt-1">Rules that apply to all agents</p>
            </div>
            <div className="p-6">
              <SystemPromptEditor />
            </div>
          </div>
        </div>
      </main>

      <footer className="h-8 border-t border-gray-200 flex items-center justify-center text-[10px] text-gray-400 bg-white shrink-0">
        © Prograde IP Holdings 2026
      </footer>
    </div>
  );
}
