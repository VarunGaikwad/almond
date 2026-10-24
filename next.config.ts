import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: ['port3002-workspaces-ws-s8jui.us10.trial.applicationstudio.cloud.sap'],
  async headers() {
    return [
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] },
      { source: '/:path*', headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ] },
    ];
  },
};
export default config;
