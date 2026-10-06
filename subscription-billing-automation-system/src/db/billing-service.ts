import { db } from './index.ts';
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
} from './schema.ts';
import { eq, desc } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

// Task 4: Subscription Status State Machine
export type SubscriptionState = 'trial' | 'active' | 'past_due' | 'cancelled';

export const VALID_TRANSITIONS: Record<SubscriptionState, SubscriptionState[]> = {
  trial: ['active', 'cancelled'],
  active: ['past_due', 'cancelled'],
  past_due: ['active', 'cancelled'],
  cancelled: [],
};

export function validateStateTransition(current: string, next: string): { valid: boolean; reason?: string } {
  if (current === next) {
    return { valid: true };
  }
  const allowed = VALID_TRANSITIONS[current as SubscriptionState] || [];
  if (!allowed.includes(next as SubscriptionState)) {
    return {
      valid: false,
      reason: `Invalid state transition from '${current}' to '${next}'. Allowed transitions from '${current}': [${allowed.join(', ') || 'none'}].`,
    };
  }
  return { valid: true };
}

// Task 10: Audit Logging Helper
export async function logAudit(params: {
  entityType: 'plan' | 'customer' | 'subscription' | 'invoice' | 'payment' | 'refund';
  entityId: number;
  customerId?: number | null;
  action: string;
  oldValue?: string | null;
  newValue?: string | null;
  performedBy?: string;
}) {
  try {
    const [entry] = await db
      .insert(auditLogs)
      .values({
        entityType: params.entityType,
        entityId: params.entityId,
        customerId: params.customerId ?? null,
        action: params.action,
        oldValue: params.oldValue ?? null,
        newValue: params.newValue ?? null,
        performedBy: params.performedBy || 'System',
      })
      .returning();
    return entry;
  } catch (error) {
    console.error('Audit log creation failed:', error);
    throw new Error('Failed to record audit log.', { cause: error });
  }
}

// Task 9: Billing Cycle Engine Calculation Service
export function calculateCycleDates(startDate: Date, interval: string, trialDays: number = 0) {
  const cycleStart = new Date(startDate);
  const cycleEnd = new Date(cycleStart);
  if (trialDays > 0) {
    cycleEnd.setDate(cycleEnd.getDate() + trialDays);
  } else if (interval === 'annual') {
    cycleEnd.setFullYear(cycleEnd.getFullYear() + 1);
  } else {
    cycleEnd.setDate(cycleEnd.getDate() + 30);
  }
  const renewalDate = new Date(cycleEnd);
  return { cycleStartDate: cycleStart, cycleEndDate: cycleEnd, renewalDate };
}

// Milestone 2 Task 2: Proration & Plan Change Calculation
export function calculateProration(params: {
  currentPlanPrice: number;
  newPlanPrice: number;
  billingInterval: string;
  remainingDays?: number;
}) {
  const totalDays = params.billingInterval === 'annual' ? 365 : 30;
  const remainingDays =
    params.remainingDays !== undefined
      ? Math.max(1, Math.min(totalDays, params.remainingDays))
      : 15; // Default 15 days for clear demonstration matching specification example

  const unusedCredit = Math.round((params.currentPlanPrice / totalDays) * remainingDays);
  const newPlanCharge = Math.round((params.newPlanPrice / totalDays) * remainingDays);
  const amountDue = newPlanCharge - unusedCredit;

  return {
    totalDays,
    remainingDays,
    unusedCredit,
    newPlanCharge,
    amountDue,
  };
}

// Seed Database if Empty so Dashboard, Plans, Customers, Invoices, Failed Payments, Refunds & Audit Logs work immediately
export async function ensureSeededDatabase() {
  try {
    const existingPlans = await db.select().from(plans);
    if (existingPlans.length > 0) {
      return;
    }

    console.log('Seeding initial billing & subscription engine data...');

    const adminHash = await bcrypt.hash('admin123', 10);
    const customerHash = await bcrypt.hash('customer123', 10);

    // 1. Seed Users
    const [adminUser] = await db
      .insert(users)
      .values({
        uid: 'admin-seed-uid-001',
        email: 'admin@subbill.com',
        name: 'Aarav Mehta (Admin)',
        passwordHash: adminHash,
        role: 'admin',
      })
      .returning();

    const [customerUser] = await db
      .insert(users)
      .values({
        uid: 'cust-seed-uid-002',
        email: 'billing@abc-corp.in',
        name: 'Riya Sharma',
        passwordHash: customerHash,
        role: 'customer',
      })
      .returning();

    // 2. Seed Plans (Basic ₹499, Pro ₹1000, Premium ₹2000, Enterprise ₹4999)
    const insertedPlans = await db
      .insert(plans)
      .values([
        {
          name: 'Basic',
          price: 500,
          billingInterval: 'monthly',
          trialDays: 14,
          targetAudience: 'For early-stage startups & solo founders',
          features: JSON.stringify([
            'Up to 100 active subscribers',
            'Automated GST invoice generation',
            'Standard email webhook alerts',
            'Basic audit log retention (30 days)',
          ]),
          isArchived: false,
        },
        {
          name: 'Pro',
          price: 1000,
          billingInterval: 'monthly',
          trialDays: 14,
          targetAudience: 'For scaling SaaS operations',
          features: JSON.stringify([
            'Up to 2,500 active subscribers',
            'Mid-cycle proration & credit engine',
            'Automated 3-step dunning retry queue',
            'Full audit log & timeline tracking',
          ]),
          isArchived: false,
        },
        {
          name: 'Premium',
          price: 2000,
          billingInterval: 'monthly',
          trialDays: 14,
          targetAudience: 'For high-velocity growth teams',
          features: JSON.stringify([
            'Up to 15,000 active subscribers',
            'Real-time webhook event simulator',
            'Instant prorated refund calculation',
            'Priority SLA & custom tax rules',
          ]),
          isArchived: false,
        },
        {
          name: 'Enterprise',
          price: 5000,
          billingInterval: 'annual',
          trialDays: 30,
          targetAudience: 'For multi-entity enterprise finance',
          features: JSON.stringify([
            'Unlimited subscribers & custom contracts',
            'Dedicated billing cycle engine',
            'Multi-currency & GST/VAT tax compliance',
            'Immutable compliance audit exports',
          ]),
          isArchived: false,
        },
      ])
      .returning();

    const [basicPlan, proPlan, premiumPlan, enterprisePlan] = insertedPlans;

    // 3. Seed Customers
    const insertedCustomers = await db
      .insert(customers)
      .values([
        {
          name: 'Riya Sharma',
          email: 'billing@abc-corp.in',
          companyName: 'ABC Technologies Pvt Ltd',
          userId: customerUser.id,
        },
        {
          name: 'Vikramjit Nair',
          email: 'finance@xyz-cloud.io',
          companyName: 'XYZ Cloud Systems',
        },
        {
          name: 'Ananya Deshmukh',
          email: 'ops@kinetix-ai.com',
          companyName: 'Kinetix Data Labs',
        },
        {
          name: 'Siddharth Verma',
          email: 'accounts@vanguard-fin.in',
          companyName: 'Vanguard FinTech Corp',
        },
        {
          name: 'Meera Krishnan',
          email: 'meera@lumina-health.org',
          companyName: 'Lumina Health Analytics',
        },
        {
          name: 'Kabir Malhotra',
          email: 'kabir@zephyr-logistics.in',
          companyName: 'Zephyr Supply Chain',
        },
      ])
      .returning();

    const [custAbc, custXyz, custKinetix, custVanguard, custLumina, custZephyr] = insertedCustomers;

    const now = new Date();
    const jul1 = new Date(now.getFullYear(), 6, 1);
    const jul15 = new Date(now.getFullYear(), 6, 15);
    const aug1 = new Date(now.getFullYear(), 7, 1);
    const aug2 = new Date(now.getFullYear(), 7, 2);
    const nextMonth = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);

    // 4. Seed Subscriptions across states (active, trial, past_due, cancelled)
    const insertedSubs = await db
      .insert(subscriptions)
      .values([
        {
          customerId: custAbc.id,
          planId: proPlan.id,
          status: 'active',
          isPaused: false,
          hadTrial: true,
          startDate: jul1,
          endDate: nextMonth,
          statusChangedAt: jul15,
        },
        {
          customerId: custXyz.id,
          planId: premiumPlan.id,
          status: 'past_due',
          isPaused: false,
          hadTrial: true,
          startDate: jul15,
          endDate: nextMonth,
          statusChangedAt: aug1,
        },
        {
          customerId: custKinetix.id,
          planId: enterprisePlan.id,
          status: 'active',
          isPaused: false,
          hadTrial: true,
          startDate: jul1,
          endDate: new Date(now.getTime() + 300 * 24 * 60 * 60 * 1000),
          statusChangedAt: jul1,
        },
        {
          customerId: custVanguard.id,
          planId: proPlan.id,
          status: 'trial',
          isPaused: false,
          hadTrial: true,
          startDate: now,
          endDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
          statusChangedAt: now,
        },
        {
          customerId: custLumina.id,
          planId: basicPlan.id,
          status: 'active',
          isPaused: false,
          hadTrial: false,
          startDate: jul1,
          endDate: nextMonth,
          statusChangedAt: jul1,
        },
        {
          customerId: custZephyr.id,
          planId: proPlan.id,
          status: 'cancelled',
          isPaused: false,
          hadTrial: true,
          startDate: jul1,
          endDate: aug1,
          statusChangedAt: aug2,
        },
      ])
      .returning();

    const [subAbc, subXyz, subKinetix, subVanguard, subLumina, subZephyr] = insertedSubs;

    // 5. Seed Billing Cycles
    await db.insert(billingCycles).values([
      {
        subscriptionId: subAbc.id,
        cycleStartDate: jul1,
        cycleEndDate: aug1,
        renewalDate: aug1,
        status: 'completed',
      },
      {
        subscriptionId: subAbc.id,
        cycleStartDate: aug1,
        cycleEndDate: nextMonth,
        renewalDate: nextMonth,
        status: 'pending',
      },
      {
        subscriptionId: subXyz.id,
        cycleStartDate: jul15,
        cycleEndDate: nextMonth,
        renewalDate: nextMonth,
        status: 'pending',
      },
      {
        subscriptionId: subKinetix.id,
        cycleStartDate: jul1,
        cycleEndDate: new Date(now.getTime() + 300 * 24 * 60 * 60 * 1000),
        renewalDate: new Date(now.getTime() + 300 * 24 * 60 * 60 * 1000),
        status: 'pending',
      },
    ]);

    // 6. Seed Invoices (Paid, Unpaid, Failed, Refunded)
    const insertedInvoices = await db
      .insert(invoices)
      .values([
        {
          invoiceNumber: 'INV-2026-001',
          subscriptionId: subAbc.id,
          customerId: custAbc.id,
          invoiceDate: aug1,
          dueDate: new Date(aug1.getTime() + 7 * 24 * 60 * 60 * 1000),
          subtotal: 1000,
          taxAmount: 180,
          totalAmount: 1180,
          status: 'paid',
          itemsJson: JSON.stringify([
            { description: 'Pro Plan - Monthly Subscription', amount: 1000 },
            { description: 'GST (18%)', amount: 180 },
          ]),
        },
        {
          invoiceNumber: 'INV-2026-002',
          subscriptionId: subXyz.id,
          customerId: custXyz.id,
          invoiceDate: aug1,
          dueDate: new Date(aug1.getTime() + 7 * 24 * 60 * 60 * 1000),
          subtotal: 2000,
          taxAmount: 360,
          totalAmount: 2360,
          status: 'failed',
          itemsJson: JSON.stringify([
            { description: 'Premium Plan - Monthly Subscription', amount: 2000 },
            { description: 'GST (18%)', amount: 360 },
          ]),
        },
        {
          invoiceNumber: 'INV-2026-003',
          subscriptionId: subKinetix.id,
          customerId: custKinetix.id,
          invoiceDate: jul1,
          dueDate: new Date(jul1.getTime() + 7 * 24 * 60 * 60 * 1000),
          subtotal: 5000,
          taxAmount: 900,
          totalAmount: 5900,
          status: 'paid',
          itemsJson: JSON.stringify([
            { description: 'Enterprise Plan - Annual Subscription', amount: 5000 },
            { description: 'GST (18%)', amount: 900 },
          ]),
        },
        {
          invoiceNumber: 'INV-2026-004',
          subscriptionId: subLumina.id,
          customerId: custLumina.id,
          invoiceDate: now,
          dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          subtotal: 500,
          taxAmount: 90,
          totalAmount: 590,
          status: 'unpaid',
          itemsJson: JSON.stringify([
            { description: 'Basic Plan - Monthly Subscription', amount: 500 },
            { description: 'GST (18%)', amount: 90 },
          ]),
        },
        {
          invoiceNumber: 'INV-2026-005',
          subscriptionId: subZephyr.id,
          customerId: custZephyr.id,
          invoiceDate: jul1,
          dueDate: new Date(jul1.getTime() + 7 * 24 * 60 * 60 * 1000),
          subtotal: 1000,
          taxAmount: 180,
          totalAmount: 1180,
          status: 'refunded',
          itemsJson: JSON.stringify([
            { description: 'Pro Plan - Monthly Subscription (Cancelled Early)', amount: 1000 },
            { description: 'GST (18%)', amount: 180 },
          ]),
        },
      ])
      .returning();

    const [inv1, inv2, inv3, _inv4, inv5] = insertedInvoices;

    // 7. Seed Payments (Success, Failed in Retry Queue, Refunded)
    const retryDateAug10 = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const insertedPayments = await db
      .insert(payments)
      .values([
        {
          invoiceId: inv1.id,
          paymentReference: 'TXN-982341',
          amount: 1180,
          paymentMethod: 'HDFC Corporate Card •••• 4242',
          status: 'success',
          retryAttempt: 0,
          paymentDate: aug2,
        },
        {
          invoiceId: inv2.id,
          paymentReference: 'TXN-982399',
          amount: 2360,
          paymentMethod: 'ICICI Visa •••• 8819',
          status: 'failed',
          retryAttempt: 2, // Attempt 2 (Day 3 -> Day 7 schedule)
          nextRetryDate: retryDateAug10,
          paymentDate: aug2,
        },
        {
          invoiceId: inv3.id,
          paymentReference: 'TXN-981104',
          amount: 5900,
          paymentMethod: 'NEFT / Enterprise Wire',
          status: 'success',
          retryAttempt: 0,
          paymentDate: jul1,
        },
        {
          invoiceId: inv5.id,
          paymentReference: 'TXN-980552',
          amount: 1000,
          paymentMethod: 'Axis MasterCard •••• 1029',
          status: 'refunded',
          retryAttempt: 0,
          paymentDate: jul1,
        },
      ])
      .returning();

    const [_pay1, _pay2, _pay3, pay4] = insertedPayments;

    // 8. Seed Refunds (Example: Monthly Plan ₹1000, Used 10 days, Remaining 20 days -> Refund ₹666)
    await db.insert(refunds).values([
      {
        refundNumber: 'RF001',
        paymentId: pay4.id,
        invoiceId: inv5.id,
        customerId: custZephyr.id,
        paidAmount: 1000,
        amount: 666,
        usedDays: 10,
        remainingDays: 20,
        reason: 'Customer cancelled subscription after 10 days (20 unused days prorated)',
        status: 'completed',
        refundDate: aug2,
      },
    ]);

    // 9. Seed Audit Logs (Chronological events for M1, M2, M3)
    await db.insert(auditLogs).values([
      {
        entityType: 'plan',
        entityId: proPlan.id,
        action: 'Plan Created',
        oldValue: null,
        newValue: 'Pro Plan (₹1,000/monthly)',
        performedBy: adminUser.name,
        createdAt: jul1,
      },
      {
        entityType: 'customer',
        entityId: custAbc.id,
        customerId: custAbc.id,
        action: 'Customer Created',
        oldValue: null,
        newValue: 'ABC Technologies Pvt Ltd (billing@abc-corp.in)',
        performedBy: 'System',
        createdAt: jul1,
      },
      {
        entityType: 'subscription',
        entityId: subAbc.id,
        customerId: custAbc.id,
        action: 'Subscription Created',
        oldValue: 'none',
        newValue: 'Basic → Trial Started',
        performedBy: 'Riya Sharma',
        createdAt: jul1,
      },
      {
        entityType: 'subscription',
        entityId: subAbc.id,
        customerId: custAbc.id,
        action: 'Plan Changed',
        oldValue: 'Basic',
        newValue: 'Pro (Proration Adjustment ₹500)',
        performedBy: 'Riya Sharma',
        createdAt: jul15,
      },
      {
        entityType: 'invoice',
        entityId: inv1.id,
        customerId: custAbc.id,
        action: 'Invoice Generated',
        oldValue: 'draft',
        newValue: 'INV-2026-001 (₹1,180 incl. GST)',
        performedBy: 'Billing Engine',
        createdAt: aug1,
      },
      {
        entityType: 'payment',
        entityId: inv1.id,
        customerId: custAbc.id,
        action: 'Payment Received',
        oldValue: 'unpaid',
        newValue: 'paid (TXN-982341 • ₹1,180)',
        performedBy: 'Webhook Processor',
        createdAt: aug2,
      },
      {
        entityType: 'payment',
        entityId: inv2.id,
        customerId: custXyz.id,
        action: 'Payment Failed',
        oldValue: 'active',
        newValue: 'past_due (Attempt 2 • Next Retry Scheduled)',
        performedBy: 'Dunning Engine',
        createdAt: aug2,
      },
      {
        entityType: 'refund',
        entityId: inv5.id,
        customerId: custZephyr.id,
        action: 'Refund Issued',
        oldValue: 'Paid ₹1,000',
        newValue: 'RF001 • Refunded ₹666 (20 days unused)',
        performedBy: adminUser.name,
        createdAt: aug2,
      },
    ]);

    console.log('Seed data initialized successfully.');
  } catch (error) {
    console.error('Error seeding database:', error);
  }
}

export async function getAllPlans(includeArchived = false) {
  try {
    const all = await db.select().from(plans).orderBy(plans.price);
    return includeArchived ? all : all.filter((p) => !p.isArchived);
  } catch (error) {
    console.error('Failed to query plans:', error);
    throw new Error('Database query failed while loading plans.', { cause: error });
  }
}

export async function getAllCustomers() {
  try {
    return await db.select().from(customers).orderBy(desc(customers.createdAt));
  } catch (error) {
    console.error('Failed to query customers:', error);
    throw new Error('Database query failed while loading customers.', { cause: error });
  }
}
