import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import bcrypt from 'bcryptjs';
import { eq, desc } from 'drizzle-orm';
import { db } from './src/db/index.ts';
import {
  users,
  plans,
  customers,
  subscriptions,
  billingCycles,
  invoices,
  payments,
  refunds,
  auditLogs,
} from './src/db/schema.ts';
import {
  requireAuth,
  requireAdmin,
  signJwtToken,
  getOrCreateUserFromAuth,
  AuthRequest,
} from './src/middleware/auth.ts';
import {
  validateStateTransition,
  logAudit,
  calculateCycleDates,
  calculateProration,
  ensureSeededDatabase,
} from './src/db/billing-service.ts';

const app = express();
const PORT = 3000;

app.use(express.json());

// Ensure seed data on first API request
let seedPromise: Promise<void> | null = null;
app.use('/api', async (_req, _res, next) => {
  try {
    if (!seedPromise) {
      seedPromise = ensureSeededDatabase();
    }
    await seedPromise;
  } catch (err) {
    console.error('Seed check error:', err);
  }
  next();
});

// ============================================================================
// TASK 1: Swagger / OpenAPI Documentation Spec
// ============================================================================
app.get('/api/openapi.json', (_req, res) => {
  res.json({
    openapi: '3.0.3',
    info: {
      title: 'Subscription Billing Automation System API',
      version: '3.0.0',
      description:
        'Enterprise SaaS Subscription Lifecycle, Proration Engine, Dunning Retry Queue, GST Invoicing & RBAC Analytics API',
    },
    paths: {
      '/api/auth/signup': { post: { summary: 'Register user account (JWT)', tags: ['Authentication'] } },
      '/api/auth/signin': { post: { summary: 'Sign in with email & password (JWT)', tags: ['Authentication'] } },
      '/api/auth/role': { patch: { summary: 'Switch active role (Admin / Customer) for testing RBAC', tags: ['Authentication'] } },
      '/api/plans': {
        get: { summary: 'List subscription plans', tags: ['Plans'] },
        post: { summary: 'Create new plan (Admin only)', tags: ['Plans'] },
      },
      '/api/plans/{id}': {
        put: { summary: 'Update plan (Admin only)', tags: ['Plans'] },
        delete: { summary: 'Delete plan (Admin only)', tags: ['Plans'] },
      },
      '/api/plans/{id}/archive': {
        patch: { summary: 'Archive or unarchive plan (Admin only)', tags: ['Plans'] },
      },
      '/api/customers': {
        get: { summary: 'List SaaS customers', tags: ['Customers'] },
        post: { summary: 'Create SaaS customer', tags: ['Customers'] },
      },
      '/api/customers/{id}': {
        get: { summary: 'Get customer details', tags: ['Customers'] },
        put: { summary: 'Update customer details', tags: ['Customers'] },
      },
      '/api/customers/{id}/billing-history': {
        get: { summary: 'Chronological customer billing timeline (M3 Task 3)', tags: ['Customers'] },
      },
      '/api/customers/{id}/activity-summary': {
        get: { summary: 'Customer activity summary metrics (M3 Task 3)', tags: ['Customers'] },
      },
      '/api/subscriptions': {
        get: { summary: 'List subscriptions with customer & plan details', tags: ['Subscriptions'] },
        post: { summary: 'Create subscription with trial & billing cycle calculation', tags: ['Subscriptions'] },
      },
      '/api/subscriptions/{id}/transition': {
        post: { summary: 'Execute validated state machine transition (trial/active/past_due/cancelled)', tags: ['Subscriptions'] },
      },
      '/api/subscriptions/{id}/proration-preview': {
        post: { summary: 'Preview mid-cycle plan upgrade/downgrade proration credit & charge', tags: ['Subscriptions'] },
      },
      '/api/subscriptions/{id}/change-plan': {
        post: { summary: 'Change subscription plan with proration adjustment invoice', tags: ['Subscriptions'] },
      },
      '/api/subscriptions/{id}/pause': {
        post: { summary: 'Pause active subscription', tags: ['Subscriptions'] },
      },
      '/api/subscriptions/{id}/resume': {
        post: { summary: 'Resume paused subscription', tags: ['Subscriptions'] },
      },
      '/api/subscriptions/{id}/cancel': {
        post: { summary: 'Cancel subscription via state machine', tags: ['Subscriptions'] },
      },
      '/api/subscriptions/{id}/history': {
        get: { summary: 'Get subscription plan change history', tags: ['Subscriptions'] },
      },
      '/api/invoices': {
        get: { summary: 'List & filter invoices by number, customer, status, date', tags: ['Invoices'] },
      },
      '/api/invoices/generate': {
        post: { summary: 'Automatically generate GST invoices for active subscriptions', tags: ['Invoices'] },
      },
      '/api/payments': {
        get: { summary: 'List all payment transactions', tags: ['Payments'] },
      },
      '/api/payments/failed': {
        get: { summary: 'List failed payments in dunning retry queue', tags: ['Payments'] },
      },
      '/api/payments/process': {
        post: { summary: 'Mock payment gateway processor (80% success / 20% failure or explicit)', tags: ['Payments'] },
      },
      '/api/payments/{id}/retry': {
        post: { summary: 'Execute dunning retry attempt (Day 1 -> Day 3 -> Day 7 schedule)', tags: ['Payments'] },
      },
      '/api/webhooks/payment': {
        post: { summary: 'Webhook handler for payment_success, payment_failed, payment_refunded', tags: ['Webhooks'] },
      },
      '/api/refunds': {
        get: { summary: 'List issued prorated refunds', tags: ['Refunds'] },
        post: { summary: 'Calculate & issue prorated refund based on used/remaining cycle days', tags: ['Refunds'] },
      },
      '/api/dashboard/summary': {
        get: { summary: 'Admin dashboard summary KPIs (Admin only)', tags: ['Admin Dashboard'] },
      },
      '/api/dashboard/revenue-by-plan': {
        get: { summary: 'MRR breakdown by subscription plan (Admin only)', tags: ['Admin Dashboard'] },
      },
      '/api/dashboard/subscription-metrics': {
        get: { summary: 'Subscription status distribution, churn rate & trial conversion (Admin only)', tags: ['Admin Dashboard'] },
      },
      '/api/audit-logs': {
        get: { summary: 'Filterable system-wide immutable audit log viewer', tags: ['Audit Logs'] },
      },
    },
  });
});

// ============================================================================
// TASK 3: User Authentication (Signup creates role = 'customer', Signin reads user.role from DB)
// ============================================================================
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password, companyName } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim()));
    if (existing.length > 0) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    // Customer registration always creates role = 'customer' automatically
    const assignedRole = 'customer';

    const [newUser] = await db
      .insert(users)
      .values({
        uid: `usr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        email: email.toLowerCase().trim(),
        name: name.trim(),
        passwordHash,
        role: assignedRole,
      })
      .returning();

    // Automatically create a linked SaaS Customer record
    const existingCust = await db.select().from(customers).where(eq(customers.email, newUser.email));
    if (existingCust.length === 0) {
      const [createdCust] = await db
        .insert(customers)
        .values({
          name: newUser.name,
          email: newUser.email,
          companyName: companyName || `${newUser.name}'s Workspace`,
          userId: newUser.id,
        })
        .returning();

      await logAudit({
        entityType: 'customer',
        entityId: createdCust.id,
        customerId: createdCust.id,
        action: 'Customer Created',
        newValue: `${createdCust.companyName} (${createdCust.email})`,
        performedBy: newUser.name,
      });
    }

    const authUser = {
      id: newUser.id,
      uid: newUser.uid,
      email: newUser.email,
      name: newUser.name,
      role: 'customer' as const,
    };
    const token = signJwtToken(authUser);

    return res.status(201).json({ token, role: authUser.role, user: authUser });
  } catch (error: any) {
    console.error('Signup error:', error);
    return res.status(500).json({ error: 'Failed to create user account.' });
  }
});

app.post('/api/auth/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    // Support both admin@subbill.com and admin@subops.io seamlessly
    let found = await db.select().from(users).where(eq(users.email, normalizedEmail));
    if (found.length === 0 && normalizedEmail === 'admin@subbill.com') {
      found = await db.select().from(users).where(eq(users.email, 'admin@subops.io'));
    }

    if (found.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const u = found[0];
    if (u.passwordHash) {
      const valid = await bcrypt.compare(password, u.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
    }

    const resolvedRole = (u.role === 'admin' ? 'admin' : 'customer') as 'admin' | 'customer';
    const authUser = {
      id: u.id,
      uid: u.uid,
      email: u.email,
      name: u.name,
      role: resolvedRole,
    };
    const token = signJwtToken(authUser);
    return res.json({ token, role: resolvedRole, user: authUser });
  } catch (error: any) {
    console.error('Signin error:', error);
    return res.status(500).json({ error: 'Authentication failed.' });
  }
});

app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
  return res.json({ user: req.user });
});

app.patch('/api/auth/role', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { role } = req.body;
    if (role !== 'admin' && role !== 'customer') {
      return res.status(400).json({ error: "Role must be 'admin' or 'customer'." });
    }
    const [updated] = await db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, req.user!.id))
      .returning();

    const authUser = {
      id: updated.id,
      uid: updated.uid,
      email: updated.email,
      name: updated.name,
      role: (updated.role === 'admin' ? 'admin' : 'customer') as 'admin' | 'customer',
    };
    const token = signJwtToken(authUser);
    return res.json({ token, user: authUser });
  } catch (error) {
    console.error('Role update failed:', error);
    return res.status(500).json({ error: 'Failed to switch user role.' });
  }
});

// ============================================================================
// TASK 5: Plan Management APIs (Creating/Modifying plans restricted to Admin!)
// ============================================================================
app.get('/api/plans', requireAuth, async (req: AuthRequest, res) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    const allPlans = await db.select().from(plans).orderBy(plans.price);
    const filtered = includeArchived ? allPlans : allPlans.filter((p) => !p.isArchived);
    return res.json(filtered);
  } catch (error) {
    console.error('Error fetching plans:', error);
    return res.status(500).json({ error: 'Failed to fetch subscription plans.' });
  }
});

app.post('/api/plans', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { name, price, billing_interval, trial_days, features, target_audience } = req.body;
    if (!name || price === undefined) {
      return res.status(400).json({ error: 'Plan name and price are required.' });
    }

    const parsedFeatures = Array.isArray(features)
      ? JSON.stringify(features)
      : typeof features === 'string'
      ? JSON.stringify(
          features
            .split('\n')
            .map((s: string) => s.trim())
            .filter(Boolean)
        )
      : JSON.stringify(['Standard subscription access']);

    const [created] = await db
      .insert(plans)
      .values({
        name: String(name).trim(),
        price: Number(price),
        billingInterval: billing_interval || 'monthly',
        trialDays: trial_days !== undefined ? Number(trial_days) : 14,
        features: parsedFeatures,
        targetAudience: target_audience || 'For scaling SaaS teams',
        isArchived: false,
      })
      .returning();

    await logAudit({
      entityType: 'plan',
      entityId: created.id,
      action: 'Plan Created',
      oldValue: null,
      newValue: `${created.name} (₹${created.price}/${created.billingInterval})`,
      performedBy: req.user?.name || 'Admin',
    });

    return res.status(201).json(created);
  } catch (error) {
    console.error('Create plan error:', error);
    return res.status(500).json({ error: 'Failed to create subscription plan.' });
  }
});

app.put('/api/plans/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const planId = Number(req.params.id);
    const existing = await db.select().from(plans).where(eq(plans.id, planId));
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Plan not found.' });
    }
    const oldPlan = existing[0];
    const { name, price, billing_interval, trial_days, features, target_audience } = req.body;

    const parsedFeatures =
      features !== undefined
        ? Array.isArray(features)
          ? JSON.stringify(features)
          : typeof features === 'string'
          ? JSON.stringify(
              features
                .split('\n')
                .map((s: string) => s.trim())
                .filter(Boolean)
            )
          : oldPlan.features
        : oldPlan.features;

    const [updated] = await db
      .update(plans)
      .set({
        name: name !== undefined ? String(name).trim() : oldPlan.name,
        price: price !== undefined ? Number(price) : oldPlan.price,
        billingInterval: billing_interval || oldPlan.billingInterval,
        trialDays: trial_days !== undefined ? Number(trial_days) : oldPlan.trialDays,
        features: parsedFeatures,
        targetAudience: target_audience || oldPlan.targetAudience,
        updatedAt: new Date(),
      })
      .where(eq(plans.id, planId))
      .returning();

    await logAudit({
      entityType: 'plan',
      entityId: updated.id,
      action: 'Plan Updated',
      oldValue: `${oldPlan.name} (₹${oldPlan.price}/${oldPlan.billingInterval})`,
      newValue: `${updated.name} (₹${updated.price}/${updated.billingInterval})`,
      performedBy: req.user?.name || 'Admin',
    });

    return res.json(updated);
  } catch (error) {
    console.error('Update plan error:', error);
    return res.status(500).json({ error: 'Failed to update plan.' });
  }
});

app.patch('/api/plans/:id/archive', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const planId = Number(req.params.id);
    const existing = await db.select().from(plans).where(eq(plans.id, planId));
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Plan not found.' });
    }
    const oldPlan = existing[0];
    const nextState = req.body.isArchived !== undefined ? Boolean(req.body.isArchived) : !oldPlan.isArchived;

    const [updated] = await db
      .update(plans)
      .set({ isArchived: nextState, updatedAt: new Date() })
      .where(eq(plans.id, planId))
      .returning();

    await logAudit({
      entityType: 'plan',
      entityId: updated.id,
      action: nextState ? 'Plan Archived' : 'Plan Restored',
      oldValue: `Archived: ${oldPlan.isArchived}`,
      newValue: `Archived: ${updated.isArchived}`,
      performedBy: req.user?.name || 'Admin',
    });

    return res.json(updated);
  } catch (error) {
    console.error('Archive plan error:', error);
    return res.status(500).json({ error: 'Failed to archive plan.' });
  }
});

app.delete('/api/plans/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const planId = Number(req.params.id);
    const existing = await db.select().from(plans).where(eq(plans.id, planId));
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Plan not found.' });
    }
    const subsUsingPlan = await db.select().from(subscriptions).where(eq(subscriptions.planId, planId));
    if (subsUsingPlan.length > 0) {
      // Soft-delete / archive if active subscriptions reference it to preserve relational integrity
      const [archived] = await db
        .update(plans)
        .set({ isArchived: true, updatedAt: new Date() })
        .where(eq(plans.id, planId))
        .returning();
      await logAudit({
        entityType: 'plan',
        entityId: planId,
        action: 'Plan Archived (Referenced by Subscriptions)',
        oldValue: existing[0].name,
        newValue: 'Archived',
        performedBy: req.user?.name || 'Admin',
      });
      return res.json({ deleted: false, archived: true, plan: archived });
    }

    await db.delete(plans).where(eq(plans.id, planId));
    await logAudit({
      entityType: 'plan',
      entityId: planId,
      action: 'Plan Deleted',
      oldValue: existing[0].name,
      newValue: 'Deleted',
      performedBy: req.user?.name || 'Admin',
    });
    return res.json({ deleted: true });
  } catch (error) {
    console.error('Delete plan error:', error);
    return res.status(500).json({ error: 'Failed to delete plan.' });
  }
});

// Helper to resolve the active Customer record for a logged-in Customer user
async function resolveScopedCustomerId(user?: { id: number; email: string; role: 'admin' | 'customer' }): Promise<number | null> {
  if (!user || user.role === 'admin') return null;
  const byUserId = await db.select().from(customers).where(eq(customers.userId, user.id));
  if (byUserId.length > 0) return byUserId[0].id;
  const byEmail = await db.select().from(customers).where(eq(customers.email, user.email));
  if (byEmail.length > 0) return byEmail[0].id;
  const all = await db.select().from(customers);
  return all[0]?.id ?? null;
}

// ============================================================================
// TASK 6 & M3 TASK 3: Customer Management & Billing Timeline APIs
// ============================================================================
app.get('/api/customers', requireAuth, async (req: AuthRequest, res) => {
  try {
    const scopedCustomerId = await resolveScopedCustomerId(req.user);
    const allCustomers = await db.select().from(customers).orderBy(desc(customers.createdAt));
    const visibleCustomers =
      scopedCustomerId !== null
        ? allCustomers.filter((c) => c.id === scopedCustomerId)
        : allCustomers;

    const allSubs = await db.select().from(subscriptions);
    const allPlans = await db.select().from(plans);
    const planMap = new Map(allPlans.map((p) => [p.id, p]));

    const enriched = visibleCustomers.map((c) => {
      const custSubs = allSubs.filter((s) => s.customerId === c.id);
      const activeSub = custSubs.find((s) => s.status === 'active' || s.status === 'trial' || s.status === 'past_due') || custSubs[0];
      const plan = activeSub ? planMap.get(activeSub.planId) : null;
      return {
        ...c,
        activeSubscription: activeSub || null,
        currentPlanName: plan ? plan.name : 'No Plan',
        currentPlanPrice: plan ? plan.price : 0,
      };
    });

    return res.json(enriched);
  } catch (error) {
    console.error('List customers error:', error);
    return res.status(500).json({ error: 'Failed to list customers.' });
  }
});

app.get('/api/customers/:id', requireAuth, async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    const found = await db.select().from(customers).where(eq(customers.id, customerId));
    if (found.length === 0) {
      return res.status(404).json({ error: 'Customer not found.' });
    }
    return res.json(found[0]);
  } catch (error) {
    console.error('Get customer error:', error);
    return res.status(500).json({ error: 'Failed to fetch customer.' });
  }
});

app.post('/api/customers', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { name, email, company_name } = req.body;
    if (!name || !email || !company_name) {
      return res.status(400).json({ error: 'Name, email, and company_name are required.' });
    }
    const [created] = await db
      .insert(customers)
      .values({
        name: String(name).trim(),
        email: String(email).toLowerCase().trim(),
        companyName: String(company_name).trim(),
      })
      .returning();

    await logAudit({
      entityType: 'customer',
      entityId: created.id,
      customerId: created.id,
      action: 'Customer Created',
      oldValue: null,
      newValue: `${created.companyName} (${created.email})`,
      performedBy: req.user?.name || 'System',
    });

    return res.status(201).json(created);
  } catch (error: any) {
    console.error('Create customer error:', error);
    return res.status(500).json({ error: 'Failed to create customer. Email may already be in use.' });
  }
});

app.put('/api/customers/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const customerId = Number(req.params.id);
    const existing = await db.select().from(customers).where(eq(customers.id, customerId));
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Customer not found.' });
    }
    const oldCust = existing[0];
    const { name, email, company_name } = req.body;

    const [updated] = await db
      .update(customers)
      .set({
        name: name !== undefined ? String(name).trim() : oldCust.name,
        email: email !== undefined ? String(email).toLowerCase().trim() : oldCust.email,
        companyName: company_name !== undefined ? String(company_name).trim() : oldCust.companyName,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, customerId))
      .returning();

    await logAudit({
      entityType: 'customer',
      entityId: updated.id,
      customerId: updated.id,
      action: 'Customer Updated',
      oldValue: `${oldCust.name} • ${oldCust.companyName}`,
      newValue: `${updated.name} • ${updated.companyName}`,
      performedBy: req.user?.name || 'System',
    });

    return res.json(updated);
  } catch (error) {
    console.error('Update customer error:', error);
    return res.status(500).json({ error: 'Failed to update customer.' });
  }
});

// M3 Task 3: Customer Billing Timeline API
app.get('/api/customers/:id/billing-history', requireAuth, async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    const foundCust = await db.select().from(customers).where(eq(customers.id, customerId));
    if (foundCust.length === 0) {
      return res.status(404).json({ error: 'Customer not found.' });
    }
    const customer = foundCust[0];

    const custSubs = await db.select().from(subscriptions).where(eq(subscriptions.customerId, customerId));
    const custInvoices = await db.select().from(invoices).where(eq(invoices.customerId, customerId));
    const custRefunds = await db.select().from(refunds).where(eq(refunds.customerId, customerId));
    const custLogs = await db.select().from(auditLogs).where(eq(auditLogs.customerId, customerId));
    const allPlans = await db.select().from(plans);
    const planMap = new Map(allPlans.map((p) => [p.id, p]));

    const allPayments = await db.select().from(payments);
    const invoiceIds = new Set(custInvoices.map((i) => i.id));
    const custPayments = allPayments.filter((p) => invoiceIds.has(p.invoiceId));

    const timeline: Array<{
      id: string;
      date: string;
      title: string;
      detail: string;
      category: 'subscription' | 'plan_change' | 'invoice' | 'payment' | 'refund';
      performedBy: string;
    }> = [];

    for (const log of custLogs) {
      timeline.push({
        id: `log-${log.id}`,
        date: log.createdAt.toISOString(),
        title: log.action,
        detail: log.newValue ? `${log.oldValue ? `${log.oldValue} → ` : ''}${log.newValue}` : log.action,
        category: log.action.toLowerCase().includes('plan')
          ? 'plan_change'
          : log.entityType === 'invoice'
          ? 'invoice'
          : log.entityType === 'payment'
          ? 'payment'
          : log.entityType === 'refund'
          ? 'refund'
          : 'subscription',
        performedBy: log.performedBy,
      });
    }

    // Sort newest first or chronological
    timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const enrichedSubs = custSubs.map((s) => ({
      ...s,
      plan: planMap.get(s.planId) || null,
    }));

    return res.json({
      customer,
      subscriptions: enrichedSubs,
      invoices: custInvoices,
      payments: custPayments,
      refunds: custRefunds,
      timeline,
    });
  } catch (error) {
    console.error('Billing history error:', error);
    return res.status(500).json({ error: 'Failed to load customer billing history.' });
  }
});

// M3 Task 3: Customer Activity Summary API
app.get('/api/customers/:id/activity-summary', requireAuth, async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    const custInvoices = await db.select().from(invoices).where(eq(invoices.customerId, customerId));
    const custRefunds = await db.select().from(refunds).where(eq(refunds.customerId, customerId));
    const allPayments = await db.select().from(payments);
    const invoiceIds = new Set(custInvoices.map((i) => i.id));
    const custPayments = allPayments.filter((p) => invoiceIds.has(p.invoiceId));

    const totalPaid = custPayments
      .filter((p) => p.status === 'success')
      .reduce((acc, p) => acc + p.amount, 0);
    const failedPayments = custPayments.filter((p) => p.status === 'failed').length;
    const successPaymentsCount = custPayments.filter((p) => p.status === 'success').length;

    return res.json({
      total_invoices: custInvoices.length,
      total_payments: successPaymentsCount,
      total_paid: totalPaid,
      failed_payments: failedPayments,
      refunds: custRefunds.length,
    });
  } catch (error) {
    console.error('Customer activity summary error:', error);
    return res.status(500).json({ error: 'Failed to fetch customer activity summary.' });
  }
});

// ============================================================================
// TASK 4, 7, 8, 9 & M2 TASK 2: Subscriptions, State Machine, Proration & Billing Cycles
// ============================================================================
app.get('/api/subscriptions', requireAuth, async (req: AuthRequest, res) => {
  try {
    const scopedCustomerId = await resolveScopedCustomerId(req.user);
    const allSubs = await db.select().from(subscriptions).orderBy(desc(subscriptions.createdAt));
    const visibleSubs =
      scopedCustomerId !== null
        ? allSubs.filter((s) => s.customerId === scopedCustomerId)
        : allSubs;

    const allCustomers = await db.select().from(customers);
    const allPlans = await db.select().from(plans);
    const allCycles = await db.select().from(billingCycles).orderBy(desc(billingCycles.cycleStartDate));

    const custMap = new Map(allCustomers.map((c) => [c.id, c]));
    const planMap = new Map(allPlans.map((p) => [p.id, p]));

    const enriched = visibleSubs.map((s) => ({
      ...s,
      customer: custMap.get(s.customerId) || null,
      plan: planMap.get(s.planId) || null,
      cycles: allCycles.filter((c) => c.subscriptionId === s.id),
    }));

    return res.json(enriched);
  } catch (error) {
    console.error('List subscriptions error:', error);
    return res.status(500).json({ error: 'Failed to load subscriptions.' });
  }
});

app.post('/api/subscriptions', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { customer_id, plan_id, start_immediately } = req.body;
    if (!customer_id || !plan_id) {
      return res.status(400).json({ error: 'customer_id and plan_id are required.' });
    }

    const custFound = await db.select().from(customers).where(eq(customers.id, Number(customer_id)));
    if (custFound.length === 0) {
      return res.status(404).json({ error: 'Customer does not exist.' });
    }

    const planFound = await db.select().from(plans).where(eq(plans.id, Number(plan_id)));
    if (planFound.length === 0) {
      return res.status(404).json({ error: 'Plan does not exist.' });
    }

    const customer = custFound[0];
    const plan = planFound[0];
    const now = new Date();
    const useTrial = !start_immediately && plan.trialDays > 0;
    const initialStatus = useTrial ? 'trial' : 'active';

    const { cycleStartDate, cycleEndDate, renewalDate } = calculateCycleDates(
      now,
      plan.billingInterval,
      useTrial ? plan.trialDays : 0
    );

    const [createdSub] = await db
      .insert(subscriptions)
      .values({
        customerId: customer.id,
        planId: plan.id,
        status: initialStatus,
        isPaused: false,
        hadTrial: useTrial,
        startDate: cycleStartDate,
        endDate: cycleEndDate,
        statusChangedAt: now,
      })
      .returning();

    const [createdCycle] = await db
      .insert(billingCycles)
      .values({
        subscriptionId: createdSub.id,
        cycleStartDate,
        cycleEndDate,
        renewalDate,
        status: 'pending',
      })
      .returning();

    await logAudit({
      entityType: 'subscription',
      entityId: createdSub.id,
      customerId: customer.id,
      action: 'Subscription Created',
      oldValue: null,
      newValue: `${plan.name} Plan (${initialStatus.toUpperCase()}) • Renewal ${renewalDate.toISOString().split('T')[0]}`,
      performedBy: req.user?.name || customer.name,
    });

    return res.status(201).json({
      subscription: createdSub,
      billingCycle: createdCycle,
      customer,
      plan,
    });
  } catch (error) {
    console.error('Create subscription error:', error);
    return res.status(500).json({ error: 'Failed to create subscription.' });
  }
});

// Task 4: State Machine Transition Endpoint
app.post('/api/subscriptions/:id/transition', requireAuth, async (req: AuthRequest, res) => {
  try {
    const subId = Number(req.params.id);
    const { target_status } = req.body;
    const found = await db.select().from(subscriptions).where(eq(subscriptions.id, subId));
    if (found.length === 0) {
      return res.status(404).json({ error: 'Subscription not found.' });
    }

    const sub = found[0];
    const check = validateStateTransition(sub.status, target_status);
    if (!check.valid) {
      return res.status(400).json({ error: check.reason });
    }

    const now = new Date();
    const [updated] = await db
      .update(subscriptions)
      .set({
        status: target_status,
        statusChangedAt: now,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, subId))
      .returning();

    await logAudit({
      entityType: 'subscription',
      entityId: sub.id,
      customerId: sub.customerId,
      action: `Status Transition: ${sub.status} → ${target_status}`,
      oldValue: sub.status,
      newValue: target_status,
      performedBy: req.user?.name || 'System',
    });

    return res.json(updated);
  } catch (error) {
    console.error('State transition error:', error);
    return res.status(500).json({ error: 'Failed to transition subscription status.' });
  }
});

// M2 Task 2: Proration Preview Endpoint
app.post('/api/subscriptions/:id/proration-preview', requireAuth, async (req, res) => {
  try {
    const subId = Number(req.params.id);
    const { new_plan_id, remaining_days } = req.body;

    const subFound = await db.select().from(subscriptions).where(eq(subscriptions.id, subId));
    if (subFound.length === 0) {
      return res.status(404).json({ error: 'Subscription not found.' });
    }
    const sub = subFound[0];

    const currentPlanFound = await db.select().from(plans).where(eq(plans.id, sub.planId));
    const newPlanFound = await db.select().from(plans).where(eq(plans.id, Number(new_plan_id)));

    if (currentPlanFound.length === 0 || newPlanFound.length === 0) {
      return res.status(404).json({ error: 'Plan not found.' });
    }

    const currentPlan = currentPlanFound[0];
    const newPlan = newPlanFound[0];

    const proration = calculateProration({
      currentPlanPrice: currentPlan.price,
      newPlanPrice: newPlan.price,
      billingInterval: currentPlan.billingInterval,
      remainingDays: remaining_days !== undefined ? Number(remaining_days) : 15,
    });

    return res.json({
      currentPlan,
      newPlan,
      ...proration,
    });
  } catch (error) {
    console.error('Proration preview error:', error);
    return res.status(500).json({ error: 'Failed to calculate proration preview.' });
  }
});

// Task 8 & M2 Task 2: Change Plan with Proration & Adjustment Invoice
app.post('/api/subscriptions/:id/change-plan', requireAuth, async (req: AuthRequest, res) => {
  try {
    const subId = Number(req.params.id);
    const { new_plan_id, remaining_days } = req.body;

    const subFound = await db.select().from(subscriptions).where(eq(subscriptions.id, subId));
    if (subFound.length === 0) {
      return res.status(404).json({ error: 'Subscription not found.' });
    }
    const sub = subFound[0];

    const currentPlanFound = await db.select().from(plans).where(eq(plans.id, sub.planId));
    const newPlanFound = await db.select().from(plans).where(eq(plans.id, Number(new_plan_id)));
    if (currentPlanFound.length === 0 || newPlanFound.length === 0) {
      return res.status(404).json({ error: 'Plan not found.' });
    }

    const currentPlan = currentPlanFound[0];
    const newPlan = newPlanFound[0];

    const proration = calculateProration({
      currentPlanPrice: currentPlan.price,
      newPlanPrice: newPlan.price,
      billingInterval: currentPlan.billingInterval,
      remainingDays: remaining_days !== undefined ? Number(remaining_days) : 15,
    });

    const now = new Date();
    const [updatedSub] = await db
      .update(subscriptions)
      .set({
        planId: newPlan.id,
        status: sub.status === 'trial' ? 'active' : sub.status,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, subId))
      .returning();

    // Create Proration Adjustment Invoice if amountDue > 0
    let adjustmentInvoice = null;
    const subtotal = Math.max(0, proration.amountDue);
    const taxAmount = Math.round(subtotal * 0.18);
    const totalAmount = subtotal + taxAmount;
    const invNum = `INV-PRORATE-${Date.now().toString().slice(-5)}`;

    const [createdInv] = await db
      .insert(invoices)
      .values({
        invoiceNumber: invNum,
        subscriptionId: sub.id,
        customerId: sub.customerId,
        invoiceDate: now,
        dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        subtotal,
        taxAmount,
        totalAmount,
        status: subtotal === 0 ? 'paid' : 'unpaid',
        itemsJson: JSON.stringify([
          {
            description: `Unused ${currentPlan.name} Plan Credit (${proration.remainingDays} days remaining)`,
            amount: -proration.unusedCredit,
          },
          {
            description: `${newPlan.name} Plan Prorated Charge (${proration.remainingDays} days remaining)`,
            amount: proration.newPlanCharge,
          },
          {
            description: 'GST (18%)',
            amount: taxAmount,
          },
        ]),
      })
      .returning();
    adjustmentInvoice = createdInv;

    await logAudit({
      entityType: 'subscription',
      entityId: sub.id,
      customerId: sub.customerId,
      action: 'Plan Changed',
      oldValue: `${currentPlan.name} (₹${currentPlan.price})`,
      newValue: `${newPlan.name} (₹${newPlan.price}) • Adjustment ₹${proration.amountDue}`,
      performedBy: req.user?.name || 'Customer',
    });

    return res.json({
      subscription: updatedSub,
      proration,
      adjustmentInvoice,
    });
  } catch (error) {
    console.error('Change plan error:', error);
    return res.status(500).json({ error: 'Failed to change subscription plan.' });
  }
});

// Task 8: Pause Subscription
app.post('/api/subscriptions/:id/pause', requireAuth, async (req: AuthRequest, res) => {
  try {
    const subId = Number(req.params.id);
    const [updated] = await db
      .update(subscriptions)
      .set({ isPaused: true, updatedAt: new Date() })
      .where(eq(subscriptions.id, subId))
      .returning();

    if (!updated) return res.status(404).json({ error: 'Subscription not found.' });

    await logAudit({
      entityType: 'subscription',
      entityId: updated.id,
      customerId: updated.customerId,
      action: 'Subscription Paused',
      oldValue: 'Active (Unpaused)',
      newValue: 'Paused',
      performedBy: req.user?.name || 'System',
    });

    return res.json(updated);
  } catch (error) {
    console.error('Pause error:', error);
    return res.status(500).json({ error: 'Failed to pause subscription.' });
  }
});

// Task 8: Resume Subscription
app.post('/api/subscriptions/:id/resume', requireAuth, async (req: AuthRequest, res) => {
  try {
    const subId = Number(req.params.id);
    const [updated] = await db
      .update(subscriptions)
      .set({ isPaused: false, updatedAt: new Date() })
      .where(eq(subscriptions.id, subId))
      .returning();

    if (!updated) return res.status(404).json({ error: 'Subscription not found.' });

    await logAudit({
      entityType: 'subscription',
      entityId: updated.id,
      customerId: updated.customerId,
      action: 'Subscription Resumed',
      oldValue: 'Paused',
      newValue: 'Active (Resumed)',
      performedBy: req.user?.name || 'System',
    });

    return res.json(updated);
  } catch (error) {
    console.error('Resume error:', error);
    return res.status(500).json({ error: 'Failed to resume subscription.' });
  }
});

// Task 8: Cancel Subscription (enforcing state machine)
app.post('/api/subscriptions/:id/cancel', requireAuth, async (req: AuthRequest, res) => {
  try {
    const subId = Number(req.params.id);
    const found = await db.select().from(subscriptions).where(eq(subscriptions.id, subId));
    if (found.length === 0) return res.status(404).json({ error: 'Subscription not found.' });
    const sub = found[0];

    const check = validateStateTransition(sub.status, 'cancelled');
    if (!check.valid) {
      return res.status(400).json({ error: check.reason });
    }

    const now = new Date();
    const [updated] = await db
      .update(subscriptions)
      .set({
        status: 'cancelled',
        isPaused: false,
        statusChangedAt: now,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, subId))
      .returning();

    await logAudit({
      entityType: 'subscription',
      entityId: updated.id,
      customerId: updated.customerId,
      action: 'Subscription Cancelled',
      oldValue: sub.status,
      newValue: 'cancelled',
      performedBy: req.user?.name || 'System',
    });

    return res.json(updated);
  } catch (error) {
    console.error('Cancel subscription error:', error);
    return res.status(500).json({ error: 'Failed to cancel subscription.' });
  }
});

// M3 Task 3: Subscription Change History API
app.get('/api/subscriptions/:id/history', requireAuth, async (req, res) => {
  try {
    const subId = Number(req.params.id);
    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, subId))
      .orderBy(desc(auditLogs.createdAt));
    const subLogs = logs.filter((l) => l.entityType === 'subscription');
    return res.json(subLogs);
  } catch (error) {
    console.error('Subscription history error:', error);
    return res.status(500).json({ error: 'Failed to load subscription change history.' });
  }
});

// ============================================================================
// M2 TASK 1 & TASK 5: Invoice Generation, Tax Calculation & Listing
// ============================================================================
app.get('/api/invoices', requireAuth, async (req: AuthRequest, res) => {
  try {
    const scopedCustomerId = await resolveScopedCustomerId(req.user);
    const allInvoices = await db.select().from(invoices).orderBy(desc(invoices.invoiceDate));
    const visibleInvoices =
      scopedCustomerId !== null
        ? allInvoices.filter((inv) => inv.customerId === scopedCustomerId)
        : allInvoices;

    const allCustomers = await db.select().from(customers);
    const allSubs = await db.select().from(subscriptions);
    const allPlans = await db.select().from(plans);

    const custMap = new Map(allCustomers.map((c) => [c.id, c]));
    const subMap = new Map(allSubs.map((s) => [s.id, s]));
    const planMap = new Map(allPlans.map((p) => [p.id, p]));

    const enriched = visibleInvoices.map((inv) => {
      const sub = subMap.get(inv.subscriptionId);
      const plan = sub ? planMap.get(sub.planId) : null;
      return {
        ...inv,
        customer: custMap.get(inv.customerId) || null,
        planName: plan ? plan.name : 'Standard Plan',
        billingInterval: plan ? plan.billingInterval : 'monthly',
      };
    });

    return res.json(enriched);
  } catch (error) {
    console.error('List invoices error:', error);
    return res.status(500).json({ error: 'Failed to fetch invoices.' });
  }
});

app.get('/api/invoices/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const invId = Number(req.params.id);
    const scopedCustomerId = await resolveScopedCustomerId(req.user);
    const found = await db.select().from(invoices).where(eq(invoices.id, invId));
    if (found.length === 0) return res.status(404).json({ error: 'Invoice not found.' });
    const inv = found[0];
    if (scopedCustomerId !== null && inv.customerId !== scopedCustomerId) {
      return res.status(403).json({ error: 'Forbidden: You can only view your own invoices.' });
    }
    const cust = await db.select().from(customers).where(eq(customers.id, inv.customerId));
    const invPayments = await db.select().from(payments).where(eq(payments.invoiceId, inv.id));

    return res.json({
      ...inv,
      customer: cust[0] || null,
      payments: invPayments,
    });
  } catch (error) {
    console.error('Get invoice error:', error);
    return res.status(500).json({ error: 'Failed to fetch invoice details.' });
  }
});

app.post('/api/invoices/generate', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { subscription_id } = req.body || {};
    const scopedCustomerId = await resolveScopedCustomerId(req.user);
    const allSubs = await db.select().from(subscriptions);
    const allPlans = await db.select().from(plans);
    const planMap = new Map(allPlans.map((p) => [p.id, p]));

    let targetSubs = subscription_id
      ? allSubs.filter((s) => s.id === Number(subscription_id))
      : allSubs.filter((s) => s.status === 'active' && !s.isPaused);

    // If in Customer View, only generate invoices for this customer's subscriptions!
    if (scopedCustomerId !== null) {
      targetSubs = targetSubs.filter((s) => s.customerId === scopedCustomerId);
    }

    if (targetSubs.length === 0) {
      return res.status(400).json({ error: 'No eligible active subscriptions found for invoice generation.' });
    }

    const generated = [];
    const now = new Date();

    for (const sub of targetSubs) {
      const plan = planMap.get(sub.planId);
      if (!plan) continue;

      const subtotal = plan.price;
      const taxAmount = Math.round(subtotal * 0.18); // 18% GST calculation
      const totalAmount = subtotal + taxAmount;
      const invNumber = `INV-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

      const [created] = await db
        .insert(invoices)
        .values({
          invoiceNumber: invNumber,
          subscriptionId: sub.id,
          customerId: sub.customerId,
          invoiceDate: now,
          dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          subtotal,
          taxAmount,
          totalAmount,
          status: 'unpaid',
          itemsJson: JSON.stringify([
            {
              description: `${plan.name} Plan (${plan.billingInterval} billing cycle)`,
              amount: subtotal,
            },
            {
              description: 'GST (18%)',
              amount: taxAmount,
            },
          ]),
        })
        .returning();

      // Create next billing cycle record (Task 9)
      const { cycleStartDate, cycleEndDate, renewalDate } = calculateCycleDates(now, plan.billingInterval, 0);
      await db.insert(billingCycles).values({
        subscriptionId: sub.id,
        cycleStartDate,
        cycleEndDate,
        renewalDate,
        status: 'pending',
      });

      await logAudit({
        entityType: 'invoice',
        entityId: created.id,
        customerId: sub.customerId,
        action: 'Invoice Generated',
        oldValue: null,
        newValue: `${created.invoiceNumber} • Subtotal ₹${subtotal} + GST ₹${taxAmount} = ₹${totalAmount}`,
        performedBy: req.user?.name || 'Billing Engine',
      });

      generated.push(created);
    }

    return res.status(201).json({
      count: generated.length,
      invoices: generated,
    });
  } catch (error) {
    console.error('Invoice generation error:', error);
    return res.status(500).json({ error: 'Failed to generate invoices.' });
  }
});

// ============================================================================
// M2 TASK 3 & TASK 4: Mock Payment Gateway, Webhooks, Dunning Retry & Refunds
// ============================================================================
app.get('/api/payments', requireAuth, async (req: AuthRequest, res) => {
  try {
    const scopedCustomerId = await resolveScopedCustomerId(req.user);
    const allPayments = await db.select().from(payments).orderBy(desc(payments.paymentDate));
    const allInvoices = await db.select().from(invoices);
    const allCustomers = await db.select().from(customers);

    const invMap = new Map(allInvoices.map((i) => [i.id, i]));
    const custMap = new Map(allCustomers.map((c) => [c.id, c]));

    const visiblePayments =
      scopedCustomerId !== null
        ? allPayments.filter((p) => invMap.get(p.invoiceId)?.customerId === scopedCustomerId)
        : allPayments;

    const enriched = visiblePayments.map((p) => {
      const inv = invMap.get(p.invoiceId);
      const cust = inv ? custMap.get(inv.customerId) : null;
      return {
        ...p,
        invoiceNumber: inv ? inv.invoiceNumber : `INV-${p.invoiceId}`,
        subscriptionId: inv ? inv.subscriptionId : null,
        customerName: cust ? cust.name : 'Customer',
        companyName: cust ? cust.companyName : 'Enterprise',
      };
    });

    return res.json(enriched);
  } catch (error) {
    console.error('List payments error:', error);
    return res.status(500).json({ error: 'Failed to fetch payments.' });
  }
});

app.get('/api/payments/failed', requireAuth, async (req: AuthRequest, res) => {
  try {
    const scopedCustomerId = await resolveScopedCustomerId(req.user);
    const allPayments = await db.select().from(payments).orderBy(desc(payments.paymentDate));
    const failed = allPayments.filter((p) => p.status === 'failed');

    const allInvoices = await db.select().from(invoices);
    const allCustomers = await db.select().from(customers);
    const allSubs = await db.select().from(subscriptions);

    const invMap = new Map(allInvoices.map((i) => [i.id, i]));
    const custMap = new Map(allCustomers.map((c) => [c.id, c]));
    const subMap = new Map(allSubs.map((s) => [s.id, s]));

    const visibleFailed =
      scopedCustomerId !== null
        ? failed.filter((p) => invMap.get(p.invoiceId)?.customerId === scopedCustomerId)
        : failed;

    const enriched = visibleFailed.map((p) => {
      const inv = invMap.get(p.invoiceId);
      const cust = inv ? custMap.get(inv.customerId) : null;
      const sub = inv ? subMap.get(inv.subscriptionId) : null;
      return {
        ...p,
        invoiceNumber: inv ? inv.invoiceNumber : `INV-${p.invoiceId}`,
        invoiceStatus: inv ? inv.status : 'failed',
        customerName: cust ? cust.name : 'Unknown',
        companyName: cust ? cust.companyName : 'Unknown',
        subscriptionId: sub ? sub.id : null,
        subscriptionStatus: sub ? sub.status : 'past_due',
      };
    });

    return res.json(enriched);
  } catch (error) {
    console.error('Failed payments error:', error);
    return res.status(500).json({ error: 'Failed to load failed payment queue.' });
  }
});

// M2 Task 3: Process Payment (80% Success / 20% Failure or simulated override)
app.post('/api/payments/process', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { invoice_id, amount, payment_method, simulate_outcome } = req.body;
    if (!invoice_id) {
      return res.status(400).json({ error: 'invoice_id is required.' });
    }

    const invFound = await db.select().from(invoices).where(eq(invoices.id, Number(invoice_id)));
    if (invFound.length === 0) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }
    const inv = invFound[0];

    // 80% success / 20% failure unless explicitly specified for testing
    const isSuccess =
      simulate_outcome === 'success'
        ? true
        : simulate_outcome === 'failed'
        ? false
        : Math.random() < 0.8;

    const paymentStatus = isSuccess ? 'success' : 'failed';
    const txnRef = `TXN-${Math.floor(100000 + Math.random() * 900000)}`;
    const now = new Date();
    // Retry Schedule: Attempt 1 -> Day 1 (+1 day)
    const nextRetry = isSuccess ? null : new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

    const [paymentRecord] = await db
      .insert(payments)
      .values({
        invoiceId: inv.id,
        paymentReference: txnRef,
        amount: amount !== undefined ? Number(amount) : inv.totalAmount,
        paymentMethod: payment_method || 'Corporate Visa •••• 4242',
        status: paymentStatus,
        retryAttempt: isSuccess ? 0 : 1,
        nextRetryDate: nextRetry,
        paymentDate: now,
      })
      .returning();

    // Trigger Webhook Logic automatically
    const webhookEvent = isSuccess ? 'payment_success' : 'payment_failed';
    await handleWebhookEvent({
      event: webhookEvent,
      invoiceId: inv.id,
      paymentReference: txnRef,
      performedBy: req.user?.name || 'Mock Payment Gateway',
    });

    return res.json({
      payment: paymentRecord,
      webhookTriggered: webhookEvent,
      success: isSuccess,
    });
  } catch (error) {
    console.error('Process payment error:', error);
    return res.status(500).json({ error: 'Failed to process payment.' });
  }
});

async function handleWebhookEvent(params: {
  event: 'payment_success' | 'payment_failed' | 'payment_refunded';
  invoiceId: number;
  paymentReference?: string;
  performedBy?: string;
}) {
  const invFound = await db.select().from(invoices).where(eq(invoices.id, params.invoiceId));
  if (invFound.length === 0) return null;
  const inv = invFound[0];
  const now = new Date();

  if (params.event === 'payment_success') {
    await db
      .update(invoices)
      .set({ status: 'paid', updatedAt: now })
      .where(eq(invoices.id, inv.id));

    await db
      .update(subscriptions)
      .set({ status: 'active', statusChangedAt: now, updatedAt: now })
      .where(eq(subscriptions.id, inv.subscriptionId));

    await logAudit({
      entityType: 'payment',
      entityId: inv.id,
      customerId: inv.customerId,
      action: 'Payment Received (Webhook: payment_success)',
      oldValue: inv.status,
      newValue: `paid (${params.paymentReference || inv.invoiceNumber})`,
      performedBy: params.performedBy || 'Webhook Handler',
    });
  } else if (params.event === 'payment_failed') {
    await db
      .update(invoices)
      .set({ status: 'failed', updatedAt: now })
      .where(eq(invoices.id, inv.id));

    await db
      .update(subscriptions)
      .set({ status: 'past_due', statusChangedAt: now, updatedAt: now })
      .where(eq(subscriptions.id, inv.subscriptionId));

    await logAudit({
      entityType: 'payment',
      entityId: inv.id,
      customerId: inv.customerId,
      action: 'Payment Failed (Webhook: payment_failed)',
      oldValue: 'active',
      newValue: 'past_due • Queued for Dunning Retry',
      performedBy: params.performedBy || 'Webhook Handler',
    });
  } else if (params.event === 'payment_refunded') {
    await db
      .update(invoices)
      .set({ status: 'refunded', updatedAt: now })
      .where(eq(invoices.id, inv.id));

    await logAudit({
      entityType: 'refund',
      entityId: inv.id,
      customerId: inv.customerId,
      action: 'Payment Refunded (Webhook: payment_refunded)',
      oldValue: inv.status,
      newValue: 'refunded',
      performedBy: params.performedBy || 'Webhook Handler',
    });
  }
  return inv;
}

// M2 Task 3: Direct Webhook Endpoint
app.post('/api/webhooks/payment', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { event, invoice_id } = req.body;
    if (!event || !invoice_id) {
      return res.status(400).json({ error: 'event and invoice_id are required.' });
    }
    const result = await handleWebhookEvent({
      event,
      invoiceId: Number(invoice_id),
      performedBy: req.user?.name || 'Webhook Simulator',
    });
    if (!result) return res.status(404).json({ error: 'Invoice not found.' });
    return res.json({ status: 'processed', event, invoice_id });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Failed to process payment webhook.' });
  }
});

// M2 Task 4: Failed Payment Retry Engine (Attempt 1 -> Day 1, Attempt 2 -> Day 3, Attempt 3 -> Day 7, Exhausted -> Cancelled)
app.post('/api/payments/:id/retry', requireAuth, async (req: AuthRequest, res) => {
  try {
    const paymentId = Number(req.params.id);
    const { simulate_outcome } = req.body || {};

    const found = await db.select().from(payments).where(eq(payments.id, paymentId));
    if (found.length === 0) return res.status(404).json({ error: 'Payment not found.' });
    const payment = found[0];

    const invFound = await db.select().from(invoices).where(eq(invoices.id, payment.invoiceId));
    const inv = invFound[0];

    const isSuccess =
      simulate_outcome === 'failed'
        ? false
        : simulate_outcome === 'success'
        ? true
        : Math.random() < 0.75;

    const now = new Date();

    if (isSuccess) {
      const [updatedPay] = await db
        .update(payments)
        .set({
          status: 'success',
          nextRetryDate: null,
          paymentDate: now,
          updatedAt: now,
        })
        .where(eq(payments.id, paymentId))
        .returning();

      if (inv) {
        await db.update(invoices).set({ status: 'paid', updatedAt: now }).where(eq(invoices.id, inv.id));
        await db
          .update(subscriptions)
          .set({ status: 'active', statusChangedAt: now, updatedAt: now })
          .where(eq(subscriptions.id, inv.subscriptionId));

        await logAudit({
          entityType: 'payment',
          entityId: payment.id,
          customerId: inv.customerId,
          action: `Retry Attempt #${payment.retryAttempt + 1} Succeeded`,
          oldValue: 'past_due',
          newValue: 'active (Invoice Paid)',
          performedBy: req.user?.name || 'Dunning Retry Service',
        });
      }

      return res.json({
        payment: updatedPay,
        subscriptionStatus: 'active',
        outcome: 'recovered',
      });
    } else {
      const nextAttempt = payment.retryAttempt + 1;
      // Schedule: Attempt 1 -> Day 1, Attempt 2 -> Day 3, Attempt 3 -> Day 7
      const daysOffset = nextAttempt === 1 ? 1 : nextAttempt === 2 ? 3 : 7;
      const exhausted = nextAttempt >= 3;
      const nextRetryDate = exhausted ? null : new Date(now.getTime() + daysOffset * 24 * 60 * 60 * 1000);

      const [updatedPay] = await db
        .update(payments)
        .set({
          retryAttempt: nextAttempt,
          nextRetryDate,
          updatedAt: now,
        })
        .where(eq(payments.id, paymentId))
        .returning();

      let newSubStatus = 'past_due';
      if (inv && exhausted) {
        newSubStatus = 'cancelled';
        await db
          .update(subscriptions)
          .set({ status: 'cancelled', statusChangedAt: now, updatedAt: now })
          .where(eq(subscriptions.id, inv.subscriptionId));

        await logAudit({
          entityType: 'subscription',
          entityId: inv.subscriptionId,
          customerId: inv.customerId,
          action: 'All 3 Payment Retries Exhausted → Cancelled',
          oldValue: 'past_due',
          newValue: 'cancelled',
          performedBy: 'Dunning Retry Service',
        });
      } else if (inv) {
        await logAudit({
          entityType: 'payment',
          entityId: payment.id,
          customerId: inv.customerId,
          action: `Retry Attempt #${nextAttempt} Failed`,
          oldValue: `Attempt ${payment.retryAttempt}`,
          newValue: `Scheduled Day ${daysOffset} Retry`,
          performedBy: 'Dunning Retry Service',
        });
      }

      return res.json({
        payment: updatedPay,
        subscriptionStatus: newSubStatus,
        outcome: exhausted ? 'exhausted_cancelled' : 'rescheduled',
      });
    }
  } catch (error) {
    console.error('Retry payment error:', error);
    return res.status(500).json({ error: 'Failed to retry payment.' });
  }
});

// M2 Task 4 & M3 Task 2: Refund Management APIs
app.get('/api/refunds', requireAuth, async (req: AuthRequest, res) => {
  try {
    const scopedCustomerId = await resolveScopedCustomerId(req.user);
    const allRefunds = await db.select().from(refunds).orderBy(desc(refunds.refundDate));
    const visibleRefunds =
      scopedCustomerId !== null
        ? allRefunds.filter((r) => r.customerId === scopedCustomerId)
        : allRefunds;

    const allCustomers = await db.select().from(customers);
    const allInvoices = await db.select().from(invoices);

    const custMap = new Map(allCustomers.map((c) => [c.id, c]));
    const invMap = new Map(allInvoices.map((i) => [i.id, i]));

    const enriched = visibleRefunds.map((r) => {
      const cust = custMap.get(r.customerId);
      const inv = invMap.get(r.invoiceId);
      return {
        ...r,
        customerName: cust ? cust.name : 'Customer',
        companyName: cust ? cust.companyName : 'Enterprise',
        invoiceNumber: inv ? inv.invoiceNumber : `INV-${r.invoiceId}`,
      };
    });

    return res.json(enriched);
  } catch (error) {
    console.error('List refunds error:', error);
    return res.status(500).json({ error: 'Failed to load refund history.' });
  }
});

app.post('/api/refunds', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { invoice_id, used_days, reason } = req.body;
    if (!invoice_id) {
      return res.status(400).json({ error: 'invoice_id is required.' });
    }

    const invFound = await db.select().from(invoices).where(eq(invoices.id, Number(invoice_id)));
    if (invFound.length === 0) {
      return res.status(404).json({ error: 'Invoice not found.' });
    }
    const inv = invFound[0];

    const usedDaysNum = used_days !== undefined ? Math.max(0, Math.min(30, Number(used_days))) : 10;
    const remainingDaysNum = 30 - usedDaysNum;
    const paidBase = inv.subtotal || inv.totalAmount;
    const refundAmount = Math.floor((paidBase * remainingDaysNum) / 30);

    const allRefunds = await db.select().from(refunds);
    const refundNumber = `RF${String(allRefunds.length + 1).padStart(3, '0')}`;
    const now = new Date();

    const invPayments = await db.select().from(payments).where(eq(payments.invoiceId, inv.id));
    const primaryPayment = invPayments[0];

    const [createdRefund] = await db
      .insert(refunds)
      .values({
        refundNumber,
        paymentId: primaryPayment ? primaryPayment.id : null,
        invoiceId: inv.id,
        customerId: inv.customerId,
        paidAmount: paidBase,
        amount: refundAmount,
        usedDays: usedDaysNum,
        remainingDays: remainingDaysNum,
        reason: reason || `Prorated refund (${usedDaysNum} days used, ${remainingDaysNum} days remaining)`,
        status: 'completed',
        refundDate: now,
      })
      .returning();

    await db.update(invoices).set({ status: 'refunded', updatedAt: now }).where(eq(invoices.id, inv.id));
    if (primaryPayment) {
      await db
        .update(payments)
        .set({ status: 'refunded', updatedAt: now })
        .where(eq(payments.id, primaryPayment.id));
    }

    // Cancel subscription if still active
    await db
      .update(subscriptions)
      .set({ status: 'cancelled', statusChangedAt: now, updatedAt: now })
      .where(eq(subscriptions.id, inv.subscriptionId));

    await logAudit({
      entityType: 'refund',
      entityId: createdRefund.id,
      customerId: inv.customerId,
      action: 'Refund Issued',
      oldValue: `Paid ₹${paidBase}`,
      newValue: `${refundNumber} • ₹${refundAmount} (${remainingDaysNum} unused days)`,
      performedBy: req.user?.name || 'Admin',
    });

    return res.status(201).json(createdRefund);
  } catch (error) {
    console.error('Issue refund error:', error);
    return res.status(500).json({ error: 'Failed to issue refund.' });
  }
});

// ============================================================================
// M3 TASK 1: Admin Dashboard & Subscription Metrics (Strictly Admin Only!)
// ============================================================================
app.get('/api/dashboard/summary', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const allCustomers = await db.select().from(customers);
    const allSubs = await db.select().from(subscriptions);
    const allPlans = await db.select().from(plans);
    const planMap = new Map(allPlans.map((p) => [p.id, p]));

    const activeSubs = allSubs.filter((s) => s.status === 'active');
    const cancelledSubs = allSubs.filter((s) => s.status === 'cancelled');

    const mrr = activeSubs.reduce((sum, sub) => {
      const plan = planMap.get(sub.planId);
      if (!plan) return sum;
      return sum + (plan.billingInterval === 'annual' ? Math.round(plan.price / 12) : plan.price);
    }, 0);

    return res.json({
      total_customers: allCustomers.length,
      active_subscriptions: activeSubs.length,
      cancelled_subscriptions: cancelledSubs.length,
      mrr,
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    return res.status(500).json({ error: 'Failed to calculate dashboard summary.' });
  }
});

app.get('/api/dashboard/revenue-by-plan', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const allPlans = await db.select().from(plans).orderBy(plans.price);
    const allSubs = await db.select().from(subscriptions);

    const revenueByPlan = allPlans.map((plan) => {
      const matchingSubs = allSubs.filter(
        (s) => s.planId === plan.id && (s.status === 'active' || s.status === 'past_due')
      );
      const revenue = matchingSubs.reduce((sum) => sum + plan.price, 0);
      return {
        plan: plan.name,
        revenue,
        subscribers: matchingSubs.length,
        price: plan.price,
      };
    });

    return res.json(revenueByPlan);
  } catch (error) {
    console.error('Revenue by plan error:', error);
    return res.status(500).json({ error: 'Failed to calculate revenue by plan.' });
  }
});

app.get('/api/dashboard/subscription-metrics', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const allSubs = await db.select().from(subscriptions);
    const totalSubs = allSubs.length || 1;

    const activeCount = allSubs.filter((s) => s.status === 'active').length;
    const trialCount = allSubs.filter((s) => s.status === 'trial').length;
    const pastDueCount = allSubs.filter((s) => s.status === 'past_due').length;
    const cancelledCount = allSubs.filter((s) => s.status === 'cancelled').length;

    const churnRate = Number(((cancelledCount / totalSubs) * 100).toFixed(1));

    const totalTrialsEver = allSubs.filter((s) => s.hadTrial).length || 1;
    const convertedTrials = allSubs.filter((s) => s.hadTrial && s.status === 'active').length;
    const trialConversionRate = Number(((convertedTrials / totalTrialsEver) * 100).toFixed(1));

    return res.json({
      active: activeCount,
      trial: trialCount,
      past_due: pastDueCount,
      cancelled: cancelledCount,
      total: allSubs.length,
      churn_rate: churnRate,
      trial_conversion_rate: trialConversionRate,
      status_breakdown: [
        { name: 'Active', value: activeCount },
        { name: 'Trial', value: trialCount },
        { name: 'Past Due', value: pastDueCount },
        { name: 'Cancelled', value: cancelledCount },
      ],
    });
  } catch (error) {
    console.error('Subscription metrics error:', error);
    return res.status(500).json({ error: 'Failed to calculate subscription metrics.' });
  }
});

// ============================================================================
// M1 TASK 10 & M3 TASK 3: Audit Log Viewer API
// ============================================================================
app.get('/api/audit-logs', requireAuth, async (req: AuthRequest, res) => {
  try {
    const scopedCustomerId = await resolveScopedCustomerId(req.user);
    const { entity_type, customer_id, action } = req.query;
    let logs = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt));

    if (scopedCustomerId !== null) {
      logs = logs.filter((l) => l.customerId === scopedCustomerId);
    } else if (customer_id && customer_id !== 'all') {
      logs = logs.filter((l) => l.customerId === Number(customer_id));
    }

    if (entity_type && entity_type !== 'all') {
      logs = logs.filter((l) => l.entityType === String(entity_type));
    }
    if (action) {
      const q = String(action).toLowerCase();
      logs = logs.filter(
        (l) =>
          l.action.toLowerCase().includes(q) ||
          (l.newValue && l.newValue.toLowerCase().includes(q)) ||
          l.performedBy.toLowerCase().includes(q)
      );
    }

    const allCustomers = await db.select().from(customers);
    const custMap = new Map(allCustomers.map((c) => [c.id, c]));

    const enriched = logs.map((l) => ({
      ...l,
      customerName: l.customerId ? custMap.get(l.customerId)?.companyName || 'Customer' : 'Global',
    }));

    return res.json(enriched);
  } catch (error) {
    console.error('Audit logs error:', error);
    return res.status(500).json({ error: 'Failed to fetch audit logs.' });
  }
});

// ============================================================================
// Vite Middleware / Static Production Serving
// ============================================================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SubOps Billing & Subscription Engine running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
