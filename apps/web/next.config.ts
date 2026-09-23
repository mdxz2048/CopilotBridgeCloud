import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    const target = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001';
    return [
      { source: '/api/v1/:path*', destination: `${target}/api/v1/:path*` },
      { source: '/v1/:path*', destination: `${target}/v1/:path*` },
      { source: '/health', destination: `${target}/health` },
    ];
  },
};
export default nextConfig;
