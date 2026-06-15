'use client';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div className="auth-center">
          <div className="auth-stack">
            <h2 className="auth-title">Something went wrong</h2>
            <button onClick={reset} className="auth-btn">
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
