// Pattern matching utilities for rule engine

/**
 * Test if text matches any pattern in the list
 */
export function matchesAny(text: string, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) {
    return false;
  }

  const lowerText = text.toLowerCase();

  return patterns.some((pattern) => {
    try {
      const regex = new RegExp(pattern, 'i');
      return regex.test(text) || regex.test(lowerText);
    } catch {
      // If regex is invalid, try simple substring match
      return lowerText.includes(pattern.toLowerCase());
    }
  });
}

/**
 * Extract the question/message content from event data
 */
export function extractContent(eventData: Record<string, unknown>, eventType: string): string {
  switch (eventType) {
    case 'AskUserQuestion': {
      // Claude Code question format
      const toolInput = eventData.tool_input as Record<string, unknown> | undefined;
      if (toolInput?.questions && Array.isArray(toolInput.questions)) {
        const questions = toolInput.questions as Array<{ question?: string }>;
        if (questions[0]?.question) {
          return questions[0].question;
        }
      }
      return '';
    }

    case 'permission_prompt':
    case 'idle_prompt': {
      // Notification format
      const message = eventData.message;
      if (typeof message === 'string') {
        return message;
      }
      return '';
    }

    default:
      return '';
  }
}

/**
 * Map event type to prompt type for LLM
 */
export function mapEventTypeToPromptType(
  eventType: string
): 'question' | 'permission' | 'idle' {
  switch (eventType) {
    case 'AskUserQuestion':
      return 'question';
    case 'permission_prompt':
      return 'permission';
    case 'idle_prompt':
      return 'idle';
    default:
      return 'question';
  }
}
