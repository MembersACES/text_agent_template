'use client';

import { useState, useEffect } from 'react';
import ChatWindow from '../components/ChatWindow';

export default function ChatWidgetPage() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const auth = sessionStorage.getItem('app-auth');
    if (auth === 'true') {
      setIsAuthorized(true);
    }
    setChecking(false);
  }, []);

  if (checking) {
    return (
      <div className="h-screen w-full bg-gray-50 flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-700" />
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="h-screen w-full bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="mb-1 text-[13px] font-semibold text-gray-800">Authentication required</p>
          <p className="text-[12px] text-gray-500">Please authenticate in the main application first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-gray-50">
      <ChatWindow />
    </div>
  );
}

