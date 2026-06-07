'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(
    async (pinValue: string) => {
      setLoading(true);
      setError('');

      try {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: pinValue }),
        });

        if (res.ok) {
          router.push('/');
          router.refresh();
        } else {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(data?.error ?? 'Invalid PIN');
          setPin('');
          inputRef.current?.focus();
        }
      } catch {
        setError('Connection error');
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setPin(value);
    setError('');

    if (value.length === 6) {
      submit(value);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-3xl font-bold">HomeHQ</h1>
        <p className="text-gray-400">Enter PIN to continue</p>

        <div>
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={pin}
            onChange={handleChange}
            disabled={loading}
            autoFocus
            className="w-48 rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-center text-2xl tracking-[0.3em] text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            placeholder="••••••"
          />
        </div>

        <div className="flex justify-center gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={`h-2.5 w-2.5 rounded-full ${
                i < pin.length ? 'bg-blue-500' : 'bg-gray-700'
              }`}
            />
          ))}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {loading && <p className="text-sm text-gray-500">Verifying...</p>}
      </div>
    </div>
  );
}
