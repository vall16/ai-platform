// Billing service — Stripe subscription management.

import Stripe from 'stripe';
import type { Pool } from 'pg';

export interface SubscriptionRecord {
  id: string;
  tenant_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string;
  status: string;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}

export class BillingService {
  private readonly stripe: Stripe;

  constructor(
    private readonly pool: Pool,
    stripeSecretKey: string,
  ) {
    this.stripe = new Stripe(stripeSecretKey);
  }

  /** Create a Stripe customer + subscription for a tenant. */
  async subscribe(tenantId: string, plan: string, email: string): Promise<SubscriptionRecord> {
    // Create or retrieve Stripe customer.
    const existing = await this.getSubscription(tenantId);
    let customerId: string;

    if (existing?.stripe_customer_id) {
      customerId = existing.stripe_customer_id;
    } else {
      const customer = await this.stripe.customers.create({ email });
      customerId = customer.id;
    }

    // Create subscription.
    const subscription = await this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: `price_${plan}` }],
      payment_behavior: 'default_incomplete',
    });

    const result = await this.pool.query(
      `INSERT INTO subscription (tenant_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end)
       VALUES ($1, $2, $3, $4, 'active', $5)
       ON CONFLICT (tenant_id) DO UPDATE SET
         stripe_customer_id = EXCLUDED.stripe_customer_id,
         stripe_subscription_id = EXCLUDED.stripe_subscription_id,
         plan = EXCLUDED.plan,
         status = 'active',
         current_period_end = EXCLUDED.current_period_end,
         updated_at = now()
       RETURNING id, tenant_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end, created_at, updated_at`,
      [tenantId, customerId, subscription.id, plan, new Date(subscription.current_period_end * 1000).toISOString()],
    );

    return result.rows[0] as SubscriptionRecord;
  }

  async cancelSubscription(tenantId: string): Promise<boolean> {
    const sub = await this.getSubscription(tenantId);
    if (!sub?.stripe_subscription_id) return false;

    await this.stripe.subscriptions.cancel(sub.stripe_subscription_id);

    await this.pool.query(
      `UPDATE subscription SET status = 'canceled', updated_at = now() WHERE tenant_id = $1`,
      [tenantId],
    );
    return true;
  }

  async getSubscription(tenantId: string): Promise<SubscriptionRecord | null> {
    const result = await this.pool.query(
      `SELECT id, tenant_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end, created_at, updated_at
       FROM subscription WHERE tenant_id = $1`,
      [tenantId],
    );
    return result.rows[0] as SubscriptionRecord | null;
  }

  /** Handle Stripe webhook events (subscription.updated, invoice.payment_failed, etc.). */
  async handleWebhook(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const tenantId = await this.findTenantByStripeId(sub.customer as string);
        if (tenantId) {
          await this.pool.query(
            `UPDATE subscription SET status = $1, current_period_end = $2, updated_at = now() WHERE tenant_id = $3`,
            [sub.status, new Date(sub.current_period_end * 1000).toISOString(), tenantId],
          );
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const tenantId = await this.findTenantByStripeId(sub.customer as string);
        if (tenantId) {
          await this.pool.query(
            `UPDATE subscription SET status = 'canceled', updated_at = now() WHERE tenant_id = $1`,
            [tenantId],
          );
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = await this.findTenantByStripeId(invoice.customer as string);
        if (tenantId) {
          await this.pool.query(
            `UPDATE subscription SET status = 'past_due', updated_at = now() WHERE tenant_id = $1`,
            [tenantId],
          );
        }
        break;
      }
    }
  }

  private async findTenantByStripeId(customerId: string): Promise<string | null> {
    const result = await this.pool.query(
      `SELECT tenant_id FROM subscription WHERE stripe_customer_id = $1`,
      [customerId],
    );
    return result.rows[0]?.tenant_id ?? null;
  }
}
