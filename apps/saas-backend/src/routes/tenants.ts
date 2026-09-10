// Tenant routes — onboarding, API key management.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { TenantService } from '../services/tenant.js';
import type { ApiKeyService } from '../services/api-key.js';

type AuthGuard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerTenantRoutes(
  app: FastifyInstance,
  tenantService: TenantService,
  apiKeyService: ApiKeyService,
  authGuard: AuthGuard,
) {
  // POST /api/v1/tenants — create a new tenant (onboarding)
  app.post('/api/v1/tenants', async (request, reply) => {
    const { name, slug } = request.body as { name: string; slug: string };
    if (!name || !slug) {
      return reply.status(400).send({ error: 'name and slug are required' });
    }

    try {
      const tenant = await tenantService.create(name, slug);
      return reply.status(201).send(tenant);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        return reply.status(409).send({ error: 'Slug already exists' });
      }
      throw err;
    }
  });

  // GET /api/v1/tenants — list tenants (admin)
  app.get('/api/v1/tenants', async (_request, reply) => {
    const tenants = await tenantService.list();
    return reply.send(tenants);
  });

  // GET /api/v1/tenants/:id — get tenant by ID
  app.get('/api/v1/tenants/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenant = await tenantService.getById(id);
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });
    return reply.send(tenant);
  });

  // PATCH /api/v1/tenants/:id/status — update tenant status
  app.patch('/api/v1/tenants/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: string };
    if (!['active', 'suspended', 'deleted'].includes(status)) {
      return reply.status(400).send({ error: 'Invalid status' });
    }
    const tenant = await tenantService.updateStatus(id, status as 'active' | 'suspended' | 'deleted');
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });
    return reply.send(tenant);
  });

  // --- API Keys (tenant-scoped, requires auth) ---

  // POST /api/v1/tenants/:id/api-keys — generate a new API key
  app.post('/api/v1/tenants/:id/api-keys', { preHandler: [authGuard] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { label } = (request.body as { label?: string }) ?? {};

    if (request.auth!.tenantId !== id) {
      return reply.status(403).send({ error: 'Cannot create keys for another tenant' });
    }

    const { plaintext, record } = await apiKeyService.generate(id, label);
    return reply.status(201).send({ key: plaintext, record });
  });

  // GET /api/v1/tenants/:id/api-keys — list API keys
  app.get('/api/v1/tenants/:id/api-keys', { preHandler: [authGuard] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (request.auth!.tenantId !== id) {
      return reply.status(403).send({ error: 'Cannot list keys for another tenant' });
    }
    const keys = await apiKeyService.listByTenant(id);
    return reply.send(keys);
  });

  // DELETE /api/v1/tenants/:id/api-keys/:keyId — revoke an API key
  app.delete('/api/v1/tenants/:id/api-keys/:keyId', { preHandler: [authGuard] }, async (request, reply) => {
    const { id, keyId } = request.params as { id: string; keyId: string };
    if (request.auth!.tenantId !== id) {
      return reply.status(403).send({ error: 'Cannot revoke keys for another tenant' });
    }
    const revoked = await apiKeyService.revoke(keyId, id);
    if (!revoked) return reply.status(404).send({ error: 'Key not found or already revoked' });
    return reply.send({ revoked: true });
  });
}
