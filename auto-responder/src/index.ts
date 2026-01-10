import * as net from 'net';
import * as fs from 'fs';
import { loadConfig } from './config';
import { initLogger, getLogger } from './logger';
import { RuleEngine, extractContent, mapEventTypeToPromptType } from './rules';
import { createProvider } from './providers';
import { TmuxResponder } from './responder/tmux';
import { CallService } from './call/call-service';
import { EscalationEvaluator } from './escalation/evaluator';
import { IncomingEvent, ServiceResponse, LLMProvider, CallEscalationConfig } from './types';

// Load configuration
const config = loadConfig();

// Initialize logger
const logger = initLogger(config.service.log_file, config.service.log_level);

// Initialize components
const rules = new RuleEngine(config.rules);
const tmuxResponder = new TmuxResponder(config.tmux);

// Initialize LLM provider (may fail if API key not set)
let llmProvider: LLMProvider | null = null;
try {
  llmProvider = createProvider(config.llm);
} catch (error) {
  logger.warn('LLM provider initialization failed - will use rule-based decisions only', {
    error: error instanceof Error ? error.message : String(error),
  });
}

// Initialize call service and escalation evaluator (if enabled)
let callService: CallService | null = null;
let escalationEvaluator: EscalationEvaluator | null = null;

if (config.callEscalation?.enabled) {
  const callConfig = config.callEscalation as CallEscalationConfig;
  callService = new CallService(callConfig, tmuxResponder);
  escalationEvaluator = new EscalationEvaluator(callConfig, llmProvider);

  // Start call service asynchronously
  callService.start().catch((error) => {
    logger.error('Call service failed to start', {
      error: error instanceof Error ? error.message : String(error),
    });
    callService = null;
  });
}

// Socket path
const socketPath = config.service.socket_path;

// Clean up existing socket
if (fs.existsSync(socketPath)) {
  logger.info('Removing existing socket file');
  fs.unlinkSync(socketPath);
}

/**
 * Process an incoming event
 */
async function processEvent(event: IncomingEvent): Promise<ServiceResponse> {
  logger.info('Processing event', {
    event_type: event.event_type,
    cwd: event.cwd,
    tmux: event.tmux,
  });

  // Evaluate rules
  const ruleResult = rules.evaluate(event);
  logger.info('Rule evaluation result', ruleResult);

  // Extract content for escalation evaluation
  const eventContent = extractContent(event.event_data, event.event_type);

  // Check if escalation should happen (for events that require user input)
  if (!ruleResult.shouldAutoRespond && callService && escalationEvaluator) {
    const escalationResult = await escalationEvaluator.evaluate({
      event,
      eventContent,
      previousCallAt: callService.getLastCallAt() ?? undefined,
      callCountLastHour: callService.getCallCountLastHour(),
    });

    logger.info('Escalation evaluation result', escalationResult);

    if (escalationResult.shouldEscalate) {
      // Initiate phone call
      try {
        const message = escalationEvaluator.formatCallMessage(event.event_type, eventContent);
        const goodbyeMessage = escalationEvaluator.getGoodbyeMessage();
        const eventId = `${event.event_type}-${Date.now()}`;

        const response = await callService.handleCall(event, eventId, message, goodbyeMessage);

        logger.info('Call completed, response routed to tmux', { response });

        return {
          handled: true,
          action: 'escalate_call',
        };
      } catch (error) {
        logger.error('Call escalation failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Fall back to notify
        return {
          handled: false,
          action: 'notify',
          error: 'Call escalation failed',
        };
      }
    }
  }

  // If rules say don't auto-respond, return immediately
  if (!ruleResult.shouldAutoRespond) {
    return {
      handled: false,
      action: 'notify',
    };
  }

  // Get response (from rules or LLM)
  let response = ruleResult.suggestedResponse;

  // If LLM is needed and available
  if (ruleResult.requiresLLM && llmProvider) {
    const project = event.cwd.split('/').slice(-2).join('/');

    try {
      const llmResult = await llmProvider.analyze({
        promptType: mapEventTypeToPromptType(event.event_type),
        content: eventContent,
        context: {
          project,
          cwd: event.cwd,
        },
      });

      logger.info('LLM decision', llmResult);

      // LLM might override the auto-respond decision
      if (llmResult.action !== 'auto_respond') {
        return {
          handled: false,
          action: llmResult.action,
        };
      }

      // Use LLM's suggested response if provided
      if (llmResult.response) {
        response = llmResult.response;
      }
    } catch (error) {
      logger.error('LLM analysis failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall back to rule-based response
    }
  }

  // Ensure we have a response
  if (!response) {
    logger.warn('No response available, falling back to notify');
    return {
      handled: false,
      action: 'notify',
    };
  }

  // Dry run check
  if (config.rules.dry_run) {
    logger.info('DRY RUN: Would send response', {
      response,
      target: event.tmux,
    });
    return {
      handled: true,
      action: 'auto_respond',
      dry_run: true,
    };
  }

  // Send response to tmux
  try {
    await tmuxResponder.sendResponse(event.tmux, response);
    logger.info('Response sent successfully', { response });

    return {
      handled: true,
      action: 'auto_respond',
    };
  } catch (error) {
    logger.error('Failed to send response', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      handled: false,
      action: 'notify',
      error: 'Failed to send response to tmux',
    };
  }
}

/**
 * Handle a client connection
 */
function handleConnection(socket: net.Socket): void {
  let data = '';

  socket.on('data', (chunk) => {
    data += chunk.toString();
  });

  socket.on('end', async () => {
    try {
      const event = JSON.parse(data) as IncomingEvent;
      logger.debug('Received event data', event);

      const response = await processEvent(event);

      socket.write(JSON.stringify(response));
    } catch (error) {
      logger.error('Error processing event', {
        error: error instanceof Error ? error.message : String(error),
        data: data.substring(0, 200),
      });

      const errorResponse: ServiceResponse = {
        handled: false,
        action: 'notify',
        error: error instanceof Error ? error.message : 'Unknown error',
      };

      socket.write(JSON.stringify(errorResponse));
    } finally {
      socket.end();
    }
  });

  socket.on('error', (error) => {
    logger.error('Socket error', {
      error: error.message,
    });
  });
}

// Create the server
const server = net.createServer(handleConnection);

server.on('error', (error) => {
  logger.error('Server error', { error: error.message });
  process.exit(1);
});

// Start listening
server.listen(socketPath, () => {
  // Set socket permissions (owner only)
  fs.chmodSync(socketPath, 0o600);

  logger.info(`VibeGo Auto-Responder listening on ${socketPath}`);
  logger.info('Configuration:', {
    llm_provider: config.llm.provider,
    rules_enabled: config.rules.enabled,
    dry_run: config.rules.dry_run,
    default_action: config.rules.default_action,
    call_escalation_enabled: config.callEscalation?.enabled ?? false,
  });
});

// Graceful shutdown handlers
async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down...`);

  // Shutdown call service if running
  if (callService) {
    try {
      await callService.shutdown();
      logger.info('Call service shut down');
    } catch (error) {
      logger.error('Error shutting down call service', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  server.close(() => {
    logger.info('Server closed');

    // Clean up socket file
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
      logger.info('Socket file removed');
    }

    logger.close();
    process.exit(0);
  });

  // Force exit after 5 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});
