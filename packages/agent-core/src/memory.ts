import type { ChatMessage } from '@ai-platform/contracts';

/**
 * In-session conversation memory.
 *
 * Phase 1 MVP: in-memory, single-node, bounded to the most recent N messages.
 * Persistent memory across restarts is a later phase.
 */
export class SessionMemory {
  private readonly bySession = new Map<string, ChatMessage[]>();
  private readonly maxMessages: number;

  constructor(maxMessages = 40) {
    this.maxMessages = maxMessages;
  }

  /** Return the current history for a session (empty if none). */
  get(sessionId: string): ChatMessage[] {
    return this.bySession.get(sessionId) ?? [];
  }

  /** Append a message, trimming to the most recent maxMessages. */
  append(sessionId: string, message: ChatMessage): void {
    const history = this.bySession.get(sessionId) ?? [];
    history.push(message);
    while (history.length > this.maxMessages) {
      history.shift();
    }
    this.bySession.set(sessionId, history);
  }

  /** Drop all memory for a session (called on close). */
  clear(sessionId: string): void {
    this.bySession.delete(sessionId);
  }
}
