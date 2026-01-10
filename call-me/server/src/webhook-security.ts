/**
 * Webhook Security - Signature verification for Twilio and Telnyx
 *
 * Prevents unauthorized requests to webhook endpoints by validating
 * cryptographic signatures from phone providers.
 */

import { createHmac, verify } from 'crypto';

/**
 * Validate Twilio webhook signature
 *
 * Algorithm:
 * 1. Take the full URL (as Twilio sees it)
 * 2. Sort POST parameters alphabetically
 * 3. Append each param name+value to URL (no delimiters)
 * 4. HMAC-SHA1 sign with auth token
 * 5. Base64 encode and compare
 *
 * @see https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function validateTwilioSignature(
  authToken: string,
  signature: string | undefined,
  url: string,
  params: URLSearchParams
): boolean {
  if (!signature) {
    console.error('[Security] Missing X-Twilio-Signature header');
    return false;
  }

  // Build the string to sign: URL + sorted params
  let dataToSign = url;

  // Sort params alphabetically and append name+value
  const sortedParams = Array.from(params.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  for (const [key, value] of sortedParams) {
    dataToSign += key + value;
  }

  // HMAC-SHA1 with auth token, then base64 encode
  const expectedSignature = createHmac('sha1', authToken)
    .update(dataToSign)
    .digest('base64');

  const valid = signature === expectedSignature;

  if (!valid) {
    console.error('[Security] Twilio signature mismatch');
    console.error(`[Security] Expected: ${expectedSignature}`);
    console.error(`[Security] Received: ${signature}`);
  }

  return valid;
}

/**
 * Validate Telnyx webhook signature using Ed25519
 *
 * Algorithm:
 * 1. Build string: {timestamp}|{json_body}
 * 2. Verify Ed25519 signature using Telnyx public key
 *
 * @see https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-webhooks
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
      null,  // Ed25519 doesn't use a separate digest algorithm
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
  // 30 2a       - SEQUENCE, 42 bytes total
  //   30 05     - SEQUENCE, 5 bytes (algorithm identifier)
  //     06 03 2b 65 70 - OID 1.3.101.112 (id-Ed25519)
  //   03 21 00  - BIT STRING, 33 bytes (0 unused bits + 32 byte key)
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
