import React, { useState, useEffect } from 'react';
import { AuditLogItem } from './AdminDashboardView.tsx';
import { TranslationStrings } from '../lib/i18n.ts';

interface CustomerItem {
  id: number;
  name: string;
  email: string;
  companyName: string;
  createdAt: string;
  currentPlanName?: string;
  currentPlanPrice?: number;
  activeSubscription?: {
    id: number;
    planId: number;
    status: string;
  } | null;
}

interface TimelineEntry {
  id: string;
  date: string;
  title: string;
  detail: string;
  category: string;
  performedBy: string;
}

interface ActivitySummary {
  total_invoices: number;
  total_payments: number;
  total_paid: number;
  failed_payments: number;
  refunds: number;
}

interface CustomersAndAuditViewProps {
  mode: 'customers' | 'audit';
  userRole: 'admin' | 'customer';
  customers: CustomerItem[];
  auditLogs: AuditLogItem[];
  token: string;
  t?: TranslationStrings;
  onCreateCustomer: (data: { name: string; email: string; company_name: string }) => Promise<void>;
  onUpdateCustomer: (id: number, data: { name: string; email: string; company_name: string }) => Promise<void>;
}

export const CustomersAndAuditView: React.FC<CustomersAndAuditViewProps> = ({
  mode,
  userRole,
  customers,
  auditLogs,
  token,
  t,
  onCreateCustomer,
  onUpdateCustomer,
}) => {
  const [selectedCustomerId, setSelectedCustomerId] = useState<number>(customers[0]?.id || 1);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [activitySummary, setActivitySummary] = useState<ActivitySummary | null>(null);
  const [planHistory, setPlanHistory] = useState<AuditLogItem[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);

  // New / Edit customer modal state
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerItem | null>(null);
  const [custName, setCustName] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [custCompany, setCustCompany] = useState('');

  // Audit Log filter state
  const [entityTypeFilter, setEntityTypeFilter] = useState('all');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [actionSearch, setActionSearch] = useState('');

  useEffect(() => {
    if (customers.length > 0 && !customers.some((c) => c.id === selectedCustomerId)) {
      setSelectedCustomerId(customers[0].id);
    }
  }, [customers, selectedCustomerId]);

  useEffect(() => {
    if (!selectedCustomerId || !token) return;
    let isMounted = true;
    const loadCustomerTimeline = async () => {
      setLoadingTimeline(true);
      try {
        const [histRes, sumRes] = await Promise.all([
          fetch(`/api/customers/${selectedCustomerId}/billing-history`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`/api/customers/${selectedCustomerId}/activity-summary`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
        if (histRes.ok && isMounted) {
          const histData = await histRes.json();
          setTimeline(histData.timeline || []);
          const firstSub = histData.subscriptions?.[0];
          if (firstSub) {
            const subHistRes = await fetch(`/api/subscriptions/${firstSub.id}/history`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (subHistRes.ok && isMounted) {
              setPlanHistory(await subHistRes.json());
            }
          } else {
            setPlanHistory([]);
          }
        }
        if (sumRes.ok && isMounted) {
          setActivitySummary(await sumRes.json());
        }
      } catch (e) {
        console.error('Error loading customer timeline:', e);
      } finally {
        if (isMounted) setLoadingTimeline(false);
      }
    };
    loadCustomerTimeline();
    return () => {
      isMounted = false;
    };
  }, [selectedCustomerId, token, auditLogs.length]);

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) || customers[0];

  if (mode === 'audit') {
    const filteredLogs = auditLogs.filter((l) => {
      const matchEntity = entityTypeFilter === 'all' || l.entityType === entityTypeFilter;
      const matchCust =
        customerFilter === 'all' || String(l.customerId) === String(customerFilter);
      const q = actionSearch.toLowerCase().trim();
      const matchSearch =
        !q ||
        l.action.toLowerCase().includes(q) ||
        (l.newValue || '').toLowerCase().includes(q) ||
        l.performedBy.toLowerCase().includes(q);
      return matchEntity && matchCust && matchSearch;
    });

    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-slate-950 text-white px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-white">
                {userRole === 'admin'
                  ? t?.allAuditLogsTitle ||
                    'System-Wide Immutable Audit Log Viewer (All Customers)'
                  : t?.myAuditLogsTitle || 'My Account Audit Log & Billing History'}
              </h2>
            </div>
            <div className="text-xs font-mono text-slate-300 tabular-nums">
              Showing {filteredLogs.length} of {auditLogs.length} events
            </div>
          </div>

          <div className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="audit-action-search" className="block text-xs font-medium text-slate-600 mb-1">
                {t?.searchActionPlaceholder || 'Search Action or Actor'}
              </label>
              <input
                id="audit-action-search"
                type="text"
                value={actionSearch}
                onChange={(e) => setActionSearch(e.target.value)}
                placeholder={t?.searchActionPlaceholder || 'e.g. Plan Changed, Invoice Generated...'}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label htmlFor="audit-entity-filter" className="block text-xs font-medium text-slate-600 mb-1">
                {t?.entityTypeLabel || 'Entity Type'}
              </label>
              <select
                id="audit-entity-filter"
                value={entityTypeFilter}
                onChange={(e) => setEntityTypeFilter(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="all">All Entities</option>
                {userRole === 'admin' && <option value="plan">Plans</option>}
                <option value="customer">Customers</option>
                <option value="subscription">Subscriptions</option>
                <option value="invoice">Invoices</option>
                <option value="payment">Payments</option>
                <option value="refund">Refunds</option>
              </select>
            </div>

            {userRole === 'admin' ? (
              <div>
                <label htmlFor="audit-customer-filter" className="block text-xs font-medium text-slate-600 mb-1">
                  {t?.filterByCustomerLabel || 'Filter by Customer'}
                </label>
                <select
                  id="audit-customer-filter"
                  value={customerFilter}
                  onChange={(e) => setCustomerFilter(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="all">All Customers</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.companyName} ({c.name})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <div className="block text-xs font-medium text-slate-600 mb-1">Scoped Organization</div>
                <div className="px-3 py-2 text-xs border border-slate-200 rounded-md bg-slate-50 font-medium text-slate-800">
                  {customers[0]?.companyName || 'My Organization'} (Isolated View)
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-6">Date</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Customer / Scope</th>
                  <th className="py-3 px-4">Old Value → New Value</th>
                  <th className="py-3 px-6 text-right">User / System</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-6 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900">{log.action}</td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      {log.customerName || 'System Global'} ·{' '}
                      <span className="font-mono capitalize">
                        {log.entityType} #{log.entityId}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600">
                      {log.oldValue ? `${log.oldValue} → ` : ''}
                      {log.newValue || 'Completed'}
                    </td>
                    <td className="py-3 px-6 text-right text-xs font-medium text-slate-700 whitespace-nowrap">
                      {log.performedBy}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // Customers Directory + M3 Task 3 Customer Billing Timeline & Activity Summary
  return (
    <div className="space-y-6">
      <div className="bg-slate-950 text-white border border-slate-900 rounded-xl px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">
            {userRole === 'admin'
              ? t?.allCustomersTitle ||
                'All SaaS Customers & Chronological Billing Timelines'
              : t?.myOrgProfileTitle ||
                'My Organization Profile & Chronological Billing Timeline'}
          </h2>
        </div>
        {userRole === 'admin' && (
          <button
            type="button"
            onClick={() => {
              setEditingCustomer(null);
              setCustName('');
              setCustEmail('');
              setCustCompany('');
              setShowNewCustomerForm(true);
            }}
            className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 whitespace-nowrap"
          >
            {t?.addCustomerBtn || 'Add Customer'}
          </button>
        )}
      </div>

      {showNewCustomerForm && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (editingCustomer) {
              await onUpdateCustomer(editingCustomer.id, {
                name: custName,
                email: custEmail,
                company_name: custCompany,
              });
            } else {
              await onCreateCustomer({
                name: custName,
                email: custEmail,
                company_name: custCompany,
              });
            }
            setShowNewCustomerForm(false);
            setEditingCustomer(null);
          }}
          className="bg-white border border-slate-300 rounded-lg p-6 space-y-4"
        >
          <h3 className="text-sm font-semibold text-slate-900">
            {editingCustomer ? `Edit Customer: ${editingCustomer.companyName}` : 'Create New SaaS Customer'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="cust-name" className="block text-xs font-medium text-slate-700 mb-1">
                Contact Name
              </label>
              <input
                id="cust-name"
                type="text"
                required
                value={custName}
                onChange={(e) => setCustName(e.target.value)}
                placeholder="e.g. Rohan Kapoor"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="cust-email" className="block text-xs font-medium text-slate-700 mb-1">
                Billing Email
              </label>
              <input
                id="cust-email"
                type="email"
                required
                value={custEmail}
                onChange={(e) => setCustEmail(e.target.value)}
                placeholder="billing@company.in"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="cust-company" className="block text-xs font-medium text-slate-700 mb-1">
                Company Name
              </label>
              <input
                id="cust-company"
                type="text"
                required
                value={custCompany}
                onChange={(e) => setCustCompany(e.target.value)}
                placeholder="e.g. NovaTech Solutions"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
            >
              {editingCustomer ? 'Save Changes' : 'Create Customer'}
            </button>
            <button
              type="button"
              onClick={() => setShowNewCustomerForm(false)}
              className="px-4 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Customers Directory Table */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              {t?.customerDirectoryTitle || 'Customer Directory'}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-5">{t?.colCustomer || 'Organization'}</th>
                  <th className="py-3 px-4">{t?.colCurrentPlan || 'Current Plan'}</th>
                  <th className="py-3 px-4">{t?.colStatus || 'Status'}</th>
                  <th className="py-3 px-5 text-right">{t?.colActions || 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {customers.map((c) => {
                  const isSelected = c.id === selectedCustomer?.id;
                  return (
                    <tr
                      key={c.id}
                      className={`transition-colors ${
                        isSelected ? 'bg-slate-100/90' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-3 px-5">
                        <div className="font-semibold text-slate-900">{c.companyName}</div>
                        <div className="text-xs text-slate-500">
                          {c.name} · {c.email}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700 font-medium">
                        {c.currentPlanName || 'No Plan'}
                      </td>
                      <td className="py-3 px-4 text-xs capitalize">
                        <span
                          className={
                            c.activeSubscription?.status === 'active'
                              ? 'text-emerald-700 font-semibold'
                              : c.activeSubscription?.status === 'past_due'
                              ? 'text-amber-700 font-semibold'
                              : c.activeSubscription?.status === 'cancelled'
                              ? 'text-red-600'
                              : 'text-blue-700 font-semibold'
                          }
                        >
                          {c.activeSubscription?.status || 'unsubscribed'}
                        </span>
                      </td>
                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedCustomerId(c.id)}
                            className="px-2.5 py-1 text-xs font-medium text-slate-900 border border-slate-300 rounded hover:bg-white"
                          >
                            {t?.timelineBtn || 'Timeline'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCustomer(c);
                              setCustName(c.name);
                              setCustEmail(c.email);
                              setCustCompany(c.companyName);
                              setShowNewCustomerForm(true);
                            }}
                            className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900"
                          >
                            {t?.editBtn || 'Edit'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Customer Activity Summary Card + Billing Timeline + Plan Change History */}
        <div className="lg:col-span-6 space-y-6">
          {selectedCustomer && (
            <>
              {/* Customer Activity Summary Card (M3 Task 3) */}
              <div className="bg-white border border-slate-200 rounded-lg p-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <div className="text-xs text-slate-500">
                      {t?.customerDossierLabel || 'Customer Billing Dossier'}
                    </div>
                    <h3 className="text-base font-bold text-slate-900">
                      {selectedCustomer.companyName}
                    </h3>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {selectedCustomer.name} · {selectedCustomer.email}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500">{t?.colCurrentPlan || 'Current Plan'}</div>
                    <div className="text-sm font-bold text-slate-900">
                      {selectedCustomer.currentPlanName || 'None'}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-3 pt-4 text-center">
                  <div className="p-3 bg-slate-50 rounded-md">
                    <div className="text-xs text-slate-500">{t?.statInvoices || 'Invoices'}</div>
                    <div className="text-lg font-bold text-slate-900 font-mono tabular-nums mt-0.5">
                      {activitySummary?.total_invoices ?? 0}
                    </div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-md">
                    <div className="text-xs text-slate-500">Payments</div>
                    <div className="text-lg font-bold text-emerald-700 font-mono tabular-nums mt-0.5">
                      {activitySummary?.total_payments ?? 0}
                    </div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-md">
                    <div className="text-xs text-slate-500">Failed</div>
                    <div className="text-lg font-bold text-amber-700 font-mono tabular-nums mt-0.5">
                      {activitySummary?.failed_payments ?? 0}
                    </div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-md">
                    <div className="text-xs text-slate-500">Refunds</div>
                    <div className="text-lg font-bold text-slate-900 font-mono tabular-nums mt-0.5">
                      {activitySummary?.refunds ?? 0}
                    </div>
                  </div>
                </div>
              </div>

              {/* Subscription Plan Change History (M3 Task 3) */}
              <div className="bg-white border border-slate-200 rounded-lg p-6">
                <h4 className="text-sm font-semibold text-slate-900">
                  {t?.subscriptionChangeHistoryTitle || 'Subscription Change History'}
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Historical plan upgrades, downgrades, and lifecycle transitions
                </p>

                <div className="mt-4 space-y-2.5">
                  {planHistory.map((ph) => (
                    <div
                      key={ph.id}
                      className="flex items-center justify-between text-xs py-2 border-b border-slate-100 last:border-0"
                    >
                      <div>
                        <span className="font-semibold text-slate-900">{ph.action}</span>
                        <span className="text-slate-500 ml-2 font-mono">
                          {ph.oldValue ? `${ph.oldValue} → ` : ''}
                          {ph.newValue}
                        </span>
                      </div>
                      <span className="font-mono text-slate-500 tabular-nums">
                        {new Date(ph.createdAt).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </span>
                    </div>
                  ))}
                  {planHistory.length === 0 && (
                    <div className="text-xs text-slate-500 py-2">
                      No plan changes recorded for this customer yet.
                    </div>
                  )}
                </div>
              </div>

              {/* Chronological Customer Billing Timeline (M3 Task 3) */}
              <div className="bg-white border border-slate-200 rounded-lg p-6">
                <h4 className="text-sm font-semibold text-slate-900">
                  {t?.customerBillingTimelineTitle || 'Customer Billing Timeline'}
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Chronological audit stream for {selectedCustomer.companyName}
                </p>

                {loadingTimeline ? (
                  <div className="py-6 text-xs text-slate-500">Loading timeline...</div>
                ) : (
                  <div className="mt-4 space-y-4">
                    {timeline.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start gap-4 text-xs pb-3 border-b border-slate-100 last:border-0"
                      >
                        <div className="font-mono text-slate-500 tabular-nums whitespace-nowrap pt-0.5 w-20">
                          {new Date(item.date).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                          })}
                        </div>
                        <div className="flex-1">
                          <div className="font-semibold text-slate-900">{item.title}</div>
                          <div className="text-slate-600 font-mono mt-0.5">{item.detail}</div>
                        </div>
                        <div className="text-slate-400 whitespace-nowrap">{item.performedBy}</div>
                      </div>
                    ))}
                    {timeline.length === 0 && (
                      <div className="text-xs text-slate-500 py-4">
                        No billing timeline events found for this customer.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
