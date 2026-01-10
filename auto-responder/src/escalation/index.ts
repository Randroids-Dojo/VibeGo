/**
 * Escalation Module
 *
 * Provides escalation evaluation and configuration for phone calls.
 */

export { EscalationEvaluator } from './evaluator';
export type { EscalationContext, EscalationResult } from './evaluator';
export {
  defaultCallEscalationConfig,
  buildProviderConfig,
} from './config';
export type {
  CallEscalationConfig,
  CallMeConfig,
  EscalationTriggers,
  QuietHoursConfig,
  RateLimitingConfig,
  CallScriptsConfig,
} from './config';
