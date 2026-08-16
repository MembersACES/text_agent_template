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

const PencilIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
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
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100/80 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-gray-900">Create new agent</h2>
            <p className="mt-0.5 text-[13px] text-gray-500">Configure a focused assistant for your team.</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <XIcon />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          <div>
            <label htmlFor="agent-name" className="mb-1 block text-[11px] font-semibold text-gray-600">
              Agent name <span className="text-red-500">*</span>
            </label>
            <input id="agent-name" ref={nameRef} type="text" value={name} onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Customer Support Bot"
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-[13px] text-gray-900 placeholder-gray-400 outline-none ring-0 focus:border-gray-400 focus:ring-1 focus:ring-gray-300"
              disabled={submitting} required />
          </div>
          <div>
            <label htmlFor="agent-id" className="mb-1 block text-[11px] font-semibold text-gray-600">
              Agent ID <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 select-none font-mono text-[12px] text-gray-400">
                /agent/
              </span>
              <input id="agent-id" type="text" value={id} onChange={(e) => handleIdChange(e.target.value)}
                placeholder="customer-support"
                className="w-full border border-gray-200 bg-white pl-[4.5rem] pr-3 py-2.5 font-mono text-[12px] text-gray-900 placeholder-gray-400 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300"
                disabled={submitting} required />
            </div>
            <p className="mt-1 text-[11px] text-gray-400">
              Lowercase letters, numbers, and hyphens only. This cannot be changed later.
            </p>
          </div>
          <div>
            <label htmlFor="agent-desc" className="mb-1 block text-[11px] font-semibold text-gray-600">
              Description <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <textarea id="agent-desc" value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Briefly describe what this agent does…" rows={3}
              className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-[13px] text-gray-900 placeholder-gray-400 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300"
              disabled={submitting} />
          </div>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] text-red-600">
              {error}
            </div>
          )}
          <div className="flex items-center gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={submitting}
              className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-[13px] font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={submitting || !name.trim() || !id.trim()}
              className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Creating…
                </>
              ) : (
                <>
                  <PlusIcon />
                  Create agent
                </>
              )}
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

function EditAgentModal({
  agent,
  onClose,
  onSaved,
}: {
  agent: Agent;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description ?? '');
  const [fullConfig, setFullConfig] = useState<{
    systemPrompt: string;
    welcomeMessage: string;
    agentName: string;
    config?: Record<string, unknown>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/prompt?agentId=${encodeURIComponent(agent.id)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || 'Failed to load agent config.');
          setFullConfig(null);
          return;
        }
        setFullConfig(data);
        setName(data.agentName ?? agent.name);
        setDescription((data.config?.description as string) ?? agent.description ?? '');
      } catch {
        if (!cancelled) setError('Network error loading config.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [agent.id, agent.name, agent.description]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullConfig) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.id,
          systemPrompt: fullConfig.systemPrompt,
          welcomeMessage: fullConfig.welcomeMessage,
          agentName: name.trim(),
          config: { ...fullConfig.config, description: description.trim() || undefined },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to save.');
        setSaving(false);
        return;
      }
      onSaved();
    } catch {
      setError('Network error saving.');
    } finally {
      setSaving(false);
    }
  };

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !saving) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={handleBackdrop}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100/80 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-gray-900">Edit agent</h2>
            <p className="mt-0.5 text-[13px] text-gray-500">/agent/{agent.id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
          >
            <XIcon />
          </button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-600" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
            <div>
              <label htmlFor="edit-agent-name" className="mb-1 block text-[11px] font-semibold text-gray-600">
                Agent name <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-agent-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Customer Support Bot"
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-[13px] text-gray-900 placeholder-gray-400 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300"
                disabled={saving}
                required
              />
            </div>
            <div>
              <label htmlFor="edit-agent-desc" className="mb-1 block text-[11px] font-semibold text-gray-600">
                Description <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <textarea
                id="edit-agent-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Briefly describe what this agent does…"
                rows={3}
                className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-[13px] text-gray-900 placeholder-gray-400 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300"
                disabled={saving}
              />
            </div>
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] text-red-600">{error}</div>
            )}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button type="submit" disabled={saving} className="btn-primary flex-1">
                {saving ? (
                  <>
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Saving…
                  </>
                ) : (
                  'Save'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [showNewAgentModal, setShowNewAgentModal] = useState(false);
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null);
  const [agentToEdit, setAgentToEdit] = useState<Agent | null>(null);
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
          © Prograde IP Holdings 2026
        </footer>
      </>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50">
      {/* Header */}
      <header className="frosted-header sticky top-0 z-20 flex shrink-0 items-center">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <img src="/Logo3.png" alt="ACES Logo" className="h-5" />
              <div className="h-4 w-px bg-gray-200/80" />
              <span className="text-[13px] font-semibold tracking-tight text-gray-900">
                Agent Console
              </span>
            </div>
            <span className="hidden rounded-full border border-gray-200/70 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500 sm:inline-flex">
              Multi‑agent workspace
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-subtle-pulse" />
              Online
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="gradient-mesh flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-6 pt-5">
          {/* Agents List Section */}
          <section className="rounded-2xl border border-gray-200/60 bg-white/90 p-1.5 shadow-[0_0_0_1px_rgba(255,255,255,0.5)]">
            <div className="flex items-center justify-between rounded-2xl border border-gray-100/80 bg-white/80 px-4 py-3">
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight text-gray-900">
                  Agents
                </h2>
                <p className="mt-0.5 text-[13px] leading-relaxed text-gray-500">
                  Configure focused assistants for different workflows.
                </p>
              </div>
              <button
                id="create-new-agent-btn"
                onClick={() => setShowNewAgentModal(true)}
                className="btn-primary hidden sm:inline-flex"
              >
                <PlusIcon />
                New agent
              </button>
            </div>

            <div className="px-4 pb-4 pt-3">
              {loadingAgents ? (
                <div className="flex items-center justify-center py-10">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-gray-700" />
                </div>
              ) : agents.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-200/80 bg-gray-50/60 px-6 py-10 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50">
                    <BotIcon />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-gray-800">
                      No agents yet
                    </p>
                    <p className="mt-1 text-[12px] text-gray-500">
                      Create your first agent to start routing conversations.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowNewAgentModal(true)}
                    className="btn-primary mt-1"
                  >
                    <PlusIcon />
                    Create agent
                  </button>
                </div>
              ) : (
                <div className="grid gap-3 pt-1 sm:grid-cols-2 lg:grid-cols-3">
                  {agents.map((agent) => (
                    <div
                      key={agent.id}
                      className="group relative rounded-2xl border border-gray-200/70 bg-white/80 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md"
                    >
                      <button
                        onClick={() => router.push(`/agent/${agent.id}`)}
                        className="flex w-full flex-col gap-2.5 px-3.5 py-3.5 text-left"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-50">
                            <BotIcon />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-semibold text-gray-900">
                              {agent.name}
                            </p>
                            <p className="mt-0.5 text-[11px] text-gray-400">
                              /agent/{agent.id}
                            </p>
                          </div>
                        </div>
                        <p className="line-clamp-2 text-[12px] leading-relaxed text-gray-500">
                          {agent.description ?? 'No description yet.'}
                        </p>
                      </button>

                      <div className="absolute right-2.5 top-2.5 flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAgentToEdit(agent);
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-gray-300 transition-all duration-150 hover:border-gray-200 hover:bg-gray-100 hover:text-gray-600 group-hover:opacity-100 md:opacity-0"
                          title={`Edit ${agent.name}`}
                          aria-label={`Edit ${agent.name}`}
                        >
                          <PencilIcon />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setAgentToDelete(agent);
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-gray-300 transition-all duration-150 hover:border-red-100 hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 md:opacity-0"
                          title={`Delete ${agent.name}`}
                          aria-label={`Delete ${agent.name}`}
                        >
                          <TrashIcon size="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* "Add new" card */}
                  <button
                    onClick={() => setShowNewAgentModal(true)}
                    className="group flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300/80 bg-gray-50/60 px-4 py-3 text-center transition-all duration-200 ease-out hover:border-gray-400 hover:bg-gray-100"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white group-hover:bg-gray-900/90">
                      <PlusIcon />
                    </div>
                    <span className="text-[12px] font-medium text-gray-500 group-hover:text-gray-900">
                      New agent
                    </span>
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Global System Prompt Section */}
          <section className="rounded-2xl border border-gray-200/60 bg-white/90 p-1.5 shadow-[0_0_0_1px_rgba(255,255,255,0.5)]">
            <div className="flex items-center justify-between rounded-2xl border border-gray-100/80 bg-white/80 px-4 py-3">
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight text-gray-900">
                  Global system prompt
                </h2>
                <p className="mt-0.5 text-[13px] leading-relaxed text-gray-500">
                  Shared rules applied to every agent.
                </p>
              </div>
            </div>
            <div className="px-4 pb-4 pt-3">
              <SystemPromptEditor />
            </div>
          </section>
        </div>
      </main>

      <footer className="flex h-8 shrink-0 items-center justify-center border-t border-gray-200/60 bg-white/95 text-[10px] text-gray-400 backdrop-blur">
        © Prograde IP Holdings 2026
      </footer>

      {/* New Agent Modal */}
      {showNewAgentModal && (
        <NewAgentModal
          onClose={() => setShowNewAgentModal(false)}
          onCreated={() => {
            setShowNewAgentModal(false);
            fetchAgents();
          }}
        />
      )}

      {/* Delete Confirm Modal */}
      {agentToDelete && (
        <DeleteConfirmModal
          agentId={agentToDelete.id}
          onCancel={() => setAgentToDelete(null)}
          onDeleted={() => {
            setAgentToDelete(null);
            fetchAgents();
          }}
        />
      )}

      {agentToEdit && (
        <EditAgentModal
          agent={agentToEdit}
          onClose={() => setAgentToEdit(null)}
          onSaved={() => {
            setAgentToEdit(null);
            fetchAgents();
          }}
        />
      )}
    </div>
  );
}
