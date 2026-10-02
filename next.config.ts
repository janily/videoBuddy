import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';
const config: NextConfig = { turbopack: { root: process.cwd() }, poweredByHeader: false, async headers() { return [{ source: '/:path*', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'same-origin' }, { key: 'X-Frame-Options', value: 'DENY' }] }]; } };
export default withWorkflow(config);
