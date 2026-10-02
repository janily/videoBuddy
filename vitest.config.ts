import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({ resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } }, test: { include: ['tests/video/**/*.test.ts'], exclude: ['tests/video/e2e/**'], env: { RUN_VIDEO_CLOUD_TESTS: '0', RUN_VIDEO_MODEL_TESTS: '0', RUN_VIDEO_STYLE_TESTS: '0' } } });
