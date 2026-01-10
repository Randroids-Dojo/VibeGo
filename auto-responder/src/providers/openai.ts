import OpenAI from 'openai';
import { LLMProvider, LLMRequest, LLMResponse, OpenAIProviderConfig } from '../types';
import { getLogger } from '../logger';

const ANALYSIS_SYSTEM_PROMPT = `You are an assistant helping to triage prompts from Claude Code.

Your job is to analyze the prompt and decide:
1. Should this be auto-responded to? (routine confirmation, safe operation)
2. Should the user be notified? (important decision, destructive action, sensitive data)
3. Should this be ignored? (informational only)

RULES:
- NEVER auto-respond to anything involving: deletion, production systems, credentials, payments, pushing code
- ALWAYS notify for: file writes, bash commands, anything irreversible
- Safe to auto-respond: read operations, confirmations to proceed, routine questions

Respond ONLY with valid JSON (no markdown, no code blocks):
{"action": "auto_respond" | "notify" | "ignore", "response": "string to send if auto_respond", "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private client: OpenAI;
  private model: string;
  private maxTokens: number;

  constructor(config: OpenAIProviderConfig) {
    const apiKey = process.env[config.api_key_env];
    if (!apiKey) {
      throw new Error(
        `OpenAI API key not found. Set the ${config.api_key_env} environment variable.`
      );
    }

    this.client = new OpenAI({ apiKey });
    this.model = config.model;
    this.maxTokens = config.max_tokens ?? 500;
  }

  async analyze(request: LLMRequest): Promise<LLMResponse> {
    const logger = getLogger();

    const userMessage = `Prompt type: ${request.promptType}
Project: ${request.context.project}
Working directory: ${request.context.cwd}

Prompt content:
${request.content}`;

    logger.debug('Sending to OpenAI API', {
      model: this.model,
      contentLength: request.content.length,
    });

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [
          {
            role: 'system',
            content: ANALYSIS_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from OpenAI');
      }

      const parsed = JSON.parse(content) as LLMResponse;

      logger.debug('OpenAI response', parsed);

      return {
        action: parsed.action,
        response: parsed.response,
        confidence: parsed.confidence ?? 0.5,
        reasoning: parsed.reasoning,
      };
    } catch (error) {
      logger.error('OpenAI API error', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Return safe default on error
      return {
        action: 'notify',
        confidence: 0,
        reasoning: 'Error communicating with OpenAI API',
      };
    }
  }
}
