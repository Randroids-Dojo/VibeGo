import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as YAML from 'yaml';
import { Config, CallEscalationConfig } from './types';

// Default call escalation configuration
const defaultCallEscalationConfig: CallEscalationConfig = {
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
Respond with JSON: {"shouldCall": true/false, "reason": "..."}`,
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
    greeting: 'Hey! Claude Code needs your attention.',
    permissionPrompt: 'I need permission to {action}. Should I proceed?',
    questionPrompt: 'I have a question: {question}',
    errorPrompt: 'I encountered an issue: {error}. How should I proceed?',
    goodbye: "Got it! I'll continue working. Talk soon!",
  },
};

// Default configuration
const defaultConfig: Config = {
  version: '1.0',
  service: {
    socket_path: '/tmp/vibego-responder.sock',
    log_file: path.join(os.homedir(), '.vibego', 'logs', 'auto-responder.log'),
    log_level: 'info',
  },
  llm: {
    provider: 'claude',
    claude: {
      api_key_env: 'ANTHROPIC_API_KEY',
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
    },
    openai: {
      api_key_env: 'OPENAI_API_KEY',
      model: 'gpt-4o',
      max_tokens: 500,
    },
    ollama: {
      base_url: 'http://localhost:11434',
      model: 'llama3.2',
    },
  },
  rules: {
    enabled: true,
    dry_run: false,
    default_action: 'notify',
    prompts: {
      questions: {
        enabled: true,
        auto_respond_patterns: [
          'Should I proceed\\?',
          'Do you want me to continue\\?',
          'Is this okay\\?',
          'Ready to proceed\\?',
          'Shall I (create|continue|proceed).*\\?',
          'Would you like me to.*\\?',
        ],
        always_notify_patterns: [
          'delete|remove|drop',
          'password|secret|credential|api.?key',
          'production|prod',
          'push|deploy',
          'payment|billing|charge',
        ],
        default_response: 'yes',
        use_llm_for_response: true,
      },
      permissions: {
        enabled: true,
        auto_respond_patterns: [
          'Read file',
          'List directory',
          'Search|Glob|Grep',
        ],
        always_notify_patterns: [
          'Write|Edit|Create|Delete',
          'Bash|Execute',
        ],
        grant_response: 'y',
        deny_response: 'n',
      },
      idle: {
        enabled: false,
      },
    },
  },
  tmux: {
    default_session: 'mobile',
    response_delay_ms: 100,
  },
  notifications: {
    always_notify: false,
    notify_on_skip: true,
  },
  callEscalation: defaultCallEscalationConfig,
};

// Resolve ~ to home directory
function expandPath(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

// Deep merge utility - merges source into target recursively
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };

  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (
      sourceValue !== undefined &&
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      );
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue;
    }
  }

  return result;
}

// Config file search paths (in order of precedence)
const configPaths = [
  path.join(os.homedir(), '.config', 'vibego', 'auto-responder.yaml'),
  path.join(os.homedir(), '.config', 'vibego', 'auto-responder.yml'),
  path.join(os.homedir(), '.vibego', 'config.yaml'),
  path.join(os.homedir(), '.vibego', 'config.yml'),
];

let loadedConfig: Config | null = null;

export function loadConfig(): Config {
  if (loadedConfig) {
    return loadedConfig;
  }

  let userConfig: Partial<Config> = {};

  // Find and load config file
  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        userConfig = YAML.parse(content) as Partial<Config>;
        console.log(`Loaded config from: ${configPath}`);
        break;
      } catch (error) {
        console.error(`Error parsing config file ${configPath}:`, error);
      }
    }
  }

  // Merge with defaults
  const merged = deepMerge(
    defaultConfig as unknown as Record<string, unknown>,
    userConfig as unknown as Record<string, unknown>
  ) as unknown as Config;

  // Expand paths
  merged.service.socket_path = expandPath(merged.service.socket_path);
  merged.service.log_file = expandPath(merged.service.log_file);

  // Ensure log directory exists
  const logDir = path.dirname(merged.service.log_file);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  loadedConfig = merged;
  return loadedConfig;
}

export function getConfig(): Config {
  if (!loadedConfig) {
    return loadConfig();
  }
  return loadedConfig;
}
