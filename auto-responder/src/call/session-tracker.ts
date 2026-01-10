/**
 * Session Tracker
 *
 * Maps phone calls to tmux sessions for response routing.
 * Ensures phone responses are sent to the correct Claude Code instance.
 */

import { TmuxContext } from '../types';

export interface SessionMapping {
  callId: string;
  tmuxContext: TmuxContext;
  eventId: string;
  cwd: string;
  project: string;
  startedAt: number;
  eventType: string;
  eventContent?: string;
}

export class SessionTracker {
  private callToSession = new Map<string, SessionMapping>();
  private sessionToCall = new Map<string, string>();

  /**
   * Generate a unique key for a tmux session/window combination
   */
  private getSessionKey(context: TmuxContext): string {
    return `${context.session}:${context.window}:${context.pane}`;
  }

  /**
   * Register a new call with its tmux context
   */
  registerCall(
    callId: string,
    tmuxContext: TmuxContext,
    eventId: string,
    cwd: string,
    eventType: string,
    eventContent?: string
  ): void {
    const sessionKey = this.getSessionKey(tmuxContext);
    const project = cwd.split('/').slice(-2).join('/');

    const mapping: SessionMapping = {
      callId,
      tmuxContext,
      eventId,
      cwd,
      project,
      startedAt: Date.now(),
      eventType,
      eventContent,
    };

    this.callToSession.set(callId, mapping);
    this.sessionToCall.set(sessionKey, callId);

    console.log(`[SessionTracker] Registered call ${callId} for session ${sessionKey}`);
  }

  /**
   * Get tmux context for a call (for response routing)
   */
  getMapping(callId: string): SessionMapping | null {
    return this.callToSession.get(callId) || null;
  }

  /**
   * Get call ID for a tmux session
   */
  getCallIdForSession(context: TmuxContext): string | null {
    const sessionKey = this.getSessionKey(context);
    return this.sessionToCall.get(sessionKey) || null;
  }

  /**
   * Check if a session already has an active call
   */
  hasActiveCall(context: TmuxContext): boolean {
    const sessionKey = this.getSessionKey(context);
    return this.sessionToCall.has(sessionKey);
  }

  /**
   * Clean up ended calls
   */
  removeCall(callId: string): void {
    const mapping = this.callToSession.get(callId);
    if (mapping) {
      const sessionKey = this.getSessionKey(mapping.tmuxContext);
      this.sessionToCall.delete(sessionKey);
      this.callToSession.delete(callId);
      console.log(`[SessionTracker] Removed call ${callId}`);
    }
  }

  /**
   * Get all active calls
   */
  getActiveCalls(): SessionMapping[] {
    return Array.from(this.callToSession.values());
  }

  /**
   * Get count of active calls
   */
  getActiveCallCount(): number {
    return this.callToSession.size;
  }
}
