'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const FRIENDLY_AGENT_NAMES: Record<string, string> = {
    'pudu-chatbot-test': 'Pudu Chatbot Test Agent',
    'base-1-review': 'Base 1 Review',
};

function getFriendlyName(agentId: string): string {
    if (FRIENDLY_AGENT_NAMES[agentId]) return FRIENDLY_AGENT_NAMES[agentId];
    // Fallback: convert kebab-case to Title Case
    return agentId
        .split('-')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

export default function AgentSelector() {
    const [agents, setAgents] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        fetchAgents();
    }, []);

    const fetchAgents = async () => {
        try {
            const res = await fetch('/api/agents');
            const data = await res.json();
            if (data.agents) {
                setAgents(data.agents);
            }
        } catch (error) {
            console.error('Failed to fetch agents', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="border-b border-gray-200/80 bg-gray-50 px-4 py-1.5 text-[12px] text-gray-500">
                Loading agents…
            </div>
        );
    }

    if (agents.length === 0) {
        return (
            <div className="border-b border-gray-200/80 bg-gray-50 px-4 py-1.5 text-[12px] text-gray-500">
                No agents found. Create one from the main console.
            </div>
        );
    }

    return (
        <div className="border-b border-gray-200/80 bg-gray-50/80 px-4 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Agents</span>
                <button
                    onClick={() => router.push('/')}
                    className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-700 transition-colors hover:bg-gray-100"
                >
                    Default
                </button>
                {agents.map((agentId) => (
                    <button
                        key={agentId}
                        onClick={() => router.push(`/agent/${agentId}`)}
                        className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-700 transition-colors hover:bg-gray-100"
                    >
                        {getFriendlyName(agentId)}
                    </button>
                ))}
            </div>
        </div>
    );
}

