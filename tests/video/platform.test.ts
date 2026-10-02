import { describe, it, expect } from 'vitest';
import { readConfiguration, requireGeneration } from '@/services/video/config/environment';
import { configuredModel } from '@/mastra/video/model-adapter';
describe('T00 fail-closed platform configuration', () => {
 it('does not throw at import; names absent cloud configuration', () => {
  const c = readConfiguration({}); expect(c.generationEnabled).toBe(false);
  expect(c.missing).toContain('BLOB_READ_WRITE_TOKEN');
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
