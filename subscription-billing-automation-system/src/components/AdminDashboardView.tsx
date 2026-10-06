import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

export interface DashboardSummary {
  total_customers: number;
  active_subscriptions: number;
  cancelled_subscriptions: number;
  mrr: number;
}

export interface RevenueByPlanItem {
  plan: string;
  revenue: number;
  subscribers: number;
  price: number;
}

export interface SubscriptionMetrics {
  active: number;
  trial: number;
  past_due: number;
  cancelled: number;
  total: number;
  churn_rate: number;
  trial_conversion_rate: number;
  status_breakdown: Array<{ name: string; value: number }>;
}

export interface AuditLogItem {
  id: number;
  entityType: string;
  entityId: number;
  customerId?: number;
  customerName?: string;
  action: string;
  oldValue?: string;
  newValue?: string;
  performedBy: string;
  createdAt: string;
}

import { TranslationStrings } from '../lib/i18n.ts';

interface AdminDashboardViewProps {
  summary: DashboardSummary | null;
  revenueByPlan: RevenueByPlanItem[];
  metrics: SubscriptionMetrics | null;
  recentLogs: AuditLogItem[];
  onNavigate: (tab: string) => void;
  t?: TranslationStrings;
}

const STATUS_COLORS: Record<string, string> = {
  Active: '#16a34a',
  Trial: '#2563eb',
  'Past Due': '#d97706',
  Cancelled: '#dc2626',
};

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({
  summary,
  revenueByPlan,
  metrics,
  recentLogs,
  onNavigate,
  t,
}) => {
  return (
    <div className="space-y-8">
      {/* Top Summary Cards */}
      <section aria-label="Key Subscription Metrics">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200/90 rounded-xl p-5 border-t-4 border-t-indigo-600">
            <div className="text-xs font-medium text-slate-500">
              {t?.totalCustomers || 'Total Customers'}
            </div>
            <div className="mt-2 text-3xl font-bold text-slate-950 font-mono tabular-nums tracking-tight">
              {summary ? summary.total_customers.toLocaleString() : '0'}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Registered SaaS organizations ·{' '}
              <button
                type="button"
                onClick={() => onNavigate('customers')}
                className="text-indigo-600 font-medium underline hover:text-indigo-800"
              >
                {t?.viewDirectory || 'View directory'}
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-200/90 rounded-xl p-5 border-t-4 border-t-emerald-600">
            <div className="text-xs font-medium text-slate-500">
              {t?.activeSubscriptions || 'Active Subscriptions'}
            </div>
            <div className="mt-2 text-3xl font-bold text-emerald-700 font-mono tabular-nums tracking-tight">
              {summary ? summary.active_subscriptions.toLocaleString() : '0'}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Trial Conversion Rate ·{' '}
              <span className="font-mono font-semibold text-slate-900">
                {metrics ? `${metrics.trial_conversion_rate}%` : '0%'}
              </span>
            </div>
          </div>

          <div className="bg-white border border-slate-200/90 rounded-xl p-5 border-t-4 border-t-slate-900">
            <div className="text-xs font-medium text-slate-500">
              {t?.mrrLabel || 'Monthly Recurring Revenue (MRR)'}
            </div>
            <div className="mt-2 text-3xl font-bold text-slate-950 font-mono tabular-nums tracking-tight">
              ₹{summary ? summary.mrr.toLocaleString() : '0'}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Normalized across active monthly & annual plans
            </div>
          </div>

          <div className="bg-white border border-slate-200/90 rounded-xl p-5 border-t-4 border-t-rose-600">
            <div className="text-xs font-medium text-slate-500">
              {t?.cancelledSubscriptions || 'Cancelled Subscriptions'}
            </div>
            <div className="mt-2 text-3xl font-bold text-rose-600 font-mono tabular-nums tracking-tight">
              {summary ? summary.cancelled_subscriptions.toLocaleString() : '0'}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Churn Rate ·{' '}
              <span className="font-mono font-semibold text-slate-900">
                {metrics ? `${metrics.churn_rate}%` : '0%'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Revenue By Plan & Subscription Status Breakdown Charts */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {t?.revenueByPlan || 'Revenue by Plan'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Recurring billing contribution grouped by subscription tier
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('plans')}
              className="text-xs font-medium text-slate-700 hover:text-slate-900 underline whitespace-nowrap"
            >
              {t?.managePlans || 'Manage Plans'}
            </button>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueByPlan} margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
                <XAxis
                  dataKey="plan"
                  tick={{ fill: '#475569', fontSize: 12 }}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#475569', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `₹${v}`}
                />
                <Tooltip
                  formatter={(value: any) => [`₹${Number(value).toLocaleString()}`, 'Revenue']}
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="revenue" fill="#4f46e5" radius={[6, 6, 0, 0]} barSize={44} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {revenueByPlan.map((item) => (
              <div key={item.plan}>
                <div className="text-xs text-slate-500">{item.plan}</div>
                <div className="text-sm font-semibold text-slate-900 font-mono tabular-nums mt-0.5">
                  ₹{item.revenue.toLocaleString()}
                </div>
                <div className="text-xs text-slate-500 font-mono tabular-nums">
                  {item.subscribers} active subs
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-900">
              {t?.lifecycleBreakdown || 'Subscription Lifecycle Breakdown'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              State distribution, churn & trial conversion health
            </p>
          </div>

          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={metrics?.status_breakdown || []}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={76}
                  paddingAngle={3}
                >
                  {(metrics?.status_breakdown || []).map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={STATUS_COLORS[entry.name] || '#64748b'}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 text-xs">
            <div className="flex items-center justify-between py-1">
              <span className="text-slate-600">Active</span>
              <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                {metrics?.active ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-slate-600">Trial</span>
              <span className="font-mono font-semibold text-blue-700 tabular-nums">
                {metrics?.trial ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-slate-600">Past Due</span>
              <span className="font-mono font-semibold text-amber-700 tabular-nums">
                {metrics?.past_due ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-slate-600">Cancelled</span>
              <span className="font-mono font-semibold text-red-600 tabular-nums">
                {metrics?.cancelled ?? 0}
              </span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <div>
              <span className="text-slate-500">Churn Rate: </span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {metrics?.churn_rate ?? 0}%
              </span>
            </div>
            <div>
              <span className="text-slate-500">Trial Conversion: </span>
              <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                {metrics?.trial_conversion_rate ?? 0}%
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Recent Billing & Lifecycle Activity */}
      <section className="bg-white border border-slate-200 rounded-lg">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {t?.recentActivity || 'Recent Billing & System Activity'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Real-time immutable event stream across plans, subscriptions, invoices, and webhooks
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('audit')}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap"
          >
            {t?.openFullAuditLog || 'Open Full Audit Log'}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-3 px-6">{t?.colTimestamp || 'Timestamp'}</th>
                <th className="py-3 px-4">{t?.colAction || 'Action'}</th>
                <th className="py-3 px-4">{t?.colEntity || 'Entity'}</th>
                <th className="py-3 px-4">{t?.colStateChange || 'State / Value Change'}</th>
                <th className="py-3 px-6 text-right">{t?.colPerformedBy || 'Performed By'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {recentLogs.slice(0, 7).map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-6 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="py-3 px-4 font-medium text-slate-900">{log.action}</td>
                  <td className="py-3 px-4 text-xs text-slate-600 capitalize">
                    {log.entityType} #{log.entityId}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-600 font-mono">
                    {log.oldValue ? `${log.oldValue} → ` : ''}
                    {log.newValue || 'Recorded'}
                  </td>
                  <td className="py-3 px-6 text-xs text-slate-600 text-right whitespace-nowrap">
                    {log.performedBy}
                  </td>
                </tr>
              ))}
              {recentLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-slate-500">
                    No activity recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
