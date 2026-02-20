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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="h-screen w-full bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Authentication required</p>
          <p className="text-sm text-gray-400">Please authenticate in the main application first.</p>
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

