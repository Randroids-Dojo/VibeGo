/**
 * Call Manager
 * Adapted from CallMe repository
 *
 * Handles phone call orchestration, audio streaming, and transcription.
 */

import WebSocket, { WebSocketServer } from 'ws';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import OpenAI from 'openai';
import {
  createProviders,
  validateProviderConfig,
  type ProviderRegistry,
  type ProviderConfig,
  type RealtimeSTTSession,
} from './providers';
import {
  validateTelnyxSignature,
  generateWebSocketToken,
  validateWebSocketToken,
} from './webhook-security';

// Conversation message type
interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface CallState {
  callId: string;
  callControlId: string | null;
  userPhoneNumber: string;
  ws: WebSocket | null;
  streamSid: string | null;
  streamingReady: boolean;
  wsToken: string;
  conversationHistory: Array<{ speaker: 'claude' | 'user'; message: string }>;
  startTime: number;
  hungUp: boolean;
  sttSession: RealtimeSTTSession | null;
}

export interface CallManagerConfig {
  publicUrl: string;
  port: number;
  phoneNumber: string;
  userPhoneNumber: string;
  providers: ProviderRegistry;
  providerConfig: ProviderConfig;
  transcriptTimeoutMs: number;
  openaiApiKey: string;
}

// Callback for when call completes with a response to route
export type CallCompletionCallback = (callId: string, response: string, context: Record<string, unknown>) => void;

export function createCallManagerConfig(
  publicUrl: string,
  providerConfig: ProviderConfig,
  userPhoneNumber: string,
  openaiApiKey: string
): CallManagerConfig {
  const errors = validateProviderConfig(providerConfig);

  if (!userPhoneNumber) {
    errors.push('Missing user phone number');
  }

  if (!openaiApiKey) {
    errors.push('Missing OpenAI API key for conversation');
  }

  if (errors.length > 0) {
    throw new Error(`Missing required configuration:\n  - ${errors.join('\n  - ')}`);
  }

  const providers = createProviders(providerConfig);

  return {
    publicUrl,
    port: 3333,
    phoneNumber: providerConfig.phoneNumber,
    userPhoneNumber,
    providers,
    providerConfig,
    transcriptTimeoutMs: 180000, // 3 minutes
    openaiApiKey,
  };
}

export class CallManager {
  private activeCalls = new Map<string, CallState>();
  private callControlIdToCallId = new Map<string, string>();
  private wsTokenToCallId = new Map<string, string>();
  private httpServer: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private config: CallManagerConfig;
  private currentCallId = 0;

  constructor(config: CallManagerConfig) {
    this.config = config;
  }

  startServer(): void {
    this.httpServer = createServer((req, res) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);

      if (url.pathname === '/twiml') {
        this.handlePhoneWebhook(req, res);
        return;
      }

      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', activeCalls: this.activeCalls.size }));
        return;
      }

      if (url.pathname === '/call-status.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const activeCalls = Array.from(this.activeCalls.values()).map(c => ({
          callId: c.callId,
          startTime: c.startTime,
          hungUp: c.hungUp,
        }));
        res.end(JSON.stringify({ activeCalls }));
        return;
      }

      // Test call endpoint (simple: play message, get response)
      if (url.pathname === '/test-call' && req.method === 'POST') {
        this.handleTestCall(req, res);
        return;
      }

      // Conversation call endpoint (full LLM conversation with tmux context)
      // This should be called via the CallService, not directly
      if (url.pathname === '/conversation-call' && req.method === 'POST') {
        this.handleConversationCall(req, res);
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    this.wss = new WebSocketServer({ noServer: true });

    this.httpServer.on('upgrade', (request: IncomingMessage, socket: unknown, head: Buffer) => {
      const url = new URL(request.url!, `http://${request.headers.host}`);
      if (url.pathname === '/media-stream') {
        const token = url.searchParams.get('token');
        let callId = token ? this.wsTokenToCallId.get(token) : null;

        if (token && callId) {
          const state = this.activeCalls.get(callId);
          if (!state || !validateWebSocketToken(state.wsToken, token)) {
            console.error('[CallManager] Rejecting WebSocket: token validation failed');
            (socket as { write: (data: string) => void; destroy: () => void }).write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            (socket as { destroy: () => void }).destroy();
            return;
          }
          console.log(`[CallManager] WebSocket token validated for call ${callId}`);
        } else if (!callId) {
          // Fallback for ngrok free tier
          const isNgrokFreeTier = new URL(this.config.publicUrl).hostname.endsWith('.ngrok-free.dev');
          if (isNgrokFreeTier) {
            const activeCallIds = Array.from(this.activeCalls.keys());
            if (activeCallIds.length > 0) {
              callId = activeCallIds[activeCallIds.length - 1];
              console.log(`[CallManager] Token not found, using fallback call ID: ${callId}`);
            } else {
              callId = `pending-${Date.now()}`;
              console.log(`[CallManager] No active calls, using placeholder: ${callId}`);
            }
          } else {
            console.error('[CallManager] Rejecting WebSocket: missing or invalid token');
            (socket as { write: (data: string) => void; destroy: () => void }).write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            (socket as { destroy: () => void }).destroy();
            return;
          }
        }

        console.log(`[CallManager] Accepting WebSocket for: ${callId}`);
        this.wss!.handleUpgrade(request, socket as never, head, (ws) => {
          this.wss!.emit('connection', ws, request, callId);
        });
      } else {
        (socket as { destroy: () => void }).destroy();
      }
    });

    this.wss.on('connection', (ws: WebSocket, _request: IncomingMessage, callId: string) => {
      console.log(`[CallManager] Media stream WebSocket connected for call ${callId}`);

      const state = this.activeCalls.get(callId);
      if (state) {
        state.ws = ws;
      }

      ws.on('message', (message: Buffer | string) => {
        const msgBuffer = Buffer.isBuffer(message) ? message : Buffer.from(message);

        if (msgBuffer.length > 0 && msgBuffer[0] === 0x7b) {
          try {
            const msg = JSON.parse(msgBuffer.toString());
            const msgState = this.activeCalls.get(callId);

            if (msg.event === 'start' && msg.streamSid && msgState) {
              msgState.streamSid = msg.streamSid;
              console.log(`[${callId}] Captured streamSid: ${msg.streamSid}`);
            }

            if (msg.event === 'stop' && msgState) {
              console.log(`[${callId}] Stream stopped`);
              msgState.hungUp = true;
            }
          } catch { /* ignore parse errors */ }
        }

        const audioState = this.activeCalls.get(callId);
        if (audioState?.sttSession) {
          const audioData = this.extractInboundAudio(msgBuffer);
          if (audioData) {
            audioState.sttSession.sendAudio(audioData);
          }
        }
      });

      ws.on('close', () => {
        console.log('[CallManager] Media stream WebSocket closed');
      });
    });

    this.httpServer.listen(this.config.port, () => {
      console.log(`[CallManager] HTTP server listening on port ${this.config.port}`);
    });
  }

  private extractInboundAudio(msgBuffer: Buffer): Buffer | null {
    if (msgBuffer.length === 0) return null;
    if (msgBuffer[0] !== 0x7b) return null;

    try {
      const msg = JSON.parse(msgBuffer.toString());
      if (msg.event === 'media' && msg.media?.payload) {
        const track = msg.media?.track;
        if (track === 'inbound' || track === 'inbound_track') {
          return Buffer.from(msg.media.payload, 'base64');
        }
      }
    } catch { /* ignore */ }

    return null;
  }

  private handlePhoneWebhook(req: IncomingMessage, res: ServerResponse): void {
    const contentType = req.headers['content-type'] || '';

    // Telnyx sends JSON webhooks
    if (contentType.includes('application/json')) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const telnyxPublicKey = this.config.providerConfig.telnyxPublicKey;
          if (telnyxPublicKey) {
            const signature = req.headers['telnyx-signature-ed25519'] as string | undefined;
            const timestamp = req.headers['telnyx-timestamp'] as string | undefined;

            if (!validateTelnyxSignature(telnyxPublicKey, signature, timestamp, body)) {
              console.error('[CallManager] Rejecting webhook: invalid signature');
              res.writeHead(401);
              res.end('Invalid signature');
              return;
            }
          } else {
            console.warn('[CallManager] Warning: Telnyx public key not set, skipping signature verification');
          }

          const event = JSON.parse(body);
          await this.handleTelnyxWebhook(event, res);
        } catch (error) {
          console.error('[CallManager] Error parsing webhook:', error);
          res.writeHead(400);
          res.end('Invalid JSON');
        }
      });
      return;
    }

    console.error('[CallManager] Unknown content type:', contentType);
    res.writeHead(400);
    res.end('Invalid content type');
  }

  private async handleTelnyxWebhook(event: Record<string, unknown>, res: ServerResponse): Promise<void> {
    const data = event.data as Record<string, unknown> | undefined;
    const eventType = data?.event_type;
    const payload = data?.payload as Record<string, unknown> | undefined;
    const callControlId = payload?.call_control_id as string | undefined;

    console.log(`[CallManager] Phone webhook: ${eventType}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));

    if (!callControlId) return;

    try {
      switch (eventType) {
        case 'call.initiated':
          break;

        case 'call.answered': {
          let streamUrl = `wss://${new URL(this.config.publicUrl).host}/media-stream`;
          const callId = this.callControlIdToCallId.get(callControlId);
          if (callId) {
            const state = this.activeCalls.get(callId);
            if (state) {
              streamUrl += `?token=${encodeURIComponent(state.wsToken)}`;
            }
          }
          await this.config.providers.phone.startStreaming(callControlId, streamUrl);
          console.log(`[CallManager] Started streaming for call ${callControlId}`);
          break;
        }

        case 'call.hangup': {
          const hangupCallId = this.callControlIdToCallId.get(callControlId);
          if (hangupCallId) {
            this.callControlIdToCallId.delete(callControlId);
            const hangupState = this.activeCalls.get(hangupCallId);
            if (hangupState) {
              hangupState.hungUp = true;
              hangupState.ws?.close();
            }
          }
          break;
        }

        case 'streaming.started': {
          const streamCallId = this.callControlIdToCallId.get(callControlId);
          if (streamCallId) {
            const streamState = this.activeCalls.get(streamCallId);
            if (streamState) {
              streamState.streamingReady = true;
              console.log(`[${streamCallId}] Streaming ready`);
            }
          }
          break;
        }
      }
    } catch (error) {
      console.error(`[CallManager] Error handling webhook ${eventType}:`, error);
    }
  }

  async initiateCall(message: string): Promise<{ callId: string; response: string }> {
    const callId = `call-${++this.currentCallId}-${Date.now()}`;

    const sttSession = this.config.providers.stt.createSession();
    await sttSession.connect();
    console.log(`[${callId}] STT session connected`);

    const wsToken = generateWebSocketToken();

    const state: CallState = {
      callId,
      callControlId: null,
      userPhoneNumber: this.config.userPhoneNumber,
      ws: null,
      streamSid: null,
      streamingReady: false,
      wsToken,
      conversationHistory: [],
      startTime: Date.now(),
      hungUp: false,
      sttSession,
    };

    this.activeCalls.set(callId, state);

    try {
      const callControlId = await this.config.providers.phone.initiateCall(
        this.config.userPhoneNumber,
        this.config.phoneNumber,
        `${this.config.publicUrl}/twiml`
      );

      state.callControlId = callControlId;
      this.callControlIdToCallId.set(callControlId, callId);
      this.wsTokenToCallId.set(wsToken, callId);

      console.log(`[CallManager] Call initiated: ${callControlId} -> ${this.config.userPhoneNumber}`);

      const ttsPromise = this.generateTTSAudio(message);

      await this.waitForConnection(callId, 15000);

      const audioData = await ttsPromise;
      await this.sendPreGeneratedAudio(state, audioData);
      const response = await this.listen(state);
      state.conversationHistory.push({ speaker: 'claude', message });
      state.conversationHistory.push({ speaker: 'user', message: response });

      return { callId, response };
    } catch (error) {
      state.sttSession?.close();
      this.activeCalls.delete(callId);
      throw error;
    }
  }

  async continueCall(callId: string, message: string): Promise<string> {
    const state = this.activeCalls.get(callId);
    if (!state) throw new Error(`No active call: ${callId}`);

    const response = await this.speakAndListen(state, message);
    state.conversationHistory.push({ speaker: 'claude', message });
    state.conversationHistory.push({ speaker: 'user', message: response });

    return response;
  }

  async speakOnly(callId: string, message: string): Promise<void> {
    const state = this.activeCalls.get(callId);
    if (!state) throw new Error(`No active call: ${callId}`);

    await this.speak(state, message);
    state.conversationHistory.push({ speaker: 'claude', message });
  }

  async endCall(callId: string, message: string): Promise<{ durationSeconds: number }> {
    const state = this.activeCalls.get(callId);
    if (!state) throw new Error(`No active call: ${callId}`);

    await this.speak(state, message);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    if (state.callControlId) {
      await this.config.providers.phone.hangup(state.callControlId);
    }

    state.sttSession?.close();
    state.ws?.close();
    state.hungUp = true;

    this.wsTokenToCallId.delete(state.wsToken);
    if (state.callControlId) {
      this.callControlIdToCallId.delete(state.callControlId);
    }

    const durationSeconds = Math.round((Date.now() - state.startTime) / 1000);
    this.activeCalls.delete(callId);

    return { durationSeconds };
  }

  private async waitForConnection(callId: string, timeout: number): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const state = this.activeCalls.get(callId);
      const wsReady = state?.ws && state.ws.readyState === WebSocket.OPEN;
      const streamReady = state?.streamSid || state?.streamingReady;
      if (wsReady && streamReady) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('WebSocket connection timeout');
  }

  private async generateTTSAudio(text: string): Promise<Buffer> {
    console.log(`[TTS] Generating audio for: ${text.substring(0, 50)}...`);
    const tts = this.config.providers.tts;
    const pcmData = await tts.synthesize(text);
    const resampledPcm = this.resample24kTo8k(pcmData);
    const muLawData = this.pcmToMuLaw(resampledPcm);
    console.log(`[TTS] Audio generated: ${muLawData.length} bytes`);
    return muLawData;
  }

  private sendMediaChunk(state: CallState, audioData: Buffer): void {
    if (state.ws?.readyState !== WebSocket.OPEN) return;
    const message: Record<string, unknown> = {
      event: 'media',
      media: { payload: audioData.toString('base64') },
    };
    if (state.streamSid) {
      message.streamSid = state.streamSid;
    }
    state.ws.send(JSON.stringify(message));
  }

  private async sendPreGeneratedAudio(state: CallState, muLawData: Buffer): Promise<void> {
    console.log(`[${state.callId}] Sending pre-generated audio...`);
    const chunkSize = 160;
    for (let i = 0; i < muLawData.length; i += chunkSize) {
      this.sendMediaChunk(state, muLawData.subarray(i, i + chunkSize));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    console.log(`[${state.callId}] Audio sent`);
  }

  private async speakAndListen(state: CallState, text: string): Promise<string> {
    await this.speak(state, text);
    return await this.listen(state);
  }

  private async speak(state: CallState, text: string): Promise<void> {
    console.log(`[${state.callId}] Speaking: ${text.substring(0, 50)}...`);

    const tts = this.config.providers.tts;

    if (tts.synthesizeStream) {
      await this.speakStreaming(state, text, tts.synthesizeStream.bind(tts));
    } else {
      const pcmData = await tts.synthesize(text);
      await this.sendAudio(state, pcmData);
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
    console.log(`[${state.callId}] Speaking done`);
  }

  private async speakStreaming(
    state: CallState,
    text: string,
    synthesizeStream: (text: string) => AsyncGenerator<Buffer>
  ): Promise<void> {
    let pendingPcm = Buffer.alloc(0);
    let pendingMuLaw = Buffer.alloc(0);
    const OUTPUT_CHUNK_SIZE = 160;
    const SAMPLES_PER_RESAMPLE = 6;
    const JITTER_BUFFER_SIZE = 800;
    let playbackStarted = false;

    const drainBuffer = async () => {
      while (pendingMuLaw.length >= OUTPUT_CHUNK_SIZE) {
        this.sendMediaChunk(state, pendingMuLaw.subarray(0, OUTPUT_CHUNK_SIZE));
        pendingMuLaw = pendingMuLaw.subarray(OUTPUT_CHUNK_SIZE);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };

    for await (const chunk of synthesizeStream(text)) {
      pendingPcm = Buffer.concat([pendingPcm, chunk]);

      const completeUnits = Math.floor(pendingPcm.length / SAMPLES_PER_RESAMPLE);
      if (completeUnits > 0) {
        const bytesToProcess = completeUnits * SAMPLES_PER_RESAMPLE;
        const toProcess = pendingPcm.subarray(0, bytesToProcess);
        pendingPcm = pendingPcm.subarray(bytesToProcess);

        const resampled = this.resample24kTo8k(toProcess);
        const muLaw = this.pcmToMuLaw(resampled);
        pendingMuLaw = Buffer.concat([pendingMuLaw, muLaw]);

        if (!playbackStarted && pendingMuLaw.length < JITTER_BUFFER_SIZE) {
          continue;
        }
        playbackStarted = true;

        await drainBuffer();
      }
    }

    await drainBuffer();

    if (pendingMuLaw.length > 0) {
      this.sendMediaChunk(state, pendingMuLaw);
    }
  }

  private async sendAudio(state: CallState, pcmData: Buffer): Promise<void> {
    const resampledPcm = this.resample24kTo8k(pcmData);
    const muLawData = this.pcmToMuLaw(resampledPcm);

    const chunkSize = 160;
    for (let i = 0; i < muLawData.length; i += chunkSize) {
      this.sendMediaChunk(state, muLawData.subarray(i, i + chunkSize));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  private async listen(state: CallState): Promise<string> {
    console.log(`[${state.callId}] Listening...`);

    if (!state.sttSession) {
      throw new Error('STT session not available');
    }

    const transcript = await Promise.race([
      state.sttSession.waitForTranscript(this.config.transcriptTimeoutMs),
      this.waitForHangup(state),
    ]);

    if (state.hungUp) {
      throw new Error('Call was hung up by user');
    }

    console.log(`[${state.callId}] User said: ${transcript}`);
    return transcript;
  }

  private waitForHangup(state: CallState): Promise<never> {
    return new Promise((_, reject) => {
      const checkInterval = setInterval(() => {
        if (state.hungUp) {
          clearInterval(checkInterval);
          reject(new Error('Call was hung up by user'));
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkInterval);
      }, this.config.transcriptTimeoutMs + 1000);
    });
  }

  private resample24kTo8k(pcmData: Buffer): Buffer {
    const inputSamples = pcmData.length / 2;
    const outputSamples = Math.floor(inputSamples / 3);
    const output = Buffer.alloc(outputSamples * 2);

    for (let i = 0; i < outputSamples; i++) {
      const baseIdx = i * 3;
      const s0 = pcmData.readInt16LE(baseIdx * 2);
      const s1 = baseIdx + 1 < inputSamples ? pcmData.readInt16LE((baseIdx + 1) * 2) : s0;
      const s2 = baseIdx + 2 < inputSamples ? pcmData.readInt16LE((baseIdx + 2) * 2) : s1;
      const interpolated = Math.round((s0 + s1 + s2) / 3);
      output.writeInt16LE(interpolated, i * 2);
    }

    return output;
  }

  private pcmToMuLaw(pcmData: Buffer): Buffer {
    const muLawData = Buffer.alloc(Math.floor(pcmData.length / 2));
    for (let i = 0; i < muLawData.length; i++) {
      const pcm = pcmData.readInt16LE(i * 2);
      muLawData[i] = this.pcmToMuLawSample(pcm);
    }
    return muLawData;
  }

  private pcmToMuLawSample(pcm: number): number {
    const BIAS = 0x84;
    const CLIP = 32635;
    let sign = (pcm >> 8) & 0x80;
    if (sign) pcm = -pcm;
    if (pcm > CLIP) pcm = CLIP;
    pcm += BIAS;
    let exponent = 7;
    for (let expMask = 0x4000; (pcm & expMask) === 0 && exponent > 0; exponent--) {
      expMask >>= 1;
    }
    const mantissa = (pcm >> (exponent + 3)) & 0x0f;
    return (~(sign | (exponent << 4) | mantissa)) & 0xff;
  }

  private handleTestCall(req: IncomingMessage, res: ServerResponse): void {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const message = data.message || 'Hello! This is a test call from Claude Code.';

        console.log('[CallManager] Initiating test call...');
        const result = await this.initiateCall(message);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          callId: result.callId,
          message: 'Call initiated'
        }));
      } catch (error) {
        console.error('[CallManager] Test call failed:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    });
  }

  // Callback for conversation calls (set by CallService)
  private conversationCallHandler: ((session: string, window: string, pane?: string) => Promise<string>) | null = null;

  setConversationCallHandler(handler: (session: string, window: string, pane?: string) => Promise<string>): void {
    this.conversationCallHandler = handler;
  }

  private handleConversationCall(req: IncomingMessage, res: ServerResponse): void {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const { session, window, pane } = data;

        if (!session || !window) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'Missing required fields: session, window'
          }));
          return;
        }

        if (!this.conversationCallHandler) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'Conversation service not available'
          }));
          return;
        }

        console.log(`[CallManager] Starting conversation call for ${session}:${window}`);
        const callId = await this.conversationCallHandler(session, window, pane);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          callId,
          message: 'Conversation call started'
        }));
      } catch (error) {
        console.error('[CallManager] Conversation call failed:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    });
  }

  getActiveCallCount(): number {
    return this.activeCalls.size;
  }

  getHttpServer(): ReturnType<typeof createServer> | null {
    return this.httpServer;
  }

  shutdown(): void {
    for (const callId of this.activeCalls.keys()) {
      this.endCall(callId, 'Goodbye!').catch(console.error);
    }
    this.wss?.close();
    this.httpServer?.close();
  }
}
