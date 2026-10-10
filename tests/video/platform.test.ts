import { describe, it, expect } from 'vitest';
import { readConfiguration, requireGeneration } from '@/services/video/config/environment';
import { configuredModel } from '@/mastra/video/model-adapter';
describe('T00 fail-closed platform configuration', () => {
 it('does not throw at import; names absent self-hosted configuration', () => {
  const c = readConfiguration({}); expect(c.generationEnabled).toBe(false);
  expect(c.missing).toContain('VIDEO_DATA_DIR');
  expect(() => requireGeneration(c)).toThrow('GENERATION_DISABLED');
 });
 it('rejects enabling billed work without every resource budget', () => {
  const c = readConfiguration({ VIDEO_GENERATION_ENABLED: 'true' });
  expect(() => requireGeneration(c)).toThrow('CONFIGURATION_REQUIRED');
 });
 it('retains OpenRouter vendor model prefixes', () => {
  expect(configuredModel('director', {MODEL_PROVIDER:'openrouter',MODEL_API_KEY:'test-key',VIDEO_DIRECTOR_MODEL:'google/model-id'}).id).toBe('openrouter/google/model-id');
 });
 it('requires actual model ID and never silently defaults', () => {
  expect(() => configuredModel('director', {})).toThrow('CONFIGURATION_REQUIRED');
 });
});
it('self-hosted generation configuration accepts an absolute data volume without Vercel credentials',()=>{
 const config=readConfiguration({VIDEO_GENERATION_ENABLED:'true',VIDEO_ENVIRONMENT:'local',VIDEO_APP_ORIGIN:'http://127.0.0.1:3000',VIDEO_SESSION_SIGNING_KEY:'x'.repeat(64),VIDEO_DATA_DIR:'/tmp/videoBuddy-persistent',MODEL_API_KEY:'test-key',VIDEO_DIRECTOR_MODEL:'model',VIDEO_PROJECT_MAX_MODEL_CALLS:'10',VIDEO_PROJECT_MAX_INPUT_TOKENS:'10000',VIDEO_PROJECT_MAX_OUTPUT_TOKENS:'5000',VIDEO_PROJECT_MAX_TTS_CHARACTERS:'10000',VIDEO_PROJECT_MAX_MEDIA_SECONDS:'600',VIDEO_DAILY_MAX_MODEL_CALLS:'20',VIDEO_DAILY_MAX_MEDIA_SECONDS:'1200'});
 expect(config.missing).toEqual([]);expect(()=>requireGeneration(config)).not.toThrow();
});
it('unlimited model validation replaces only model budget requirements, retaining media budgets',()=>{
 const config=readConfiguration({VIDEO_MODEL_BUDGET_MODE:'unlimited_validation'});
 expect(config.missing).not.toContain('VIDEO_PROJECT_MAX_MODEL_CALLS');
 expect(config.missing).not.toContain('VIDEO_PROJECT_MAX_INPUT_TOKENS');
 expect(config.missing).not.toContain('VIDEO_PROJECT_MAX_OUTPUT_TOKENS');
 expect(config.missing).not.toContain('VIDEO_DAILY_MAX_MODEL_CALLS');
 expect(config.missing).toContain('VIDEO_PROJECT_MAX_MEDIA_SECONDS');
 expect(config.missing).toContain('VIDEO_DAILY_MAX_MEDIA_SECONDS');
 expect(readConfiguration({VIDEO_MODEL_BUDGET_MODE:'typo'}).missing).toContain('VIDEO_MODEL_BUDGET_MODE');
});
