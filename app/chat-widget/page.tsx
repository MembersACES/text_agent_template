'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import ChatWindow from '../components/ChatWindow';

export default function ChatWidgetPage() {
  const searchParams = useSearchParams();
  const agentId = useMemo(() => searchParams.get('agentId') ?? undefined, [searchParams]);

  return (
    <div className="h-screen w-full bg-transparent p-3 sm:p-4">
      <div className="fixed bottom-3 right-3 h-[calc(100vh-24px)] w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-2xl sm:bottom-5 sm:right-5 sm:h-[640px]">
        <ChatWindow agentId={agentId} />
      </div>
    </div>
  );
}

