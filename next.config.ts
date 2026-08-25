import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  // Allow HMR/dev-asset requests when reaching `next dev` from another machine
  // (a Pi on the LAN, a laptop over Tailscale). Comma-separated hosts in
  // HOMEHQ_DEV_ORIGINS, e.g. "my-mac.tailnet.ts.net,192.168.1.20". Dev-only;
  // ignored in production builds.
  allowedDevOrigins: (process.env.HOMEHQ_DEV_ORIGINS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean),
  // The vendored emoji font never changes in place — swapping faces means a new
  // filename — so let clients keep it instead of revalidating 472 KB on every
  // kiosk reload. Files under public/ are otherwise served `max-age=0`.
  async headers() {
    return [
      {
        source: '/fonts/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
  turbopack: {
    // Pin the workspace root — a stray lockfile in a parent directory
    // otherwise makes Turbopack scan the whole home dir (and panic).
    root: __dirname,
  },
};

export default nextConfig;
