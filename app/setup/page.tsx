'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function SetupContent() {
  const params = useSearchParams();
  const success = params.get('success');
  const error = params.get('error');

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md space-y-6 rounded-lg bg-gray-900 p-8">
        <h1 className="text-2xl font-bold">HomeHQ Setup</h1>
        <p className="text-gray-400">
          Connect your Google Calendar to display events on the dashboard.
        </p>

        {success && (
          <div className="rounded bg-green-900/50 p-3 text-green-300">
            Google Calendar connected successfully. Events will sync shortly.
          </div>
        )}

        {error && (
          <div className="rounded bg-red-900/50 p-3 text-red-300">
            Connection failed: {decodeURIComponent(error)}
          </div>
        )}

        <a
          href="/api/oauth"
          className="inline-block rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500"
        >
          {success ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}
        </a>

        {success && (
          <div>
            <a href="/" className="text-blue-400 hover:underline">
              &larr; Back to dashboard
            </a>
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
