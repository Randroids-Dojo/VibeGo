/**
 * Provider Factory
 * Adapted from CallMe repository
 *
 * Creates and configures providers based on configuration.
 * Supports Telnyx for phone, OpenAI for TTS and Realtime STT.
 */

import type { PhoneProvider, TTSProvider, RealtimeSTTProvider, ProviderRegistry } from './types';
import { TelnyxPhoneProvider } from './phone-telnyx';
import { OpenAITTSProvider } from './tts-openai';
import { OpenAIRealtimeSTTProvider } from './stt-openai-realtime';

export * from './types';

export type PhoneProviderType = 'telnyx';

export interface ProviderConfig {
  // Phone provider selection
  phoneProvider: PhoneProviderType;

  // Phone credentials
  // Telnyx: accountSid = Connection ID, authToken = API Key
  phoneAccountSid: string;
  phoneAuthToken: string;
  phoneNumber: string;

  // Telnyx webhook public key (for signature verification)
  telnyxPublicKey?: string;

  // OpenAI (TTS + STT)
  openaiApiKey: string;
  ttsVoice?: string;
  sttModel?: string;
  sttSilenceDurationMs?: number;
}

export function createPhoneProvider(config: ProviderConfig): PhoneProvider {
  const provider = new TelnyxPhoneProvider();

  provider.initialize({
    accountSid: config.phoneAccountSid,
    authToken: config.phoneAuthToken,
    phoneNumber: config.phoneNumber,
  });

  return provider;
}

export function createTTSProvider(config: ProviderConfig): TTSProvider {
  const provider = new OpenAITTSProvider();
  provider.initialize({
    apiKey: config.openaiApiKey,
    voice: config.ttsVoice,
  });
  return provider;
}

export function createSTTProvider(config: ProviderConfig): RealtimeSTTProvider {
  const provider = new OpenAIRealtimeSTTProvider();
  provider.initialize({
    apiKey: config.openaiApiKey,
    model: config.sttModel,
    silenceDurationMs: config.sttSilenceDurationMs,
  });
  return provider;
}

export function createProviders(config: ProviderConfig): ProviderRegistry {
  return {
    phone: createPhoneProvider(config),
    tts: createTTSProvider(config),
    stt: createSTTProvider(config),
  };
}

/**
 * Validate that required config is present
 */
export function validateProviderConfig(config: ProviderConfig): string[] {
  const errors: string[] = [];

  if (!config.phoneAccountSid) {
    errors.push('Missing phone account SID (Telnyx Connection ID)');
  }
  if (!config.phoneAuthToken) {
    errors.push('Missing phone auth token (Telnyx API Key)');
  }
  if (!config.phoneNumber) {
    errors.push('Missing phone number');
  }
  if (!config.openaiApiKey) {
    errors.push('Missing OpenAI API key');
  }

  return errors;
}
