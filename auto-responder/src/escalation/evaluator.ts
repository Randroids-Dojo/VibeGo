/**
 * Escalation Evaluator
 *
 * Determines whether an event should be escalated from notification to phone call.
 * Uses pattern matching, LLM decisions, quiet hours, and rate limiting.
 */

import type { IncomingEvent, LLMProvider } from '../types';
import type { CallEscalationConfig } from './config';

export interface EscalationContext {
  event: IncomingEvent;
  eventContent: string;
  notificationSentAt?: number;
  previousCallAt?: number;
  callCountLastHour: number;
}

export interface EscalationResult {
  shouldEscalate: boolean;
  reason: string;
  delayMs?: number;  // Delay before escalating
  skipNotification?: boolean;  // True if should call immediately
}

export class EscalationEvaluator {
  private config: CallEscalationConfig;
  private llmProvider: LLMProvider | null = null;
  private compiledAlwaysCallPatterns: RegExp[] = [];

  constructor(config: CallEscalationConfig, llmProvider?: LLMProvider | null) {
    this.config = config;
    this.llmProvider = llmProvider || null;

    // Pre-compile regex patterns
    this.compiledAlwaysCallPatterns = config.triggers.alwaysCallPatterns.map(
      (pattern) => new RegExp(pattern, 'i')
    );
  }

  /**
   * Evaluate whether to escalate an event to a phone call
   */
  async evaluate(context: EscalationContext): Promise<EscalationResult> {
    // Check if escalation is enabled
    if (!this.config.enabled) {
      return {
        shouldEscalate: false,
        reason: 'Call escalation is disabled',
      };
    }

    // Check event type eligibility
    if (!this.isEventTypeEligible(context.event.event_type)) {
      return {
        shouldEscalate: false,
        reason: `Event type ${context.event.event_type} not configured for escalation`,
      };
    }

    // Check quiet hours
    if (this.isQuietHours()) {
      return {
        shouldEscalate: false,
        reason: 'Currently in quiet hours',
      };
    }

    // Check rate limiting
    const rateLimitResult = this.checkRateLimits(context);
    if (!rateLimitResult.allowed) {
      return {
        shouldEscalate: false,
        reason: rateLimitResult.reason,
      };
    }

    // Check always-call patterns (skip notification, call immediately)
    if (this.matchesAlwaysCallPatterns(context.eventContent)) {
      return {
        shouldEscalate: true,
        reason: 'Matches always-call pattern',
        skipNotification: true,
      };
    }

    // If notification was sent, check if timeout has elapsed
    if (context.notificationSentAt) {
      const elapsed = Date.now() - context.notificationSentAt;
      const timeoutMs = this.config.triggers.notificationTimeoutSeconds * 1000;

      if (elapsed < timeoutMs) {
        return {
          shouldEscalate: false,
          reason: 'Notification timeout not yet elapsed',
          delayMs: timeoutMs - elapsed,
        };
      }
    }

    // Use LLM for decision if enabled
    if (this.config.triggers.useLlmForEscalation && this.llmProvider) {
      const llmResult = await this.evaluateWithLLM(context);
      return llmResult;
    }

    // Default: escalate after notification timeout
    return {
      shouldEscalate: true,
      reason: 'Notification timeout elapsed',
    };
  }

  /**
   * Check if event type is eligible for escalation
   */
  private isEventTypeEligible(eventType: string): boolean {
    switch (eventType) {
      case 'permission_prompt':
        return this.config.triggers.escalatePermissions;
      case 'AskUserQuestion':
        return this.config.triggers.escalateQuestions;
      case 'idle_prompt':
        return this.config.triggers.escalateOnIdle;
      default:
        return false;
    }
  }

  /**
   * Check if currently in quiet hours
   */
  private isQuietHours(): boolean {
    if (!this.config.quietHours.enabled) {
      return false;
    }

    try {
      const now = new Date();
      const timezone = this.config.quietHours.timezone;

      // Get current time in configured timezone
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const parts = formatter.formatToParts(now);
      const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
      const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
      const currentMinutes = hour * 60 + minute;

      // Parse start and end times
      const [startHour, startMinute] = this.config.quietHours.start.split(':').map(Number);
      const [endHour, endMinute] = this.config.quietHours.end.split(':').map(Number);
      const startMinutes = startHour * 60 + startMinute;
      const endMinutes = endHour * 60 + endMinute;

      // Handle overnight quiet hours (e.g., 22:00 to 08:00)
      if (startMinutes > endMinutes) {
        // Overnight: quiet if current >= start OR current < end
        return currentMinutes >= startMinutes || currentMinutes < endMinutes;
      } else {
        // Same day: quiet if current >= start AND current < end
        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
      }
    } catch (error) {
      console.error('[EscalationEvaluator] Error checking quiet hours:', error);
      return false;
    }
  }

  /**
   * Check rate limits
   */
  private checkRateLimits(
    context: EscalationContext
  ): { allowed: boolean; reason: string } {
    // Check minimum interval since last call
    if (context.previousCallAt) {
      const elapsed = Date.now() - context.previousCallAt;
      const minInterval = this.config.rateLimiting.minCallIntervalSeconds * 1000;

      if (elapsed < minInterval) {
        const waitSeconds = Math.ceil((minInterval - elapsed) / 1000);
        return {
          allowed: false,
          reason: `Rate limit: must wait ${waitSeconds}s before next call`,
        };
      }
    }

    // Check hourly limit
    if (context.callCountLastHour >= this.config.rateLimiting.maxCallsPerHour) {
      return {
        allowed: false,
        reason: `Rate limit: max ${this.config.rateLimiting.maxCallsPerHour} calls/hour reached`,
      };
    }

    return { allowed: true, reason: '' };
  }

  /**
   * Check if content matches always-call patterns
   */
  private matchesAlwaysCallPatterns(content: string): boolean {
    return this.compiledAlwaysCallPatterns.some((pattern) => pattern.test(content));
  }

  /**
   * Use LLM to evaluate if escalation is warranted
   */
  private async evaluateWithLLM(context: EscalationContext): Promise<EscalationResult> {
    if (!this.llmProvider) {
      return {
        shouldEscalate: false,
        reason: 'LLM provider not available',
      };
    }

    try {
      const prompt = this.config.triggers.llmEscalationPrompt || '';
      const project = context.event.cwd.split('/').slice(-2).join('/');

      const result = await this.llmProvider.analyze({
        promptType: 'question',
        content: `${prompt}\n\nEvent type: ${context.event.event_type}\nProject: ${project}\nContent: ${context.eventContent}`,
        context: {
          project,
          cwd: context.event.cwd,
        },
      });

      // Parse LLM response - look for JSON or boolean indicators
      const responseText = result.response?.toLowerCase() || '';
      let shouldCall = false;
      let reason = 'LLM decision';

      // Try to parse as JSON
      try {
        const jsonMatch = result.response?.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          shouldCall = parsed.shouldCall === true;
          reason = parsed.reason || reason;
        }
      } catch {
        // Fall back to keyword detection
        shouldCall =
          responseText.includes('yes') ||
          responseText.includes('call') ||
          responseText.includes('true');
      }

      return {
        shouldEscalate: shouldCall,
        reason: `LLM: ${reason}`,
      };
    } catch (error) {
      console.error('[EscalationEvaluator] LLM evaluation failed:', error);
      return {
        shouldEscalate: false,
        reason: 'LLM evaluation failed',
      };
    }
  }

  /**
   * Format call message based on event type
   */
  formatCallMessage(eventType: string, content: string): string {
    const scripts = this.config.callScripts;

    let message = scripts.greeting + ' ';

    switch (eventType) {
      case 'permission_prompt':
        message += scripts.permissionPrompt.replace('{action}', content);
        break;
      case 'AskUserQuestion':
        message += scripts.questionPrompt.replace('{question}', content);
        break;
      default:
        message += content;
    }

    return message;
  }

  /**
   * Get the goodbye message
   */
  getGoodbyeMessage(): string {
    return this.config.callScripts.goodbye;
  }
}
