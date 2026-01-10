import { LLMProvider, LLMRequest, LLMResponse, OllamaProviderConfig } from '../types';
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

interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
}

export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  private baseUrl: string;
  private model: string;

  constructor(config: OllamaProviderConfig) {
    this.baseUrl = config.base_url.replace(/\/$/, ''); // Remove trailing slash
    this.model = config.model;
  }

  async analyze(request: LLMRequest): Promise<LLMResponse> {
    const logger = getLogger();

    const prompt = `${ANALYSIS_SYSTEM_PROMPT}

Prompt type: ${request.promptType}
Project: ${request.context.project}
Working directory: ${request.context.cwd}

Prompt content:
${request.content}`;

    logger.debug('Sending to Ollama', {
      model: this.model,
      contentLength: request.content.length,
    });

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          format: 'json',
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API returned ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as OllamaResponse;

      if (!data.response) {
        throw new Error('Empty response from Ollama');
      }

      // Try to parse JSON from the response
      // Ollama might return some extra text, so we try to extract JSON
      let jsonStr = data.response;

      // Try to find JSON object in the response
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const parsed = JSON.parse(jsonStr) as LLMResponse;

      logger.debug('Ollama response', parsed);

      return {
        action: parsed.action,
        response: parsed.response,
        confidence: parsed.confidence ?? 0.5,
        reasoning: parsed.reasoning,
      };
    } catch (error) {
      logger.error('Ollama API error', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Return safe default on error
      return {
        action: 'notify',
        confidence: 0,
        reasoning: 'Error communicating with Ollama',
      };
    }
  }

  /**
   * Check if Ollama is running and the model is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        return false;
      }

      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = data.models ?? [];

      return models.some(
        (m) => m.name === this.model || m.name.startsWith(`${this.model}:`)
      );
    } catch {
      return false;
    }
  }
}
