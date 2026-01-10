/**
 * ngrok tunnel management for exposing local webhooks to phone providers
 * Adapted from CallMe repository
 */

import ngrok from '@ngrok/ngrok';

let listener: ngrok.Listener | null = null;
let currentPort: number | null = null;
let currentUrl: string | null = null;
let intentionallyClosed = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;
const baseReconnectDelayMs = 2000;

/**
 * Start ngrok tunnel to expose local port
 * @param port Local port to expose
 * @param authtoken ngrok auth token
 * @param domain Optional custom domain (paid ngrok feature)
 * @returns Public ngrok URL
 */
export async function startNgrok(
  port: number,
  authtoken: string,
  domain?: string
): Promise<string> {
  intentionallyClosed = false;
  reconnectAttempts = 0;
  currentPort = port;
  return doStartNgrok(port, authtoken, domain);
}

async function doStartNgrok(
  port: number,
  authtoken: string,
  domain?: string
): Promise<string> {
  if (!authtoken) {
    throw new Error(
      'ngrok auth token is required.\n' +
      'Get a free auth token at https://dashboard.ngrok.com/get-started/your-authtoken'
    );
  }

  listener = await ngrok.forward({
    addr: port,
    authtoken,
    domain: domain || undefined,
  });

  const url = listener.url();
  if (!url) {
    throw new Error('Failed to get ngrok URL');
  }

  currentUrl = url;
  reconnectAttempts = 0;
  console.log(`[CallService] ngrok tunnel established: ${url}`);

  // Monitor for disconnection
  monitorTunnel(authtoken, domain);

  return url;
}

/**
 * Monitor tunnel health and reconnect if needed
 */
async function monitorTunnel(authtoken: string, domain?: string): Promise<void> {
  const checkInterval = setInterval(async () => {
    if (intentionallyClosed) {
      clearInterval(checkInterval);
      return;
    }

    // Check if listener is still valid
    if (!listener || !currentUrl) {
      clearInterval(checkInterval);
      console.log('[CallService] ngrok tunnel lost, attempting reconnect...');
      attemptReconnect(authtoken, domain);
      return;
    }

    // Verify the tunnel works by hitting the health endpoint
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${currentUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Health check returned ${response.status}`);
      }
    } catch (error) {
      clearInterval(checkInterval);
      console.error('[CallService] ngrok health check failed:', error);
      attemptReconnect(authtoken, domain);
    }
  }, 30000);
}

/**
 * Attempt to reconnect the ngrok tunnel
 */
async function attemptReconnect(authtoken: string, domain?: string): Promise<void> {
  if (intentionallyClosed || currentPort === null) {
    return;
  }

  if (reconnectAttempts >= maxReconnectAttempts) {
    console.error(`[CallService] ngrok max reconnect attempts (${maxReconnectAttempts}) reached, giving up`);
    return;
  }

  reconnectAttempts++;
  const delay = baseReconnectDelayMs * Math.pow(2, reconnectAttempts - 1);
  console.log(`[CallService] ngrok reconnect attempt ${reconnectAttempts}/${maxReconnectAttempts} in ${delay}ms...`);

  await new Promise(resolve => setTimeout(resolve, delay));

  if (intentionallyClosed) {
    console.log('[CallService] ngrok reconnect cancelled - tunnel intentionally closed');
    return;
  }

  try {
    // Clean up old listener
    if (listener) {
      try {
        await listener.close();
      } catch {
        // Ignore close errors
      }
      listener = null;
    }

    const newUrl = await doStartNgrok(currentPort, authtoken, domain);
    console.log(`[CallService] ngrok reconnected successfully: ${newUrl}`);

    if (newUrl !== currentUrl) {
      console.warn(`[CallService] ngrok URL changed from ${currentUrl} to ${newUrl}`);
      console.warn('[CallService] Phone provider webhooks may need to be updated');
    }
  } catch (error) {
    console.error('[CallService] ngrok reconnect failed:', error);
    attemptReconnect(authtoken, domain);
  }
}

/**
 * Get the current ngrok URL
 */
export function getNgrokUrl(): string | null {
  return currentUrl;
}

/**
 * Check if ngrok tunnel is active
 */
export function isNgrokConnected(): boolean {
  return listener !== null && !intentionallyClosed;
}

/**
 * Stop ngrok tunnel
 */
export async function stopNgrok(): Promise<void> {
  intentionallyClosed = true;
  if (listener) {
    await listener.close();
    listener = null;
  }
  currentUrl = null;
}
