'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import SystemPromptEditor from './components/SystemPromptEditor';

/* ─────────────────────  Icons  ───────────────────── */

const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const PlusIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const BotIcon = () => (
  <svg className="w-5 h-5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
  </svg>
);

const XIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

const TrashIcon = ({ size = 'w-4 h-4' }: { size?: string }) => (
  <svg className={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
  </svg>
);

const WarningIcon = () => (
  <svg className="w-6 h-6 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

/* ─────────────────────  Lock Screen  ───────────────────── */

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
          <div className="auth-icon-wrapper"><LockIcon /></div>
          <div className="auth-title">ACCESS RESTRICTED</div>
        </div>
        <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <input type="password" className="auth-input" placeholder="ENTER PASSWORD"
            value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          {error && <div className="error-msg">ACCESS DENIED</div>}
          <button type="submit" className="auth-btn">UNLOCK</button>
        </form>
      </div>
      <div style={{ marginTop: '2rem', color: '#888', fontSize: '0.75rem' }}>AUTHORIZED PERSONNEL ONLY</div>
    </div>
  );
}

/* ─────────────────────  New Agent Modal  ───────────────────── */

interface NewAgentModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function NewAgentModal({ onClose, onCreated }: NewAgentModalProps) {
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [description, setDescription] = useState('');
  const [idManuallyEdited, setIdManuallyEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const handleNameChange = (val: string) => {
    setName(val);
    if (!idManuallyEdited) {
      setId(val.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-'));
    }
  };

  const handleIdChange = (val: string) => {
    setIdManuallyEdited(true);
    setId(val.toLowerCase().replace(/[^a-z0-9-]/g, ''));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !id.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: name.trim(), description: description.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to create agent.'); setSubmitting(false); return; }
      onCreated();
    } catch {
      setError('Network error creating agent.');
      setSubmitting(false);
    }
  };

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={handleBackdrop}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-gray-200 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Create New Agent</h2>
            <p className="text-sm text-gray-500 mt-0.5">Configure a new AI agent for your team</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"><XIcon /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          <div>
            <label htmlFor="agent-name" className="block text-sm font-medium text-gray-700 mb-1.5">Agent Name <span className="text-red-500">*</span></label>
            <input id="agent-name" ref={nameRef} type="text" value={name} onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Customer Support Bot"
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition-shadow"
              disabled={submitting} required />
          </div>
          <div>
            <label htmlFor="agent-id" className="block text-sm font-medium text-gray-700 mb-1.5">Agent ID <span className="text-red-500">*</span></label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-mono select-none">/agent/</span>
              <input id="agent-id" type="text" value={id} onChange={(e) => handleIdChange(e.target.value)}
                placeholder="customer-support"
                className="w-full pl-[4.5rem] pr-3.5 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 font-mono placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition-shadow"
                disabled={submitting} required />
            </div>
            <p className="mt-1.5 text-xs text-gray-400">Lowercase letters, numbers, and hyphens only. This cannot be changed later.</p>
          </div>
          <div>
            <label htmlFor="agent-desc" className="block text-sm font-medium text-gray-700 mb-1.5">Description <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea id="agent-desc" value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Briefly describe what this agent does…" rows={3}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition-shadow resize-none"
              disabled={submitting} />
          </div>
          {error && <div className="px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}
          <div className="flex items-center gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={submitting}
              className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={submitting || !name.trim() || !id.trim()}
              className="flex-1 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {submitting ? (<><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Creating…</>) : (<><PlusIcon />Create Agent</>)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─────────────────────  Delete Confirm Modal  ───────────────────── */

interface DeleteModalProps {
  agentId: string;
  onCancel: () => void;
  onDeleted: () => void;
}

function DeleteConfirmModal({ agentId, onCancel, onDeleted }: DeleteModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    setDeleting(true);
    setError('');
    try {
      const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to delete agent.'); setDeleting(false); return; }
      onDeleted();
    } catch {
      setError('Network error. Please try again.');
      setDeleting(false);
    }
  };

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !deleting) onCancel();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={handleBackdrop}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-gray-200 overflow-hidden">
        <div className="px-6 pt-6 pb-4 flex flex-col items-center text-center gap-3">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center"><WarningIcon /></div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Delete Agent</h2>
            <p className="text-sm text-gray-500 mt-1">
              This will permanently delete all files for{' '}
              <span className="font-mono font-semibold text-gray-800">{agentId}</span>{' '}
              from storage. This action cannot be undone.
            </p>
          </div>
        </div>
        {error && <div className="mx-6 mb-4 px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}
        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onCancel} disabled={deleting}
            className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button id="confirm-delete-agent-btn" onClick={handleDelete} disabled={deleting}
            className="flex-1 px-4 py-2.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {deleting ? (<><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Deleting…</>) : (<><TrashIcon />Delete Agent</>)}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────  Home Page  ───────────────────── */

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
  const [showNewAgentModal, setShowNewAgentModal] = useState(false);
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null);
  const router = useRouter();

  useEffect(() => {
    const auth = sessionStorage.getItem('app-auth');
    if (auth === 'true') setIsAuthorized(true);
    setChecking(false);
  }, []);

  useEffect(() => {
    if (isAuthorized) fetchAgents();
  }, [isAuthorized]);

  const fetchAgents = async () => {
    setLoadingAgents(true);
    try {
      const res = await fetch('/api/agents');
      const data = await res.json();
      if (Array.isArray(data.agents)) setAgents(data.agents);
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
              <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>Locked
            </span>
          </div>
        </header>
        <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <LockScreen onUnlock={() => { sessionStorage.setItem('app-auth', 'true'); setIsAuthorized(true); }} />
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
            <div className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-xs font-medium border border-gray-200">Agent Management</div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6 space-y-6">

          {/* Agents List Section */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Agents</h2>
                <p className="text-sm text-gray-500 mt-1">Manage and configure your AI agents</p>
              </div>
              <button id="create-new-agent-btn" onClick={() => setShowNewAgentModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white text-sm font-medium transition-colors shadow-sm">
                <PlusIcon />New Agent
              </button>
            </div>

            <div className="p-6">
              {loadingAgents ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500"></div>
                </div>
              ) : agents.length === 0 ? (
                <div className="text-center py-12">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-orange-50 mb-4"><BotIcon /></div>
                  <p className="text-sm font-medium text-gray-700 mb-1">No agents yet</p>
                  <p className="text-xs text-gray-400 mb-4">Create your first agent to get started.</p>
                  <button onClick={() => setShowNewAgentModal(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition-colors">
                    <PlusIcon />Create Agent
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {agents.map((agent) => (
                    <div key={agent.id} className="relative group border border-gray-200 rounded-lg hover:border-orange-300 transition-colors">
                      {/* Clickable card area */}
                      <button
                        onClick={() => router.push(`/agent/${agent.id}`)}
                        className="w-full p-4 text-left"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <BotIcon />
                          <span className="font-semibold text-gray-900 group-hover:text-orange-700 transition-colors pr-6">
                            {agent.name}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500">{agent.description ?? `ID: ${agent.id}`}</p>
                      </button>

                      {/* Delete button — top-right corner, shown on hover */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setAgentToDelete(agent); }}
                        className="absolute top-2 right-2 p-1.5 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                        title={`Delete ${agent.name}`}
                        aria-label={`Delete ${agent.name}`}
                      >
                        <TrashIcon size="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  {/* "Add new" card */}
                  <button onClick={() => setShowNewAgentModal(true)}
                    className="p-4 border border-dashed border-gray-300 rounded-lg hover:border-orange-400 hover:bg-orange-50 transition-colors flex flex-col items-center justify-center gap-2 min-h-[88px] group">
                    <div className="w-8 h-8 rounded-full bg-gray-100 group-hover:bg-orange-100 flex items-center justify-center transition-colors">
                      <PlusIcon />
                    </div>
                    <span className="text-xs font-medium text-gray-400 group-hover:text-orange-600 transition-colors">New Agent</span>
                  </button>
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
            <div className="p-6"><SystemPromptEditor /></div>
          </div>

        </div>
      </main>

      <footer className="h-8 border-t border-gray-200 flex items-center justify-center text-[10px] text-gray-400 bg-white shrink-0">
        © Prograde IP Holdings 2026
      </footer>

      {/* New Agent Modal */}
      {showNewAgentModal && (
        <NewAgentModal onClose={() => setShowNewAgentModal(false)} onCreated={() => { setShowNewAgentModal(false); fetchAgents(); }} />
      )}

      {/* Delete Confirm Modal */}
      {agentToDelete && (
        <DeleteConfirmModal
          agentId={agentToDelete.id}
          onCancel={() => setAgentToDelete(null)}
          onDeleted={() => { setAgentToDelete(null); fetchAgents(); }}
        />
      )}
    </div>
  );
}
