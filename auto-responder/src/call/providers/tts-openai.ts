/**
 * OpenAI TTS Provider
 * Adapted from CallMe repository
 *
 * Cloud-based TTS, no self-hosting required.
 * Pricing: ~$15/1M characters
 */

import OpenAI from 'openai';
import type { TTSProvider, TTSConfig } from './types';

export class OpenAITTSProvider implements TTSProvider {
  readonly name = 'openai';
  private client: OpenAI | null = null;
  private voice: string = 'onyx';
  private model: string = 'tts-1';

  initialize(config: TTSConfig): void {
    if (!config.apiKey) {
      throw new Error('OpenAI API key required for TTS');
    }

    this.client = new OpenAI({ apiKey: config.apiKey });
    this.voice = config.voice || 'onyx';
    this.model = config.model || 'tts-1';

    console.log(`[CallService] TTS provider: OpenAI (${this.model}, voice: ${this.voice})`);
  }

  async synthesize(text: string): Promise<Buffer> {
    if (!this.client) throw new Error('OpenAI TTS not initialized');

    const response = await this.client.audio.speech.create({
      model: this.model,
      voice: this.voice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer',
      input: text,
      response_format: 'pcm',
      speed: 1.0,
    });

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Stream TTS audio as chunks arrive from OpenAI
   * Note: OpenAI Node SDK doesn't support true streaming, so we chunk the buffer
   */
  async *synthesizeStream(text: string): AsyncGenerator<Buffer> {
    if (!this.client) throw new Error('OpenAI TTS not initialized');

    // Get full audio first (OpenAI SDK doesn't support true streaming in Node)
    const fullAudio = await this.synthesize(text);

    // Yield in chunks to simulate streaming (8KB chunks)
    const chunkSize = 8192;
    for (let i = 0; i < fullAudio.length; i += chunkSize) {
      yield fullAudio.subarray(i, Math.min(i + chunkSize, fullAudio.length));
    }
  }
}
