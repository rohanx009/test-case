import { relations } from 'drizzle-orm';
import { boolean, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash'),
  role: text('role').notNull().default('customer'), // 'admin' | 'customer'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const plans = pgTable('plans', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  price: integer('price').notNull(), // e.g. ₹1000
  billingInterval: text('billing_interval').notNull().default('monthly'), // 'monthly' | 'annual'
  trialDays: integer('trial_days').notNull().default(14),
  features: text('features').notNull(), // JSON string array or comma-separated
  targetAudience: text('target_audience').notNull().default('For growing SaaS teams'),
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const customers = pgTable('customers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  companyName: text('company_name').notNull(),
  userId: integer('user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const subscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').references(() => customers.id).notNull(),
  planId: integer('plan_id').references(() => plans.id).notNull(),
  status: text('status').notNull().default('trial'), // 'trial' | 'active' | 'past_due' | 'cancelled'
  isPaused: boolean('is_paused').notNull().default(false),
  hadTrial: boolean('had_trial').notNull().default(true),
  startDate: timestamp('start_date').defaultNow().notNull(),
  endDate: timestamp('end_date').notNull(),
  statusChangedAt: timestamp('status_changed_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const billingCycles = pgTable('billing_cycles', {
  id: serial('id').primaryKey(),
  subscriptionId: integer('subscription_id').references(() => subscriptions.id).notNull(),
  cycleStartDate: timestamp('cycle_start_date').notNull(),
  cycleEndDate: timestamp('cycle_end_date').notNull(),
  renewalDate: timestamp('renewal_date').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'completed'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const invoices = pgTable('invoices', {
  id: serial('id').primaryKey(),
  invoiceNumber: text('invoice_number').notNull().unique(),
  subscriptionId: integer('subscription_id').references(() => subscriptions.id).notNull(),
  customerId: integer('customer_id').references(() => customers.id).notNull(),
  invoiceDate: timestamp('invoice_date').defaultNow().notNull(),
  dueDate: timestamp('due_date').notNull(),
  subtotal: integer('subtotal').notNull(),
  taxAmount: integer('tax_amount').notNull(),
  totalAmount: integer('total_amount').notNull(),
  status: text('status').notNull().default('unpaid'), // 'draft' | 'paid' | 'unpaid' | 'failed' | 'refunded' | 'void'
  itemsJson: text('items_json').notNull().default('[]'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  invoiceId: integer('invoice_id').references(() => invoices.id).notNull(),
  paymentReference: text('payment_reference').notNull(),
  amount: integer('amount').notNull(),
  paymentMethod: text('payment_method').notNull().default('Card •••• 4242'),
  status: text('status').notNull().default('pending'), // 'pending' | 'success' | 'failed' | 'refunded'
  retryAttempt: integer('retry_attempt').notNull().default(0),
  nextRetryDate: timestamp('next_retry_date'),
  paymentDate: timestamp('payment_date').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const refunds = pgTable('refunds', {
  id: serial('id').primaryKey(),
  refundNumber: text('refund_number').notNull().unique(),
  paymentId: integer('payment_id').references(() => payments.id),
  invoiceId: integer('invoice_id').references(() => invoices.id).notNull(),
  customerId: integer('customer_id').references(() => customers.id).notNull(),
  paidAmount: integer('paid_amount').notNull(),
  amount: integer('amount').notNull(),
  usedDays: integer('used_days').notNull().default(10),
  remainingDays: integer('remaining_days').notNull().default(20),
  reason: text('reason').notNull().default('Customer cancelled subscription before cycle ends'),
  status: text('status').notNull().default('completed'), // 'completed' | 'pending'
  refundDate: timestamp('refund_date').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  entityType: text('entity_type').notNull(), // 'plan' | 'customer' | 'subscription' | 'invoice' | 'payment' | 'refund'
  entityId: integer('entity_id').notNull(),
  customerId: integer('customer_id'),
  action: text('action').notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  performedBy: text('performed_by').notNull().default('System'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const customersRelations = relations(customers, ({ many, one }) => ({
  subscriptions: many(subscriptions),
  invoices: many(invoices),
  user: one(users, { fields: [customers.userId], references: [users.id] }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  customer: one(customers, { fields: [subscriptions.customerId], references: [customers.id] }),
  plan: one(plans, { fields: [subscriptions.planId], references: [plans.id] }),
  billingCycles: many(billingCycles),
  invoices: many(invoices),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  customer: one(customers, { fields: [invoices.customerId], references: [customers.id] }),
  subscription: one(subscriptions, { fields: [invoices.subscriptionId], references: [subscriptions.id] }),
  payments: many(payments),
}));
