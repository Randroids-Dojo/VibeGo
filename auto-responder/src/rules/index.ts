import { RulesConfig, RuleEvaluation, IncomingEvent, PromptRules } from '../types';
import { matchesAny, extractContent, mapEventTypeToPromptType } from './matchers';
import { getLogger } from '../logger';

export class RuleEngine {
  private config: RulesConfig;

  constructor(config: RulesConfig) {
    this.config = config;
  }

  /**
   * Get the rules for a specific prompt type
   */
  private getPromptRules(eventType: string): PromptRules | null {
    const promptType = mapEventTypeToPromptType(eventType);

    switch (promptType) {
      case 'question':
        return this.config.prompts.questions;
      case 'permission':
        return this.config.prompts.permissions;
      case 'idle':
        return this.config.prompts.idle;
      default:
        return null;
    }
  }

  /**
   * Evaluate an event against the rules
   */
  evaluate(event: IncomingEvent): RuleEvaluation {
    const logger = getLogger();
    const content = extractContent(event.event_data, event.event_type);

    logger.debug('Evaluating event', {
      event_type: event.event_type,
      content: content.substring(0, 100),
    });

    // Check if rules are globally enabled
    if (!this.config.enabled) {
      return {
        shouldAutoRespond: false,
        reason: 'Rules globally disabled',
        requiresLLM: false,
      };
    }

    // Get prompt-specific rules
    const promptRules = this.getPromptRules(event.event_type);
    if (!promptRules) {
      return {
        shouldAutoRespond: false,
        reason: 'Unknown event type',
        requiresLLM: false,
      };
    }

    // Check if this prompt type is enabled
    if (!promptRules.enabled) {
      return {
        shouldAutoRespond: false,
        reason: `Prompt type ${event.event_type} disabled`,
        requiresLLM: false,
      };
    }

    // SAFETY FIRST: Check always_notify_patterns
    // These patterns should NEVER be auto-responded to
    if (
      promptRules.always_notify_patterns &&
      matchesAny(content, promptRules.always_notify_patterns)
    ) {
      logger.info('Safety pattern matched - forcing notification', {
        content: content.substring(0, 100),
      });
      return {
        shouldAutoRespond: false,
        reason: 'Matches safety/always_notify pattern',
        requiresLLM: false,
      };
    }

    // Check auto_respond_patterns
    if (
      promptRules.auto_respond_patterns &&
      matchesAny(content, promptRules.auto_respond_patterns)
    ) {
      const suggestedResponse = this.getSuggestedResponse(promptRules);
      const requiresLLM = promptRules.use_llm_for_response ?? false;

      logger.debug('Auto-respond pattern matched', {
        suggestedResponse,
        requiresLLM,
      });

      return {
        shouldAutoRespond: true,
        reason: 'Matches auto-respond pattern',
        suggestedResponse,
        requiresLLM,
      };
    }

    // No pattern matched - use default action
    const shouldAutoRespond = this.config.default_action === 'auto_respond';

    return {
      shouldAutoRespond,
      reason: `Default action: ${this.config.default_action}`,
      suggestedResponse: shouldAutoRespond
        ? this.getSuggestedResponse(promptRules)
        : undefined,
      requiresLLM: shouldAutoRespond, // Let LLM decide for ambiguous cases
    };
  }

  /**
   * Get the suggested response based on prompt type
   */
  private getSuggestedResponse(rules: PromptRules): string {
    // For permissions, use grant_response
    if (rules.grant_response) {
      return rules.grant_response;
    }
    // For questions, use default_response
    if (rules.default_response) {
      return rules.default_response;
    }
    // Fallback
    return 'yes';
  }
}

export { extractContent, mapEventTypeToPromptType } from './matchers';
