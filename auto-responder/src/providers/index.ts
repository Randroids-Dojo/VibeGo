import { LLMProvider, LLMConfig } from '../types';
import { ClaudeProvider } from './claude';
import { OpenAIProvider } from './openai';
import { OllamaProvider } from './ollama';
import { getLogger } from '../logger';

/**
 * Create an LLM provider based on configuration
 */
export function createProvider(config: LLMConfig): LLMProvider {
  const logger = getLogger();

  switch (config.provider) {
    case 'claude':
      logger.info('Initializing Claude provider', { model: config.claude.model });
      return new ClaudeProvider(config.claude);

    case 'openai':
      logger.info('Initializing OpenAI provider', { model: config.openai.model });
      return new OpenAIProvider(config.openai);

    case 'ollama':
      logger.info('Initializing Ollama provider', {
        model: config.ollama.model,
        baseUrl: config.ollama.base_url,
      });
      return new OllamaProvider(config.ollama);

    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

export { ClaudeProvider } from './claude';
export { OpenAIProvider } from './openai';
export { OllamaProvider } from './ollama';
