'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function SetupContent() {
  const params = useSearchParams();
  const success = params.get('success');
  const error = params.get('error');

  return (
    <div className="auth-center">
      <div className="auth-card">
        <h1 className="auth-h2">HomeHQ Setup</h1>
        <p className="auth-sub">Connect your Google Calendar to display events on the dashboard.</p>

        {success && (
          <div className="auth-ok">
            Google Calendar connected successfully. Events will sync shortly.
          </div>
        )}

        {error && (
          <div className="auth-err-box">Connection failed: {decodeURIComponent(error)}</div>
        )}

        <a href="/api/oauth" className="auth-connect">
          {success ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}
        </a>

        {success && (
          <div>
            <Link href="/" className="auth-link">
              &larr; Back to dashboard
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SetupPage() {
  return (
    <Suspense>
      <SetupContent />
    </Suspense>
  );
}
