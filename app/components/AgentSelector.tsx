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
            <div className="px-4 py-2 text-sm text-gray-500">
                Loading agents...
            </div>
        );
    }

    if (agents.length === 0) {
        return (
            <div className="px-4 py-2 text-sm text-gray-500">
                No agents found. Create one by navigating to /agent/[agentId]
            </div>
        );
    }

    return (
        <div className="px-4 py-2 border-b border-gray-200 bg-gray-50">
            <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Agents:</span>
                <button
                    onClick={() => router.push('/')}
                    className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                >
                    Default
                </button>
                {agents.map((agentId) => (
                    <button
                        key={agentId}
                        onClick={() => router.push(`/agent/${agentId}`)}
                        className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                    >
                        {getFriendlyName(agentId)}
                    </button>
                ))}
            </div>
        </div>
    );
}

