/**
 * Webhook Security - Signature verification for Telnyx
 * Adapted from CallMe repository
 *
 * Prevents unauthorized requests to webhook endpoints by validating
 * cryptographic signatures from phone providers.
 */

import { verify } from 'crypto';

/**
 * Validate Telnyx webhook signature using Ed25519
 *
 * Algorithm:
 * 1. Build string: {timestamp}|{json_body}
 * 2. Verify Ed25519 signature using Telnyx public key
 */
export function validateTelnyxSignature(
  publicKey: string,
  signature: string | undefined,
  timestamp: string | undefined,
  body: string
): boolean {
  if (!signature || !timestamp) {
    console.error('[Security] Missing Telnyx signature headers');
    return false;
  }

  // Check timestamp to prevent replay attacks (allow 5 minute window)
  const timestampMs = parseInt(timestamp, 10) * 1000;
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;

  if (Math.abs(now - timestampMs) > fiveMinutes) {
    console.error('[Security] Telnyx timestamp too old or in future');
    return false;
  }

  // Build the signed payload: timestamp|body
  const signedPayload = `${timestamp}|${body}`;

  try {
    // Decode the base64 signature
    const signatureBuffer = Buffer.from(signature, 'base64');

    // Format public key for Node.js crypto (needs PEM format)
    const pemPublicKey = formatEd25519PublicKey(publicKey);

    // Verify Ed25519 signature using crypto.verify()
    const valid = verify(
      null, // Ed25519 doesn't use a separate digest algorithm
      Buffer.from(signedPayload),
      pemPublicKey,
      signatureBuffer
    );

    if (!valid) {
      console.error('[Security] Telnyx signature verification failed');
    }

    return valid;
  } catch (error) {
    console.error('[Security] Telnyx signature verification error:', error);
    return false;
  }
}

/**
 * Format raw Ed25519 public key bytes to PEM format
 *
 * Ed25519 public keys need proper DER/ASN.1 encoding:
 * - SEQUENCE (algorithm identifier with OID 1.3.101.112)
 * - BIT STRING containing the 32-byte raw key
 */
function formatEd25519PublicKey(publicKeyBase64: string): string {
  // If already in PEM format, return as-is
  if (publicKeyBase64.includes('-----BEGIN')) {
    return publicKeyBase64;
  }

  // Decode the raw 32-byte Ed25519 public key
  const rawKey = Buffer.from(publicKeyBase64, 'base64');

  // DER prefix for Ed25519 public key (OID 1.3.101.112)
  const derPrefix = Buffer.from('302a300506032b6570032100', 'hex');

  // Combine prefix with raw key
  const derEncoded = Buffer.concat([derPrefix, rawKey]);

  // Convert to PEM format
  const base64Der = derEncoded.toString('base64');
  return `-----BEGIN PUBLIC KEY-----\n${base64Der}\n-----END PUBLIC KEY-----`;
}

/**
 * Generate a secure random token for WebSocket authentication
 */
export function generateWebSocketToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

/**
 * Validate a WebSocket token from the URL
 */
export function validateWebSocketToken(
  expectedToken: string,
  receivedToken: string | undefined
): boolean {
  if (!receivedToken) {
    console.error('[Security] Missing WebSocket token');
    return false;
  }

  // Use timing-safe comparison to prevent timing attacks
  if (expectedToken.length !== receivedToken.length) {
    console.error('[Security] WebSocket token length mismatch');
    return false;
  }

  let result = 0;
  for (let i = 0; i < expectedToken.length; i++) {
    result |= expectedToken.charCodeAt(i) ^ receivedToken.charCodeAt(i);
  }

  const valid = result === 0;
  if (!valid) {
    console.error('[Security] WebSocket token mismatch');
  }

  return valid;
}
