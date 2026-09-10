// Tenant service — CRUD operations.

import type { Pool } from 'pg';
import type { Tenant, TenantStatus } from '@ai-platform/db';

export class TenantService {
  constructor(private readonly pool: Pool) {}

  async create(name: string, slug: string): Promise<Tenant> {
    const result = await this.pool.query(
      `INSERT INTO tenant (name, slug) VALUES ($1, $2)
       RETURNING id, name, slug, status, created_at, updated_at`,
      [name, slug],
    );
    return result.rows[0] as Tenant;
  }

  async getById(id: string): Promise<Tenant | null> {
    const result = await this.pool.query(
      `SELECT id, name, slug, status, created_at, updated_at FROM tenant WHERE id = $1`,
      [id],
    );
    return result.rows[0] as Tenant | null;
  }

  async getBySlug(slug: string): Promise<Tenant | null> {
    const result = await this.pool.query(
      `SELECT id, name, slug, status, created_at, updated_at FROM tenant WHERE slug = $1`,
      [slug],
    );
    return result.rows[0] as Tenant | null;
  }

  async list(status?: TenantStatus): Promise<Tenant[]> {
    if (status) {
      const result = await this.pool.query(
        `SELECT id, name, slug, status, created_at, updated_at FROM tenant WHERE status = $1 ORDER BY created_at DESC`,
        [status],
      );
      return result.rows as Tenant[];
    }
    const result = await this.pool.query(
      `SELECT id, name, slug, status, created_at, updated_at FROM tenant ORDER BY created_at DESC`,
    );
    return result.rows as Tenant[];
  }

  async updateStatus(id: string, status: TenantStatus): Promise<Tenant | null> {
    const result = await this.pool.query(
      `UPDATE tenant SET status = $1, updated_at = now() WHERE id = $2
       RETURNING id, name, slug, status, created_at, updated_at`,
      [status, id],
    );
    return result.rows[0] as Tenant | null;
  }
}
