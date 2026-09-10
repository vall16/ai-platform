// STTProvider — speech-to-text.

import type { Provider } from './provider.js';
import type { ProviderContext, ProviderResult } from './types.js';

/** Audio input for transcription. */
export interface AudioInput {
  /** MIME type (e.g. "audio/webm", "audio/mpeg"). */
  mimeType: string;
  /** Raw audio bytes. */
  audio: Uint8Array;
  /** Language hint (BCP 47). */
  language?: string;
}

/** Transcription result. */
export interface TranscriptionResult {
  text: string;
  /** Confidence score 0..1. */
  confidence: number;
  /** Word-level timestamps if available. */
  words?: Array<{ word: string; startMs: number; endMs: number }>;
}

/** Streaming STT session. */
export interface STTStream {
  sessionId: string;
  /** Send an audio chunk. */
  send(chunk: Uint8Array): void;
  /** Receive partial/final transcripts. */
  onTranscript(callback: (result: TranscriptionResult, isFinal: boolean) => void): void;
  /** End the stream. */
  close(): Promise<void>;
}

/**
 * Provider for speech-to-text.
 * Implementations: Deepgram, OpenAI Whisper, Azure Speech, etc.
 */
export interface STTProvider extends Provider {
  /** Transcribe a complete audio buffer. */
  transcribe(ctx: ProviderContext, audio: AudioInput): Promise<ProviderResult<TranscriptionResult>>;

  /** Start a realtime streaming transcription session. */
  startStream(ctx: ProviderContext, language?: string): Promise<STTStream>;
}
