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
    <div className="auth-center">
      <div className="auth-panel">
        <h1 className="auth-h1">HomeHQ</h1>
        <p className="auth-sub">Enter PIN to continue</p>

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
            className="auth-pin"
            placeholder="••••••"
          />
        </div>

        <div className="auth-dots">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={`auth-dot ${i < pin.length ? 'auth-dot--on' : 'auth-dot--off'}`}
            />
          ))}
        </div>

        {error && <p className="auth-error">{error}</p>}
        {loading && <p className="auth-loading">Verifying...</p>}
      </div>
    </div>
  );
}
