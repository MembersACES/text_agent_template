'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import ChatWindow from '../components/ChatWindow';
import { getBranchLogoUrl } from '@/lib/branch-logos';

/** Must match the string the parent page listens for in `postMessage` (see HTG-BigCommerce-Embed.md). */
export const CHAT_WIDGET_MESSAGE_SOURCE = 'htg-chat-widget';

const COLLAPSED_HEIGHT_PX = 88;
const EXPANDED_HEIGHT_PX = 640;
// Collapsed width hugs the launcher (56px circle + padding/shadow) so the parent iframe's
// click hit-area no longer extends across the empty bottom strip and block page buttons.
const COLLAPSED_WIDTH_PX = 96;
const EXPANDED_WIDTH_PX = 380;

function notifyParentSize(expanded: boolean) {
  if (typeof window === 'undefined') return;
  const heightPx = expanded ? EXPANDED_HEIGHT_PX : COLLAPSED_HEIGHT_PX;
  const widthPx = expanded ? EXPANDED_WIDTH_PX : COLLAPSED_WIDTH_PX;
  try {
    // Parent snippet uses these to size the iframe to the visible widget and to lift the
    // collapsed launcher clear of store UI (e.g. the cart drawer's checkout button).
    window.parent.postMessage(
      { source: CHAT_WIDGET_MESSAGE_SOURCE, expanded, widthPx, heightPx },
      '*'
    );
  } catch {
    /* ignore cross-origin edge cases */
  }
}

export default function ChatWidgetPage() {
  return (
    <Suspense fallback={null}>
      <ChatWidgetPageContent />
    </Suspense>
  );
}

function ChatWidgetPageContent() {
  const searchParams = useSearchParams();
  const agentId = useMemo(() => searchParams.get('agentId') ?? undefined, [searchParams]);
  const startOpen = searchParams.get('open') === '1';

  const [open, setOpen] = useState(startOpen);

  useEffect(() => {
    // Keep the iframe canvas transparent so collapsed mode does not show a white block.
    const previousBodyBackground = document.body.style.background;
    const previousHtmlBackground = document.documentElement.style.background;
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';

    return () => {
      document.body.style.background = previousBodyBackground;
      document.documentElement.style.background = previousHtmlBackground;
    };
  }, []);

  useEffect(() => {
    notifyParentSize(open);
  }, [open]);

  const logoSrc = getBranchLogoUrl(agentId);
  const handleMinimize = useCallback(() => setOpen(false), []);

  return (
    <div
      className={`relative isolate box-border w-full bg-transparent ${
        open
          ? 'flex h-[100svh] min-h-0 items-end justify-end p-3 sm:p-4'
          : 'flex h-auto min-h-0 items-end justify-end p-2 sm:p-3'
      }`}
    >
      {open ? (
        <div className="flex h-[min(640px,calc(100svh-24px))] w-[min(380px,calc(100svw-24px))] flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-2xl">
          <ChatWindow agentId={agentId} onEmbedMinimize={handleMinimize} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-gray-200/90 bg-white shadow-2xl ring-2 ring-white/30 transition-transform hover:scale-[1.03] active:scale-[0.98]"
          aria-label="Open support chat"
        >
          <span className="relative h-11 w-11 overflow-hidden rounded-full bg-gray-100 ring-1 ring-gray-200/80">
            <Image src={logoSrc} alt="" width={44} height={44} className="h-full w-full object-cover" />
          </span>
        </button>
      )}
    </div>
  );
}
