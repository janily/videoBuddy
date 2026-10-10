import {isAbsolute} from 'node:path';
export type Environment = Record<string, string | undefined>;
export const budgetKeys = [
  'VIDEO_PROJECT_MAX_MODEL_CALLS', 'VIDEO_PROJECT_MAX_INPUT_TOKENS',
  'VIDEO_PROJECT_MAX_OUTPUT_TOKENS',
  'VIDEO_PROJECT_MAX_MEDIA_SECONDS', 'VIDEO_DAILY_MAX_MODEL_CALLS',
  'VIDEO_DAILY_MAX_MEDIA_SECONDS',
] as const;
export function readConfiguration(env: Environment = process.env) {
  const modelBudgetKeys = ['VIDEO_PROJECT_MAX_MODEL_CALLS', 'VIDEO_PROJECT_MAX_INPUT_TOKENS', 'VIDEO_PROJECT_MAX_OUTPUT_TOKENS', 'VIDEO_DAILY_MAX_MODEL_CALLS'];
  const requiredBudgets = budgetKeys.filter(key => env.VIDEO_MODEL_BUDGET_MODE !== 'unlimited_validation' || !modelBudgetKeys.includes(key));
  const required = ['VIDEO_ENVIRONMENT', 'VIDEO_APP_ORIGIN', 'VIDEO_SESSION_SIGNING_KEY',
    'VIDEO_DATA_DIR', 'MODEL_API_KEY', 'VIDEO_DIRECTOR_MODEL', ...requiredBudgets];
  const missing = required.filter(key => !env[key] || (budgetKeys.some(k => k === key) &&
    (!/^\d+$/.test(env[key]!) || Number(env[key]) <= 0 || !Number.isSafeInteger(Number(env[key])))));
  if (env.VIDEO_DATA_DIR && !isAbsolute(env.VIDEO_DATA_DIR) && !missing.includes('VIDEO_DATA_DIR')) missing.push('VIDEO_DATA_DIR');
  if (env.VIDEO_SESSION_SIGNING_KEY && env.VIDEO_SESSION_SIGNING_KEY.length < 32 && !missing.includes('VIDEO_SESSION_SIGNING_KEY')) missing.push('VIDEO_SESSION_SIGNING_KEY');
  if (env.VIDEO_MODEL_BUDGET_MODE && !['bounded', 'unlimited_validation'].includes(env.VIDEO_MODEL_BUDGET_MODE)) missing.push('VIDEO_MODEL_BUDGET_MODE');
  return { generationEnabled: env.VIDEO_GENERATION_ENABLED === 'true', missing, environment: env.VIDEO_ENVIRONMENT };
}
export function requireGeneration(config = readConfiguration()) {
  if (!config.generationEnabled) throw new Error('GENERATION_DISABLED');
  if (config.missing.length) throw new Error(`CONFIGURATION_REQUIRED: ${config.missing.join(', ')}`);
}
