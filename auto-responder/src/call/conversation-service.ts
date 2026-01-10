/**
 * Conversation Service
 *
 * Handles LLM-powered phone conversations with full tmux context.
 * Claude discusses plans with the user and sends final response to tmux on hangup.
 */

import OpenAI from 'openai';
import { execSync } from 'child_process';
import type { CallManager } from './call-manager';

interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface TmuxContext {
  session: string;
  window: string;
  pane: string;
  logs: string;
  project: string;
}

interface ConversationState {
  callId: string;
  tmuxContext: TmuxContext;
  messages: ConversationMessage[];
  currentPlan: string;
  isActive: boolean;
}

const SYSTEM_PROMPT = `You are Claude, an AI assistant having a phone conversation with a developer about their Claude Code session.

CONTEXT: You have access to the terminal logs from their Claude Code session. The developer is calling because Claude Code needs their input (a question, permission, or is waiting for direction).

YOUR ROLE:
1. Understand what Claude Code is currently waiting for from the terminal context
2. Ask the developer about it conversationally
3. Help them think through the decision/question
4. Discuss and refine their plan together
5. When they seem ready, summarize the plan clearly

CONVERSATION STYLE:
- Be concise - this is a phone call, not text chat
- Ask clarifying questions if needed
- Summarize back what you understand
- When the plan is clear, confirm it before they hang up

IMPORTANT: At the end of each response, internally track the current plan in your thinking. When the call ends, this plan will be sent to Claude Code.

Keep responses SHORT (1-3 sentences) since they'll be spoken aloud.`;

export class ConversationService {
  private openai: OpenAI;
  private callManager: CallManager;
  private activeConversations = new Map<string, ConversationState>();

  constructor(openaiApiKey: string, callManager: CallManager) {
    this.openai = new OpenAI({ apiKey: openaiApiKey });
    this.callManager = callManager;
  }

  /**
   * Start a conversation with full tmux context
   */
  async startConversation(
    tmuxContext: TmuxContext,
    initialMessage?: string
  ): Promise<string> {
    // Generate context-aware greeting
    const greeting = initialMessage || await this.generateGreeting(tmuxContext);
    console.log(`[Conversation] Greeting: ${greeting}`);

    const result = await this.callManager.initiateCall(greeting);
    const { callId, response: userResponse } = result;

    // Create conversation state
    const state: ConversationState = {
      callId,
      tmuxContext,
      messages: [
        { role: 'system', content: this.buildSystemPrompt(tmuxContext) },
        { role: 'assistant', content: greeting },
        { role: 'user', content: userResponse },
      ],
      currentPlan: '',
      isActive: true,
    };

    this.activeConversations.set(callId, state);

    // Start conversation loop
    this.runConversationLoop(callId).catch((err) => {
      console.error(`[Conversation] Loop error for ${callId}:`, err);
    });

    return callId;
  }

  private buildSystemPrompt(context: TmuxContext): string {
    return `${SYSTEM_PROMPT}

TERMINAL CONTEXT (last 200 lines from ${context.project}):
\`\`\`
${context.logs}
\`\`\`

When the conversation ends, your final plan will be sent as a response to the Claude Code session in tmux window ${context.window}.`;
  }

  private async generateGreeting(context: TmuxContext): Promise<string> {
    // Use LLM to analyze context and generate a specific greeting
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are starting a phone call with a developer. Analyze their terminal output and generate a brief, specific greeting (1-2 sentences) that tells them exactly what Claude Code needs.

Be specific about:
- What question is being asked OR
- What permission is needed OR
- What error occurred OR
- What task just completed

Keep it conversational and SHORT (will be spoken aloud).`
          },
          {
            role: 'user',
            content: `Terminal output from ${context.project}:\n\`\`\`\n${context.logs.slice(-3000)}\n\`\`\`\n\nGenerate a greeting that specifically tells me what Claude Code needs.`
          }
        ],
        max_tokens: 100,
        temperature: 0.7,
      });

      return response.choices[0]?.message?.content || "Hey! Claude Code needs your input. What's on your mind?";
    } catch (error) {
      console.error('[Conversation] Failed to generate greeting:', error);
      // Fallback to simple analysis
      const logs = context.logs.toLowerCase();
      if (logs.includes('askuserquestion') || logs.includes('question')) {
        return "Hey! Claude Code has a question for you. Let me know what you think.";
      }
      if (logs.includes('permission') || logs.includes('allow')) {
        return "Hey! Claude Code needs your permission to proceed.";
      }
      return "Hey! Claude Code is waiting for your input.";
    }
  }

  private async runConversationLoop(callId: string): Promise<void> {
    const state = this.activeConversations.get(callId);
    if (!state) return;

    while (state.isActive) {
      try {
        // Generate LLM response
        const assistantResponse = await this.generateResponse(state);
        state.messages.push({ role: 'assistant', content: assistantResponse });

        // Extract plan from response if mentioned
        this.updatePlan(state, assistantResponse);

        // Continue the call with the response
        const userResponse = await this.callManager.continueCall(callId, assistantResponse);
        state.messages.push({ role: 'user', content: userResponse });

        console.log(`[Conversation] User: ${userResponse}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Check if call was hung up
        if (errorMsg.includes('hung up') || errorMsg.includes('No active call')) {
          console.log(`[Conversation] Call ended for ${callId}`);
          state.isActive = false;
          await this.finalizeConversation(state);
          break;
        }

        console.error(`[Conversation] Error in loop:`, error);
        state.isActive = false;
        break;
      }
    }

    this.activeConversations.delete(callId);
  }

  private async generateResponse(state: ConversationState): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: state.messages as OpenAI.ChatCompletionMessageParam[],
      max_tokens: 150, // Keep responses short for voice
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content || "I didn't catch that. Could you repeat?";
  }

  private updatePlan(state: ConversationState, response: string): void {
    // Look for plan indicators in the response
    const planIndicators = [
      /(?:so |okay |alright |got it)[,.]?\s*(?:the plan is|we'll|you want me to|i'll)\s*(.+)/i,
      /(?:to summarize|in summary)[,:]?\s*(.+)/i,
      /(?:i understand|sounds like)\s*(?:you want|we should)\s*(.+)/i,
    ];

    for (const pattern of planIndicators) {
      const match = response.match(pattern);
      if (match) {
        state.currentPlan = match[1].trim();
        break;
      }
    }
  }

  private async finalizeConversation(state: ConversationState): Promise<void> {
    console.log(`[Conversation] Finalizing conversation for ${state.callId}`);

    // Generate a final summary/plan from the conversation
    const finalPlan = await this.extractFinalPlan(state);

    console.log(`[Conversation] Final plan: ${finalPlan}`);

    // Send to tmux (pane is optional - we can target by session:window)
    if (finalPlan && (state.tmuxContext.session || state.tmuxContext.window)) {
      await this.sendToTmux(state.tmuxContext, finalPlan);
    } else {
      console.log(`[Conversation] No tmux context to send plan to`);
    }
  }

  private async extractFinalPlan(state: ConversationState): Promise<string> {
    // If we already have a clear plan, use it
    if (state.currentPlan) {
      return state.currentPlan;
    }

    // Otherwise, ask LLM to extract the final response
    const extractionPrompt: ConversationMessage = {
      role: 'user',
      content: `The call has ended. Based on our conversation, what is the final response I should send to Claude Code?

Give me ONLY the text that should be typed into the terminal - no explanations, no quotes, just the exact response.
If the user agreed to something, give that answer. If they gave specific instructions, summarize them concisely.
If no clear answer was given, respond with what seems most appropriate based on the discussion.`,
    };

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [...state.messages, extractionPrompt] as OpenAI.ChatCompletionMessageParam[],
      max_tokens: 200,
      temperature: 0.3,
    });

    return response.choices[0]?.message?.content?.trim() || '';
  }

  private async sendToTmux(context: TmuxContext, response: string): Promise<void> {
    try {
      // Escape the response for shell
      const escaped = response
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`')
        .replace(/!/g, '\\!');

      // Build tmux target - prefer pane, fall back to session:window
      let target: string;
      if (context.pane && context.pane.startsWith('%')) {
        target = context.pane;
      } else {
        target = `${context.session}:${context.window}`;
      }

      console.log(`[Conversation] Sending to tmux target: ${target}`);

      // Send to tmux
      execSync(`tmux send-keys -t "${target}" "${escaped}"`, { encoding: 'utf-8' });
      execSync(`tmux send-keys -t "${target}" Enter`, { encoding: 'utf-8' });

      console.log(`[Conversation] Sent response to tmux: ${response.substring(0, 80)}...`);
    } catch (error) {
      console.error(`[Conversation] Failed to send to tmux:`, error);
      // Log the full error for debugging
      if (error instanceof Error) {
        console.error(`[Conversation] Error details: ${error.message}`);
      }
    }
  }

  /**
   * Read tmux logs for a specific window
   */
  static readTmuxLogs(session: string, window: string, lines: number = 200): string {
    try {
      const output = execSync(
        `tmux capture-pane -t ${session}:${window} -p -S -${lines}`,
        { encoding: 'utf-8', maxBuffer: 1024 * 1024 }
      );
      return output;
    } catch (error) {
      console.error(`[Conversation] Failed to read tmux logs:`, error);
      return '';
    }
  }

  /**
   * Get project path from tmux pane
   */
  static getTmuxProject(session: string, window: string): string {
    try {
      const output = execSync(
        `tmux display-message -t ${session}:${window} -p '#{pane_current_path}'`,
        { encoding: 'utf-8' }
      );
      return output.trim().split('/').slice(-2).join('/');
    } catch {
      return 'unknown';
    }
  }
}
