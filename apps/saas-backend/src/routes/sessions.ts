// Session routes — create, list, close conversation sessions.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SessionService } from '../services/session.js';
import type { AgentService } from '../services/agent.js';
import type { AudioStore } from '../services/audio-store.js';

type AuthGuard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerSessionRoutes(
  app: FastifyInstance,
  sessionService: SessionService,
  agentService: AgentService,
  audioStore: AudioStore,
  authGuard: AuthGuard,
) {
  // POST /api/v1/sessions — start a new session
  app.post('/api/v1/sessions', { preHandler: [authGuard] }, async (request, reply) => {
    const { product_type, metadata, language, personality, avatar_id, voice_id, site_url } =
      request.body as {
        product_type: 'persona' | 'salesperson';
        metadata?: Record<string, unknown>;
        language?: string;
        personality?: string;
        avatar_id?: string;
        voice_id?: string;
        site_url?: string;
      };

    if (!product_type || !['persona', 'salesperson'].includes(product_type)) {
      return reply.status(400).send({ error: 'product_type must be "persona" or "salesperson"' });
    }

    // Merge persona/voice fields (sent flat by the widget) into session metadata
    // so the AgentService can build the persona on the first message.
    const mergedMetadata: Record<string, unknown> = { ...(metadata ?? {}) };
    if (language) mergedMetadata.language = language;
    if (personality) mergedMetadata.personality = personality;
    if (avatar_id) mergedMetadata.avatar_id = avatar_id;
    if (voice_id) mergedMetadata.voice_id = voice_id;
    if (site_url) mergedMetadata.site_url = site_url;

    const session = await sessionService.create(request.auth!.tenantId, product_type, mergedMetadata);
    // The widget reads `session_id`; the DB row uses `id`. Expose both.
    return reply.status(201).send({ ...session, session_id: session.id });
  });

  // POST /api/v1/sessions/:id/messages — send a chat message (chatbot)
  app.post('/api/v1/sessions/:id/messages', { preHandler: [authGuard] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { text } = request.body as { text?: string };

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return reply.status(400).send({ error: 'text is required' });
    }

    try {
      const result = await agentService.sendMessage(id, request.auth!.tenantId, text, request.id);
      // Absolute URL on the origin the client reached the API on, so the
      // browser <audio> element can fetch it cross-origin.
      const audioUrl = result.audioId
        ? `${request.protocol}://${request.host}/api/v1/sessions/${id}/audio/${result.audioId}`
        : undefined;
      return reply.send({ reply: result.reply, audio_url: audioUrl });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'error';
      if (message === 'session_not_found') {
        return reply.status(404).send({ error: 'Session not found' });
      }
      if (message === 'session_not_active') {
        return reply.status(409).send({ error: 'Session is not active' });
      }
      request.log.error({ err }, 'Failed to process message');
      return reply.status(500).send({ error: 'Failed to process message' });
    }
  });

  // GET /api/v1/sessions/:id/audio/:audioId — serve synthesized TTS audio.
  // Unauthenticated: the browser <audio> element cannot send an Authorization
  // header, so the unguessable audio id (UUID) is the access capability.
  app.get('/api/v1/sessions/:id/audio/:audioId', async (request, reply) => {
    const { audioId } = request.params as { id: string; audioId: string };
    const audio = audioStore.get(audioId);
    if (!audio) return reply.status(404).send({ error: 'Audio not found' });
    reply.header('Content-Type', audio.mimeType);
    reply.header('Content-Length', audio.bytes.length);
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(Buffer.from(audio.bytes));
  });

  // GET /api/v1/sessions — list sessions for the tenant
  app.get('/api/v1/sessions', { preHandler: [authGuard] }, async (request, reply) => {
    const { status, limit } = request.query as { status?: string; limit?: string };
    const sessions = await sessionService.listByTenant(
      request.auth!.tenantId,
      status as 'active' | 'completed' | 'abandoned' | 'error' | undefined,
      limit ? parseInt(limit, 10) : 50,
    );
    return reply.send(sessions);
  });

  // GET /api/v1/sessions/active/count — count active sessions
  app.get('/api/v1/sessions/active/count', { preHandler: [authGuard] }, async (request, reply) => {
    const count = await sessionService.countActive(request.auth!.tenantId);
    return reply.send({ count });
  });

  // GET /api/v1/sessions/:id — get a specific session
  app.get('/api/v1/sessions/:id', { preHandler: [authGuard] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await sessionService.getById(id, request.auth!.tenantId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    return reply.send(session);
  });

  // POST /api/v1/sessions/:id/close — close a session
  app.post('/api/v1/sessions/:id/close', { preHandler: [authGuard] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = (request.body as { status?: string }) ?? {};
    const session = await sessionService.close(
      id,
      request.auth!.tenantId,
      (status as 'completed' | 'abandoned' | 'error') ?? 'completed',
    );
    if (!session) return reply.status(404).send({ error: 'Session not found or not active' });
    return reply.send(session);
  });
}
