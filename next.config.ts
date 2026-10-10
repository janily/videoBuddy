import type { NextConfig } from 'next';
const config: NextConfig = { serverExternalPackages: ['pdfjs-dist'], turbopack: { root: process.cwd() }, poweredByHeader: false, async headers() { return [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: "frame-src 'none'; object-src 'none'; base-uri 'self'" }, { key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'same-origin' }, { key: 'X-Frame-Options', value: 'DENY' }] }]; } };
export default config;
