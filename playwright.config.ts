import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/video/e2e', use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' }, webServer: { command: 'npm run dev -- --hostname localhost', url: 'http://localhost:3000/video', reuseExistingServer: !process.env.CI } });
