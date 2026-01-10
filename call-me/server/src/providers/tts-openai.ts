/**
 * OpenAI TTS Provider
 *
 * Cloud-based TTS, no self-hosting required.
 * More expensive than self-hosted alternatives but zero setup.
 *
 * Pricing: ~$15/1M characters
 */

import OpenAI from 'openai';
import type { TTSProvider, TTSConfig } from './types.js';

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

    console.error(`TTS provider: OpenAI (${this.model}, voice: ${this.voice})`);
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
   * Yields Buffer chunks of PCM audio data
   */
  async *synthesizeStream(text: string): AsyncGenerator<Buffer> {
    if (!this.client) throw new Error('OpenAI TTS not initialized');

    const response = await this.client.audio.speech.create({
      model: this.model,
      voice: this.voice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer',
      input: text,
      response_format: 'pcm',
      speed: 1.0,
    });

    // Get the response body as a readable stream
    const body = response.body;
    if (!body) {
      throw new Error('No response body from OpenAI TTS');
    }

    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          yield Buffer.from(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
