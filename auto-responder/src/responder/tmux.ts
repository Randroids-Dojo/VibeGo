import { exec } from 'child_process';
import { promisify } from 'util';
import { TmuxContext, TmuxConfig } from '../types';
import { getLogger } from '../logger';

const execAsync = promisify(exec);

export class TmuxResponder {
  private defaultSession: string;
  private responseDelayMs: number;

  constructor(config: TmuxConfig) {
    this.defaultSession = config.default_session;
    this.responseDelayMs = config.response_delay_ms;
  }

  /**
   * Escape special characters for tmux send-keys
   */
  private escapeForTmux(text: string): string {
    return text
      .replace(/\\/g, '\\\\') // Backslashes
      .replace(/"/g, '\\"') // Double quotes
      .replace(/\$/g, '\\$') // Dollar signs
      .replace(/`/g, '\\`') // Backticks
      .replace(/!/g, '\\!'); // Exclamation marks
  }

  /**
   * Build the tmux target string
   */
  private buildTarget(context: TmuxContext): string {
    const logger = getLogger();

    // If we have a direct pane ID (e.g., %5), use it
    if (context.pane && context.pane.startsWith('%')) {
      logger.debug('Using direct pane ID', { pane: context.pane });
      return `-t ${context.pane}`;
    }

    // Build session:window.pane format
    const session = context.session || this.defaultSession;
    const window = context.window || '0';

    let target = `${session}:${window}`;

    // Add pane index if provided and numeric
    if (context.pane && /^\d+$/.test(context.pane)) {
      target += `.${context.pane}`;
    }

    logger.debug('Built tmux target', { target });
    return `-t ${target}`;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Send a response to a tmux pane
   */
  async sendResponse(context: TmuxContext, response: string): Promise<void> {
    const logger = getLogger();
    const target = this.buildTarget(context);
    const escapedResponse = this.escapeForTmux(response);

    logger.info('Sending response to tmux', {
      target,
      response: response.substring(0, 50),
    });

    try {
      // Add small delay for reliability
      if (this.responseDelayMs > 0) {
        await this.delay(this.responseDelayMs);
      }

      // Send the response text
      await execAsync(`tmux send-keys ${target} "${escapedResponse}"`);

      // Small delay before Enter
      await this.delay(50);

      // Send Enter key
      await execAsync(`tmux send-keys ${target} Enter`);

      logger.info('Response sent successfully');
    } catch (error) {
      logger.error('Failed to send response to tmux', {
        error: error instanceof Error ? error.message : String(error),
        target,
      });
      throw error;
    }
  }

  /**
   * Check if a tmux session exists
   */
  async sessionExists(session: string): Promise<boolean> {
    try {
      await execAsync(`tmux has-session -t ${session}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current active pane info
   */
  async getActivePane(): Promise<TmuxContext | null> {
    try {
      const { stdout } = await execAsync(
        "tmux display-message -p '#{session_name}:#{window_index}:#{pane_id}'"
      );
      const parts = stdout.trim().split(':');
      if (parts.length >= 3) {
        return {
          session: parts[0],
          window: parts[1],
          pane: parts[2],
        };
      }
      return null;
    } catch {
      return null;
    }
  }
}
