// Types for VibeGo Auto-Responder Service

// Configuration types
export interface ServiceConfig {
  socket_path: string;
  log_file: string;
  log_level: 'debug' | 'info' | 'warn' | 'error';
}

export interface ClaudeProviderConfig {
  api_key_env: string;
  model: string;
  max_tokens?: number;
}

export interface OpenAIProviderConfig {
  api_key_env: string;
  model: string;
  max_tokens?: number;
}

export interface OllamaProviderConfig {
  base_url: string;
  model: string;
}

export interface LLMConfig {
  provider: 'claude' | 'openai' | 'ollama';
  claude: ClaudeProviderConfig;
  openai: OpenAIProviderConfig;
  ollama: OllamaProviderConfig;
}

export interface PromptRules {
  enabled: boolean;
  auto_respond_patterns?: string[];
  always_notify_patterns?: string[];
  default_response?: string;
  grant_response?: string;
  deny_response?: string;
  use_llm_for_response?: boolean;
}

export interface RulesConfig {
  enabled: boolean;
  dry_run: boolean;
  default_action: 'auto_respond' | 'notify' | 'ignore';
  prompts: {
    questions: PromptRules;
    permissions: PromptRules;
    idle: PromptRules;
  };
}

export interface TmuxConfig {
  default_session: string;
  response_delay_ms: number;
}

export interface NotificationsConfig {
  always_notify: boolean;
  notify_on_skip: boolean;
}

// Call escalation types (re-exported from escalation module)
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

export interface EscalationTriggers {
  notificationTimeoutSeconds: number;
  alwaysCallPatterns: string[];
  escalatePermissions: boolean;
  escalateQuestions: boolean;
  escalateOnIdle: boolean;
  useLlmForEscalation: boolean;
  llmEscalationPrompt?: string;
}

export interface QuietHoursConfig {
  enabled: boolean;
  start: string;
  end: string;
  timezone: string;
  fallback: 'notify' | 'queue_for_morning';
}

export interface RateLimitingConfig {
  minCallIntervalSeconds: number;
  maxCallsPerHour: number;
}

export interface CallScriptsConfig {
  greeting: string;
  permissionPrompt: string;
  questionPrompt: string;
  errorPrompt: string;
  goodbye: string;
}

export interface CallEscalationConfig {
  enabled: boolean;
  callme: CallMeConfig;
  triggers: EscalationTriggers;
  quietHours: QuietHoursConfig;
  rateLimiting: RateLimitingConfig;
  callScripts: CallScriptsConfig;
}

export interface Config {
  version: string;
  service: ServiceConfig;
  llm: LLMConfig;
  rules: RulesConfig;
  tmux: TmuxConfig;
  notifications: NotificationsConfig;
  callEscalation?: CallEscalationConfig;
}

// Event types from Claude Code hooks
export interface TmuxContext {
  session: string;
  window: string;
  pane: string;
}

export interface IncomingEvent {
  event_type: 'AskUserQuestion' | 'permission_prompt' | 'idle_prompt';
  event_data: Record<string, unknown>;
  tmux: TmuxContext;
  cwd: string;
  timestamp: string;
}

// LLM provider types
export type PromptType = 'question' | 'permission' | 'idle';

export interface LLMRequest {
  promptType: PromptType;
  content: string;
  context: {
    project: string;
    cwd: string;
  };
}

export interface LLMResponse {
  action: 'auto_respond' | 'notify' | 'ignore';
  response?: string;
  confidence: number;
  reasoning?: string;
}

export interface LLMProvider {
  name: string;
  analyze(request: LLMRequest): Promise<LLMResponse>;
}

// Rule engine types
export interface RuleEvaluation {
  shouldAutoRespond: boolean;
  reason: string;
  suggestedResponse?: string;
  requiresLLM: boolean;
}

// Service response types
export interface ServiceResponse {
  handled: boolean;
  action: 'auto_respond' | 'notify' | 'ignore' | 'escalate_call';
  dry_run?: boolean;
  error?: string;
  callId?: string;  // If escalate_call, the call ID
}
