/**
 * Telnyx Phone Provider (API v2)
 * Adapted from CallMe repository
 *
 * Cost-effective alternative to Twilio (30-70% cheaper).
 * Uses Call Control API v2 with JSON webhooks.
 *
 * Pricing (as of 2025):
 * - Outbound: $0.007/min (vs Twilio $0.014/min)
 * - Inbound: $0.0055/min (vs Twilio $0.0085/min)
 */

import type { PhoneProvider, PhoneConfig } from './types';

interface TelnyxCallResponse {
  data: {
    id: string;
    call_control_id: string;
    call_leg_id: string;
    record_type: string;
  };
}

export class TelnyxPhoneProvider implements PhoneProvider {
  readonly name = 'telnyx';
  private apiKey: string | null = null;
  private connectionId: string | null = null;

  initialize(config: PhoneConfig): void {
    // Telnyx uses API key (passed as authToken) and Connection ID (passed as accountSid)
    this.apiKey = config.authToken;
    this.connectionId = config.accountSid;
    console.log(`[CallService] Phone provider: Telnyx (API v2)`);
  }

  async initiateCall(to: string, from: string, webhookUrl: string): Promise<string> {
    if (!this.apiKey || !this.connectionId) {
      throw new Error('Telnyx not initialized');
    }

    const response = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connection_id: this.connectionId,
        to,
        from,
        webhook_url: webhookUrl,
        webhook_url_method: 'POST',
        answering_machine_detection: 'detect',
        timeout_secs: 60,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telnyx call failed: ${response.status} ${error}`);
    }

    const data = await response.json() as TelnyxCallResponse;
    return data.data.call_control_id;
  }

  /**
   * Start media streaming using Call Control API v2
   * Enables bidirectional streaming so we can send audio back to the caller
   */
  async startStreaming(callControlId: string, streamUrl: string): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Telnyx not initialized');
    }

    const response = await fetch(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/streaming_start`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          stream_url: streamUrl,
          stream_track: 'both_tracks',
          // Enable bidirectional streaming to send audio back to caller
          stream_bidirectional_mode: 'rtp',
          // Use PCMU (mu-law) codec at 8kHz - matches our audio encoding
          stream_bidirectional_codec: 'PCMU',
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telnyx streaming_start failed: ${response.status} ${error}`);
    }
  }

  /**
   * Answer an incoming call using Call Control API v2
   */
  async answerCall(callControlId: string): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Telnyx not initialized');
    }

    const response = await fetch(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telnyx answer failed: ${response.status} ${error}`);
    }
  }

  /**
   * Hang up a call using Call Control API v2
   */
  async hangup(callControlId: string): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Telnyx not initialized');
    }

    const response = await fetch(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error(`[CallService] Telnyx hangup failed: ${response.status} ${error}`);
    }
  }

  // Legacy method for Twilio compatibility - not used with API v2
  getStreamConnectXml(_streamUrl: string): string {
    // For API v2, we use startStreaming() instead
    console.warn('[CallService] Warning: getStreamConnectXml called on Telnyx v2 provider');
    return '';
  }
}
