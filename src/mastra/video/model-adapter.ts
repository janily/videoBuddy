import { Agent } from '@mastra/core/agent';
import type { Environment } from '@/services/video/config/environment';
export type AgentRole = 'director' | 'visual' | 'audio' | 'critic';
export function configuredModel(role: AgentRole, env: Environment = process.env) {
  const provider = env.MODEL_PROVIDER || 'openai-compatible';
  let model = env[`VIDEO_${role.toUpperCase()}_MODEL`];
  if (!model || !env.MODEL_API_KEY) throw new Error('CONFIGURATION_REQUIRED: actual model ID and API key');
  if (!['openai-compatible','openai','openrouter','google'].includes(provider)) throw new Error('PROVIDER_UNSUPPORTED');
  if (provider === 'openai-compatible' && !env.MODEL_BASE_URL) throw new Error('CONFIGURATION_REQUIRED: MODEL_BASE_URL');
  if (model.startsWith(provider + '/')) model = model.slice(provider.length + 1);
  const providerId = provider === 'openai-compatible' ? 'openai' : provider;
  return { id: `${providerId}/${model}` as `${string}/${string}`, apiKey: env.MODEL_API_KEY, url: env.MODEL_BASE_URL, ...(provider === 'openai-compatible' ? { api: 'chat' as const } : {}) };
}
export function createVideoAgent(role: AgentRole, instructions: string, env: Environment = process.env) {
  return new Agent({ id: `video-${role}`, name: `VideoBuddy ${role}`, instructions, maxRetries:0, model: configuredModel(role,env) });
}
