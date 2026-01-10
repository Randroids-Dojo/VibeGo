/**
 * Call Service
 *
 * High-level service that orchestrates phone calls for the auto-responder.
 * Wraps CallManager and integrates with SessionTracker for response routing.
 */

import { startNgrok, stopNgrok, getNgrokUrl } from './ngrok';
import { CallManager, createCallManagerConfig } from './call-manager';
import { SessionTracker, SessionMapping } from './session-tracker';
import { ConversationService } from './conversation-service';
import { buildProviderConfig } from '../escalation/config';
import type { CallEscalationConfig } from '../escalation/config';
import type { TmuxContext, IncomingEvent } from '../types';
import { TmuxResponder } from '../responder/tmux';

export interface CallSession {
  callId: string;
  tmuxContext: TmuxContext;
  eventId: string;
  eventType: string;
  startedAt: number;
  status: 'connecting' | 'active' | 'ended';
}

export class CallService {
  private config: CallEscalationConfig;
  private callManager: CallManager | null = null;
  private conversationService: ConversationService | null = null;
  private sessionTracker: SessionTracker;
  private tmuxResponder: TmuxResponder;
  private started = false;
  private lastCallAt: number | null = null;
  private callHistory: number[] = [];  // Timestamps of recent calls
  private openaiApiKey: string | null = null;

  constructor(
    config: CallEscalationConfig,
    tmuxResponder: TmuxResponder
  ) {
    this.config = config;
    this.sessionTracker = new SessionTracker();
    this.tmuxResponder = tmuxResponder;
  }

  /**
   * Start the call service (ngrok tunnel + HTTP server)
   */
  async start(): Promise<void> {
    if (this.started) {
      console.log('[CallService] Already started');
      return;
    }

    if (!this.config.enabled) {
      console.log('[CallService] Call escalation is disabled');
      return;
    }

    console.log('[CallService] Starting call service...');

    // Get ngrok auth token from env
    const ngrokAuthtoken = process.env[this.config.callme.ngrokAuthtokenEnv];
    if (!ngrokAuthtoken) {
      throw new Error(`Missing ngrok auth token: ${this.config.callme.ngrokAuthtokenEnv}`);
    }

    // Start ngrok tunnel
    const publicUrl = await startNgrok(
      this.config.callme.port,
      ngrokAuthtoken,
      this.config.callme.ngrokDomain
    );

    // Build provider config from env vars
    const providerConfig = buildProviderConfig(this.config.callme);

    // Get user phone number from env
    const userPhoneNumber = process.env[this.config.callme.userPhoneNumberEnv];
    if (!userPhoneNumber) {
      throw new Error(`Missing user phone number: ${this.config.callme.userPhoneNumberEnv}`);
    }

    // Get OpenAI API key (for conversation LLM)
    const openaiApiKey = process.env[this.config.callme.openaiApiKeyEnv];
    if (!openaiApiKey) {
      throw new Error(`Missing OpenAI API key: ${this.config.callme.openaiApiKeyEnv}`);
    }
    this.openaiApiKey = openaiApiKey;

    // Create and start call manager
    const managerConfig = createCallManagerConfig(
      publicUrl,
      providerConfig,
      userPhoneNumber,
      openaiApiKey
    );

    this.callManager = new CallManager(managerConfig);
    this.callManager.startServer();

    // Create conversation service
    this.conversationService = new ConversationService(openaiApiKey, this.callManager);

    // Register conversation call handler
    this.callManager.setConversationCallHandler(
      (session, window, pane) => this.startConversationCall(session, window, pane)
    );

    this.started = true;
    console.log('[CallService] Call service started successfully');
  }

  /**
   * Initiate a phone call for an event
   */
  async initiateCall(
    event: IncomingEvent,
    eventId: string,
    message: string
  ): Promise<{ callId: string; response: string }> {
    if (!this.callManager) {
      throw new Error('Call service not started');
    }

    // Check if session already has active call
    if (this.sessionTracker.hasActiveCall(event.tmux)) {
      const existingCallId = this.sessionTracker.getCallIdForSession(event.tmux);
      throw new Error(`Session already has active call: ${existingCallId}`);
    }

    // Extract content for tracking
    const eventContent = this.extractEventContent(event);

    // Initiate the call
    const result = await this.callManager.initiateCall(message);

    // Register call with session tracker
    this.sessionTracker.registerCall(
      result.callId,
      event.tmux,
      eventId,
      event.cwd,
      event.event_type,
      eventContent
    );

    // Update call history
    this.lastCallAt = Date.now();
    this.callHistory.push(Date.now());
    this.pruneCallHistory();

    return result;
  }

  /**
   * Continue an active call
   */
  async continueCall(callId: string, message: string): Promise<string> {
    if (!this.callManager) {
      throw new Error('Call service not started');
    }

    return await this.callManager.continueCall(callId, message);
  }

  /**
   * End a call and route the response back to tmux
   */
  async endCall(callId: string, finalResponse: string, goodbyeMessage: string): Promise<void> {
    if (!this.callManager) {
      throw new Error('Call service not started');
    }

    const mapping = this.sessionTracker.getMapping(callId);
    if (!mapping) {
      console.warn(`[CallService] No session mapping found for call ${callId}`);
    }

    // End the phone call
    await this.callManager.endCall(callId, goodbyeMessage);

    // Route response back to tmux
    if (mapping && finalResponse) {
      try {
        await this.tmuxResponder.sendResponse(mapping.tmuxContext, finalResponse);
        console.log(`[CallService] Response routed to tmux: ${finalResponse}`);
      } catch (error) {
        console.error('[CallService] Failed to route response to tmux:', error);
      }
    }

    // Clean up session mapping
    this.sessionTracker.removeCall(callId);
  }

  /**
   * Handle full call flow: initiate, get response, end, route response
   */
  async handleCall(
    event: IncomingEvent,
    eventId: string,
    message: string,
    goodbyeMessage: string
  ): Promise<string> {
    const { callId, response } = await this.initiateCall(event, eventId, message);

    // End the call and route response
    await this.endCall(callId, response, goodbyeMessage);

    return response;
  }

  /**
   * Start a full conversation call with LLM
   * Reads tmux context, has a conversation, sends final plan to tmux on hangup
   */
  async startConversationCall(
    session: string,
    window: string,
    pane?: string
  ): Promise<string> {
    if (!this.conversationService || !this.callManager) {
      throw new Error('Call service not started');
    }

    // Read tmux logs for context
    const logs = ConversationService.readTmuxLogs(session, window, 200);
    const project = ConversationService.getTmuxProject(session, window);

    const tmuxContext = {
      session,
      window,
      pane: pane || '',
      logs,
      project,
    };

    console.log(`[CallService] Starting conversation call for ${project} (${session}:${window})`);
    console.log(`[CallService] Tmux context: ${logs.length} chars of logs`);

    // Start the conversation
    const callId = await this.conversationService.startConversation(tmuxContext);

    // Update call history
    this.lastCallAt = Date.now();
    this.callHistory.push(Date.now());
    this.pruneCallHistory();

    return callId;
  }

  /**
   * Get active calls
   */
  getActiveCalls(): SessionMapping[] {
    return this.sessionTracker.getActiveCalls();
  }

  /**
   * Get call ID for a tmux session
   */
  getCallIdForSession(context: TmuxContext): string | null {
    return this.sessionTracker.getCallIdForSession(context);
  }

  /**
   * Check if a session has an active call
   */
  hasActiveCall(context: TmuxContext): boolean {
    return this.sessionTracker.hasActiveCall(context);
  }

  /**
   * Get last call timestamp
   */
  getLastCallAt(): number | null {
    return this.lastCallAt;
  }

  /**
   * Get count of calls in the last hour
   */
  getCallCountLastHour(): number {
    this.pruneCallHistory();
    return this.callHistory.length;
  }

  /**
   * Check if service is running
   */
  isRunning(): boolean {
    return this.started;
  }

  /**
   * Get the public ngrok URL
   */
  getPublicUrl(): string | null {
    return getNgrokUrl();
  }

  /**
   * Shutdown the call service
   */
  async shutdown(): Promise<void> {
    console.log('[CallService] Shutting down...');

    if (this.callManager) {
      this.callManager.shutdown();
      this.callManager = null;
    }

    await stopNgrok();
    this.started = false;

    console.log('[CallService] Shutdown complete');
  }

  /**
   * Extract content from event for display/tracking
   */
  private extractEventContent(event: IncomingEvent): string {
    const data = event.event_data as Record<string, unknown>;

    // Try different common field names
    if (data.question) return String(data.question);
    if (data.message) return String(data.message);
    if (data.content) return String(data.content);
    if (data.prompt) return String(data.prompt);
    if (data.tool_name) return `Tool: ${data.tool_name}`;

    // Fall back to first string value
    for (const value of Object.values(data)) {
      if (typeof value === 'string' && value.length > 0 && value.length < 500) {
        return value;
      }
    }

    return event.event_type;
  }

  /**
   * Remove old entries from call history (older than 1 hour)
   */
  private pruneCallHistory(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    this.callHistory = this.callHistory.filter((t) => t > oneHourAgo);
  }
}
