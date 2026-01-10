/**
 * Escalation Configuration Types
 *
 * Defines the configuration schema for call escalation behavior.
 */

import type { ProviderConfig } from '../call/providers';

/**
 * CallMe provider configuration
 */
export interface CallMeConfig {
  phoneProvider: 'telnyx';
  phoneAccountSidEnv: string;
  phoneAuthTokenEnv: string;
  phoneNumberEnv: string;
  userPhoneNumberEnv: string;
  openaiApiKeyEnv: string;
  ngrokAuthtokenEnv: string;
  ngrokDomain?: string;
  port: number;
  ttsVoice: string;
  telnyxPublicKeyEnv?: string;
}

/**
 * Escalation trigger configuration
 */
export interface EscalationTriggers {
  // After push notification, wait this long before calling
  notificationTimeoutSeconds: number;

  // Patterns that should ALWAYS trigger a call (bypass notification)
  alwaysCallPatterns: string[];

  // Event types to consider for escalation
  escalatePermissions: boolean;
  escalateQuestions: boolean;
  escalateOnIdle: boolean;

  // Let LLM decide if situation warrants a call
  useLlmForEscalation: boolean;
  llmEscalationPrompt?: string;
}

/**
 * Quiet hours configuration (when not to call)
 */
export interface QuietHoursConfig {
  enabled: boolean;
  start: string;  // "22:00"
  end: string;    // "08:00"
  timezone: string;
  fallback: 'notify' | 'queue_for_morning';
}

/**
 * Rate limiting to prevent call spam
 */
export interface RateLimitingConfig {
  minCallIntervalSeconds: number;
  maxCallsPerHour: number;
}

/**
 * Call scripts for different scenarios
 */
export interface CallScriptsConfig {
  greeting: string;
  permissionPrompt: string;
  questionPrompt: string;
  errorPrompt: string;
  goodbye: string;
}

/**
 * Full call escalation configuration
 */
export interface CallEscalationConfig {
  enabled: boolean;
  callme: CallMeConfig;
  triggers: EscalationTriggers;
  quietHours: QuietHoursConfig;
  rateLimiting: RateLimitingConfig;
  callScripts: CallScriptsConfig;
}

/**
 * Default call escalation configuration
 */
export const defaultCallEscalationConfig: CallEscalationConfig = {
  enabled: false,

  callme: {
    phoneProvider: 'telnyx',
    phoneAccountSidEnv: 'CALLME_PHONE_ACCOUNT_SID',
    phoneAuthTokenEnv: 'CALLME_PHONE_AUTH_TOKEN',
    phoneNumberEnv: 'CALLME_PHONE_NUMBER',
    userPhoneNumberEnv: 'CALLME_USER_PHONE_NUMBER',
    openaiApiKeyEnv: 'CALLME_OPENAI_API_KEY',
    ngrokAuthtokenEnv: 'CALLME_NGROK_AUTHTOKEN',
    port: 3333,
    ttsVoice: 'onyx',
    telnyxPublicKeyEnv: 'CALLME_TELNYX_PUBLIC_KEY',
  },

  triggers: {
    notificationTimeoutSeconds: 120,
    alwaysCallPatterns: [
      'error.*critical',
      'failed.*production',
      'security.*vulnerability',
    ],
    escalatePermissions: true,
    escalateQuestions: false,
    escalateOnIdle: false,
    useLlmForEscalation: true,
    llmEscalationPrompt: `Decide if this Claude Code event warrants calling the user on the phone.
Call for: critical errors, blocked situations, important decisions.
Don't call for: simple confirmations, routine questions, minor issues.
Respond with JSON: {"shouldCall": true/false, "reason": "..."}`
  },

  quietHours: {
    enabled: true,
    start: '22:00',
    end: '08:00',
    timezone: 'America/Los_Angeles',
    fallback: 'notify',
  },

  rateLimiting: {
    minCallIntervalSeconds: 300,
    maxCallsPerHour: 3,
  },

  callScripts: {
    greeting: "Hey! Claude Code needs your attention.",
    permissionPrompt: "I need permission to {action}. Should I proceed?",
    questionPrompt: "I have a question: {question}",
    errorPrompt: "I encountered an issue: {error}. How should I proceed?",
    goodbye: "Got it! I'll continue working. Talk soon!",
  },
};

/**
 * Build provider config from CallMeConfig using environment variables
 */
export function buildProviderConfig(config: CallMeConfig): ProviderConfig {
  return {
    phoneProvider: config.phoneProvider,
    phoneAccountSid: process.env[config.phoneAccountSidEnv] || '',
    phoneAuthToken: process.env[config.phoneAuthTokenEnv] || '',
    phoneNumber: process.env[config.phoneNumberEnv] || '',
    openaiApiKey: process.env[config.openaiApiKeyEnv] || '',
    ttsVoice: config.ttsVoice,
    telnyxPublicKey: config.telnyxPublicKeyEnv
      ? process.env[config.telnyxPublicKeyEnv]
      : undefined,
  };
}
