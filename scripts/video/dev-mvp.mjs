import {resolve} from 'node:path';
// Loading inside the process avoids propagating --env-file into Next's
// NODE_OPTIONS (Node rejects that flag there). Keep credentials server-side.
process.loadEnvFile(resolve('.env.mvp.local'));
process.argv=[process.execPath,resolve('node_modules/next/dist/bin/next'),'dev','--hostname','localhost'];
await import('next/dist/bin/next');
