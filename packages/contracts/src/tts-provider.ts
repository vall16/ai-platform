// TTSProvider — text-to-speech.

import type { Provider } from './provider.js';
import type { ProviderContext, ProviderResult } from './types.js';

/** TTS request. */
export interface TTSRequest {
  text: string;
  /** Voice identity. */
  voiceId: string;
  /** Output audio format. */
  format: 'mp3' | 'ogg' | 'wav' | 'pcm';
  /** Speech rate multiplier (1.0 = normal). */
  speed?: number;
  /** Language code (BCP 47). */
  language?: string;
}

/** TTS result. */
export interface TTSResult {
  /** Raw audio bytes. */
  audio: Uint8Array;
  /** MIME type of the output. */
  mimeType: string;
  /** Duration in seconds. */
  durationSec: number;
}

/** Streaming TTS session. */
export interface TTSStream {
  /** Send text to synthesize. */
  send(text: string): void;
  /** Receive audio chunks as they are generated. */
  onAudio(callback: (chunk: Uint8Array) => void): void;
  /** Called when all text has been synthesized. */
  onEnd(callback: () => void): void;
  /** End the stream. */
  close(): Promise<void>;
}

/**
 * Provider for text-to-speech.
 * Implementations: ElevenLabs, Deepgram, Azure TTS, etc.
 */
export interface TTSProvider extends Provider {
  /** Synthesize complete audio for a text input. */
  synthesize(ctx: ProviderContext, request: TTSRequest): Promise<ProviderResult<TTSResult>>;

  /** Start a streaming TTS session (low latency, chunked output). */
  startStream(ctx: ProviderContext, request: Omit<TTSRequest, 'text'>): Promise<TTSStream>;
}
