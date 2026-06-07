import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  turbopack: {
    // Pin the workspace root — a stray lockfile in a parent directory
    // otherwise makes Turbopack scan the whole home dir (and panic).
    root: __dirname,
  },
};

export default nextConfig;
