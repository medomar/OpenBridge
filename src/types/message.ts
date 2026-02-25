/**
 * A typed progress event emitted during Master AI processing and exploration.
 *
 * Variants:
 * - classifying         — AI is analyzing the incoming message
 * - planning            — Master is decomposing the task into subtasks
 * - spawning            — N worker agents are being created
 * - worker-progress     — worker X of N has completed
 * - synthesizing        — Master is combining worker results into a final response
 * - complete            — Processing finished
 * - exploring           — Workspace exploration phase transition
 * - exploring-directory — Per-directory progress during exploration
 */
export type ProgressEvent =
  | { type: 'classifying' }
  | { type: 'planning' }
  | { type: 'spawning'; workerCount: number }
  | { type: 'worker-progress'; completed: number; total: number; workerName?: string }
  | { type: 'worker-result'; workerIndex: number; total: number; profile: string; tool?: string; content: string; success: boolean }
  | { type: 'synthesizing' }
  | { type: 'complete' }
  | { type: 'exploring'; phase: string; detail?: string }
  | { type: 'exploring-directory'; directory: string; completed: number; total: number };

/**
 * A message received from a messaging connector.
 */
export interface InboundMessage {
  /** Unique message ID (from the platform or generated) */
  id: string;
  /** The connector that received this message */
  source: string;
  /** Sender identifier (phone number, user ID, etc.) */
  sender: string;
  /** The raw message text as received */
  rawContent: string;
  /** The cleaned message content (prefix stripped, trimmed) */
  content: string;
  /** Timestamp when the message was received */
  timestamp: Date;
  /** Optional metadata from the platform */
  metadata?: Record<string, unknown>;
}

/**
 * A response to be sent back through a connector.
 */
export interface OutboundMessage {
  /** The connector to send through */
  target: string;
  /** The recipient identifier (phone number, user ID, etc.) — also used for proactive messaging */
  recipient: string;
  /** The response content */
  content: string;
  /** Reference to the original inbound message ID */
  replyTo?: string;
  /** Optional media attachment to send alongside or instead of text content */
  media?: {
    type: 'document' | 'image' | 'audio' | 'video';
    data: Buffer;
    mimeType: string;
    filename?: string;
  };
  /** Optional metadata for the connector */
  metadata?: Record<string, unknown>;
}
