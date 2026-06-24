import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  // Allow HMR/dev-asset requests when reaching `next dev` over Tailscale from
  // another machine (working on the dashboard from home). Dev-only; ignored in
  // production builds.
  allowedDevOrigins: ['my-mac.tailnet.ts.net', '192.168.1.20'],
  turbopack: {
    // Pin the workspace root — a stray lockfile in a parent directory
    // otherwise makes Turbopack scan the whole home dir (and panic).
    root: __dirname,
  },
};

export default nextConfig;
