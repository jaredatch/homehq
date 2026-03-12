'use client';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-100 antialiased">
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center space-y-4">
            <h2 className="text-2xl font-bold">Something went wrong</h2>
            <button
              onClick={reset}
              className="rounded-lg bg-gray-800 px-4 py-2 text-sm hover:bg-gray-700"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
