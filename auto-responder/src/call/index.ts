/**
 * Call Module
 *
 * Provides phone call capabilities for the auto-responder service.
 */

export { CallService } from './call-service';
export { CallManager, createCallManagerConfig } from './call-manager';
export { SessionTracker, type SessionMapping } from './session-tracker';
export { startNgrok, stopNgrok, getNgrokUrl, isNgrokConnected } from './ngrok';
export * from './providers';
