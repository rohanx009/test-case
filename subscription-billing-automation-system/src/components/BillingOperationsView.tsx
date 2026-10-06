import React, { useState } from 'react';
import { Download, FileText, CreditCard, RefreshCw, RotateCcw, Eye } from 'lucide-react';
import { generateAndDownloadInvoicePdf, InvoicePdfData } from '../lib/pdf-invoice.ts';
import { InvoicePdfPreviewModal } from './InvoicePdfPreviewModal.tsx';
import { TranslationStrings } from '../lib/i18n.ts';

interface InvoiceRecord {
  id: number;
  invoiceNumber: string;
  subscriptionId: number;
  customerId: number;
  invoiceDate: string;
  dueDate: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  status: string;
  itemsJson: string;
  customer: {
    id: number;
    name: string;
    email: string;
    companyName: string;
  } | null;
  planName: string;
  billingInterval: string;
}

interface PaymentRecord {
  id: number;
  invoiceId: number;
  invoiceNumber: string;
  paymentReference: string;
  amount: number;
  paymentMethod: string;
  status: string;
  retryAttempt: number;
  nextRetryDate: string | null;
  paymentDate: string;
  customerName: string;
  companyName: string;
  subscriptionId: number | null;
  subscriptionStatus?: string;
}

interface RefundRecord {
  id: number;
  refundNumber: string;
  invoiceId: number;
  invoiceNumber: string;
  customerId: number;
  customerName: string;
  companyName: string;
  paidAmount: number;
  amount: number;
  usedDays: number;
  remainingDays: number;
  reason: string;
  status: string;
  refundDate: string;
}

interface BillingOperationsViewProps {
  activeSubTab: 'invoices' | 'payments';
  userRole: 'admin' | 'customer';
  invoices: InvoiceRecord[];
  payments: PaymentRecord[];
  failedPayments: PaymentRecord[];
  refunds: RefundRecord[];
  t?: TranslationStrings;
  onGenerateInvoices: () => Promise<void>;
  onProcessPayment: (invoiceId: number, amount: number, simulateOutcome?: 'success' | 'failed') => Promise<void>;
  onTriggerWebhook: (invoiceId: number, event: 'payment_success' | 'payment_failed' | 'payment_refunded') => Promise<void>;
  onRetryPayment: (paymentId: number, simulateOutcome?: 'success' | 'failed') => Promise<void>;
  onIssueRefund: (invoiceId: number, usedDays: number, reason: string) => Promise<void>;
}

export const BillingOperationsView: React.FC<BillingOperationsViewProps> = ({
  activeSubTab,
  userRole,
  invoices,
  payments,
  failedPayments,
  refunds,
  t,
  onGenerateInvoices,
  onProcessPayment,
  onTriggerWebhook,
  onRetryPayment,
  onIssueRefund,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);
  const [previewInvoice, setPreviewInvoice] = useState<InvoicePdfData | null>(null);

  // Refund calculator state (M2 Task 4: Monthly Plan ₹1000, Used 10 days, Remaining 20 days -> Refund ₹666)
  const [refundInvoiceId, setRefundInvoiceId] = useState<number>(
    invoices.find((i) => i.status === 'paid')?.id || (invoices[0]?.id ?? 1)
  );
  const [usedDays, setUsedDays] = useState<number>(10);
  const [refundReason, setRefundReason] = useState<string>(
    'Customer cancelled subscription before cycle ends'
  );
  const [isBusy, setIsBusy] = useState(false);

  const filteredInvoices = invoices.filter((inv) => {
    const matchesStatus = statusFilter === 'all' || inv.status === statusFilter;
    const q = searchQuery.toLowerCase().trim();
    const matchesQuery =
      !q ||
      inv.invoiceNumber.toLowerCase().includes(q) ||
      (inv.customer?.companyName || '').toLowerCase().includes(q) ||
      (inv.customer?.name || '').toLowerCase().includes(q);
    const matchesDate =
      !dateFilter || inv.invoiceDate.slice(0, 10) === dateFilter;
    return matchesStatus && matchesQuery && matchesDate;
  });

  const selectedRefundInv =
    invoices.find((i) => i.id === Number(refundInvoiceId)) || invoices[0];
  const basePaidAmount = selectedRefundInv ? selectedRefundInv.subtotal : 1000;
  const remainingDays = Math.max(0, 30 - usedDays);
  const calculatedRefundAmount = Math.floor((basePaidAmount * remainingDays) / 30);

  const toInvoicePdfData = (inv: InvoiceRecord): InvoicePdfData => ({
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    status: inv.status,
    customerName: inv.customer?.name || 'Customer',
    companyName: inv.customer?.companyName || 'Enterprise Account',
    customerEmail: inv.customer?.email || 'billing@customer.io',
    planName: inv.planName,
    subtotal: inv.subtotal,
    taxAmount: inv.taxAmount,
    totalAmount: inv.totalAmount,
    itemsJson: inv.itemsJson,
  });

  const handlePreviewPdf = (inv: InvoiceRecord) => {
    setPreviewInvoice(toInvoicePdfData(inv));
  };

  const handleDownloadPdf = (inv: InvoiceRecord) => {
    generateAndDownloadInvoicePdf(toInvoicePdfData(inv));
  };

  if (activeSubTab === 'invoices') {
    return (
      <div className="space-y-6">
        {/* Header & Controls */}
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-slate-950 text-white px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-white">
                {userRole === 'admin'
                  ? t?.allCustomerInvoicesTitle ||
                    'All Customers GST Invoice Generation & Status Board'
                  : t?.myInvoicesTitle || 'My GST Invoices & Billing Receipts'}
              </h2>
            </div>
            <button
              type="button"
              disabled={isBusy}
              onClick={async () => {
                setIsBusy(true);
                try {
                  await onGenerateInvoices();
                } finally {
                  setIsBusy(false);
                }
              }}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors whitespace-nowrap"
            >
              {userRole === 'admin'
                ? t?.generateAllInvoicesBtn || 'Generate All Customer Invoices'
                : t?.generateMyInvoiceBtn || 'Generate My Next Cycle Invoice'}
            </button>
          </div>

          {/* Search & Status Filters */}
          <div className="p-6 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
            <div className="flex flex-1 flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label htmlFor="invoice-search" className="sr-only">
                  Search Invoice Number or Customer
                </label>
                <input
                  id="invoice-search"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    t?.searchInvoicePlaceholder ||
                    'Search by Invoice No (e.g. INV-2026-001) or Customer...'
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
              <div>
                <label htmlFor="invoice-date-filter" className="sr-only">
                  Filter by Invoice Date
                </label>
                <input
                  id="invoice-date-filter"
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="px-3 py-2 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono"
                />
              </div>
            </div>

            {/* Interactive Segmented Filter Controls */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
              {(['all', 'paid', 'unpaid', 'failed', 'refunded'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize whitespace-nowrap ${
                    statusFilter === st
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st === 'all' ? t?.allInvoicesFilter || 'All Invoices' : st}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Invoices Table */}
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-6">{t?.colInvoiceNo || 'Invoice No'}</th>
                  <th className="py-3 px-4">{t?.colCustomer || 'Customer'}</th>
                  <th className="py-3 px-4">{t?.colCurrentPlan || 'Plan'}</th>
                  <th className="py-3 px-4">{t?.colInvoiceDate || 'Invoice Date'}</th>
                  <th className="py-3 px-4 text-right">{t?.colSubtotal || 'Subtotal'}</th>
                  <th className="py-3 px-4 text-right">{t?.colGst || 'GST (18%)'}</th>
                  <th className="py-3 px-4 text-right">{t?.colTotal || 'Total'}</th>
                  <th className="py-3 px-4">{t?.colStatus || 'Status'}</th>
                  <th className="py-3 px-6 text-right">{t?.colActions || 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-6 font-mono text-xs font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                      {inv.invoiceNumber}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">
                        {inv.customer?.companyName || 'Customer'}
                      </div>
                      <div className="text-xs text-slate-500">{inv.customer?.name}</div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">{inv.planName}</td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                      {new Date(inv.invoiceDate).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                      ₹{inv.subtotal.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-slate-500 tabular-nums">
                      ₹{inv.taxAmount.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-sm font-semibold text-slate-900 tabular-nums">
                      ₹{inv.totalAmount.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-xs font-medium capitalize">
                      <span
                        className={
                          inv.status === 'paid'
                            ? 'text-emerald-700 font-semibold'
                            : inv.status === 'failed'
                            ? 'text-red-600 font-semibold'
                            : inv.status === 'refunded'
                            ? 'text-slate-600'
                            : 'text-amber-700 font-semibold'
                        }
                      >
                        {inv.status}
                      </span>
                    </td>
                    <td className="py-3 px-6 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handlePreviewPdf(inv)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100 transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          {t?.previewPdfBtn || 'Preview PDF'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadPdf(inv)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-900 border border-slate-300 rounded hover:bg-slate-100"
                        >
                          <Download className="w-3.5 h-3.5" />
                          {t?.downloadBtn || 'Download'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedInvoice(inv)}
                          className="px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200 rounded hover:bg-slate-100"
                        >
                          {t?.detailsBtn || 'Details'}
                        </button>
                        {(inv.status === 'unpaid' || inv.status === 'failed') && (
                          <button
                            type="button"
                            onClick={() => onProcessPayment(inv.id, inv.totalAmount, 'success')}
                            className="px-2.5 py-1 text-xs font-medium text-white bg-emerald-700 rounded hover:bg-emerald-800"
                          >
                            {t?.payNowBtn || 'Pay Now'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredInvoices.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-10 text-center text-sm text-slate-500">
                      No invoices match the current filter criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Selected Invoice Detail Drawer / Panel */}
        {selectedInvoice && (
          <div className="bg-white border border-slate-300 rounded-lg p-6">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4">
              <div>
                <div className="text-xs text-slate-500">
                  Tax Invoice Breakdown · {selectedInvoice.invoiceNumber}
                </div>
                <h3 className="text-lg font-bold text-slate-900 mt-0.5">
                  {selectedInvoice.customer?.companyName} ({selectedInvoice.customer?.name})
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePreviewPdf(selectedInvoice)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Preview PDF
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadPdf(selectedInvoice)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Download GST PDF
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedInvoice(null)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4 text-xs">
              <div>
                <div className="text-slate-500">Customer Email</div>
                <div className="font-medium text-slate-900 mt-1">
                  {selectedInvoice.customer?.email}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Invoice & Due Dates</div>
                <div className="font-mono text-slate-900 mt-1 tabular-nums">
                  Issued: {new Date(selectedInvoice.invoiceDate).toLocaleDateString()} · Due:{' '}
                  {new Date(selectedInvoice.dueDate).toLocaleDateString()}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Total Amount (incl. 18% GST)</div>
                <div className="font-mono text-base font-bold text-slate-900 mt-0.5 tabular-nums">
                  ₹{selectedInvoice.totalAmount.toLocaleString()}{' '}
                  <span className="text-xs font-normal text-slate-500 capitalize">
                    ({selectedInvoice.status})
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PDF Preview Modal */}
        <InvoicePdfPreviewModal
          invoice={previewInvoice}
          onClose={() => setPreviewInvoice(null)}
        />
      </div>
    );
  }

  // Payments, Webhooks, Failed Payment Retry Queue & Refund Management View
  return (
    <div className="space-y-8">
      {/* Top Row: Mock Payment Gateway Simulator & Prorated Refund Calculator */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* M2 Task 3: Mock Payment Gateway & Webhook Simulator */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {t?.paymentGatewayTitle || 'Mock Payment Gateway & Webhook Processor'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Simulate 80% success / 20% failure gateway charges and dispatch webhook events
              </p>
            </div>
            <CreditCard className="w-5 h-5 text-slate-400" />
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="gateway-invoice-select" className="block text-xs font-medium text-slate-700 mb-1">
                {t?.selectTargetInvoiceLabel || 'Select Target Invoice'}
              </label>
              <select
                id="gateway-invoice-select"
                value={refundInvoiceId}
                onChange={(e) => setRefundInvoiceId(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono"
              >
                {invoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoiceNumber} — {inv.customer?.companyName} — ₹{inv.totalAmount} ({inv.status.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>

            <div className="pt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isBusy || !selectedRefundInv}
                onClick={async () => {
                  if (!selectedRefundInv) return;
                  setIsBusy(true);
                  try {
                    await onProcessPayment(selectedRefundInv.id, selectedRefundInv.totalAmount);
                  } finally {
                    setIsBusy(false);
                  }
                }}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                {t?.processGatewayChargeBtn || 'Process Gateway Charge (80/20 Random)'}
              </button>

              <button
                type="button"
                disabled={isBusy || !selectedRefundInv}
                onClick={async () => {
                  if (!selectedRefundInv) return;
                  setIsBusy(true);
                  try {
                    await onTriggerWebhook(selectedRefundInv.id, 'payment_success');
                  } finally {
                    setIsBusy(false);
                  }
                }}
                className="px-3 py-2 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 whitespace-nowrap"
              >
                Webhook: payment_success
              </button>

              <button
                type="button"
                disabled={isBusy || !selectedRefundInv}
                onClick={async () => {
                  if (!selectedRefundInv) return;
                  setIsBusy(true);
                  try {
                    await onTriggerWebhook(selectedRefundInv.id, 'payment_failed');
                  } finally {
                    setIsBusy(false);
                  }
                }}
                className="px-3 py-2 text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 whitespace-nowrap"
              >
                Webhook: payment_failed
              </button>
            </div>

            <div className="pt-3 border-t border-slate-100 text-xs text-slate-500">
              Webhook Flow: <span className="font-mono">Invoice Generated → Process Payment → Webhook Sent → Invoice & Subscription Updated</span>
            </div>
          </div>
        </div>

        {/* M2 Task 4: Prorated Refund Management Calculator */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {t?.refundCalculatorTitle || 'Prorated Refund Calculator & Issuance'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Calculate refundable amount when a customer cancels before cycle ends
              </p>
            </div>
            <RotateCcw className="w-5 h-5 text-slate-400" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="refund-used-days" className="block text-xs font-medium text-slate-700 mb-1">
                {t?.cycleDaysUsedLabel || 'Cycle Days Used (out of 30 days)'}
              </label>
              <input
                id="refund-used-days"
                type="number"
                min={0}
                max={29}
                value={usedDays}
                onChange={(e) => setUsedDays(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label htmlFor="refund-reason-input" className="block text-xs font-medium text-slate-700 mb-1">
                {t?.refundReasonLabel || 'Refund Reason'}
              </label>
              <input
                id="refund-reason-input"
                type="text"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>

          <div className="mt-4 p-3.5 bg-slate-50 border border-slate-200 rounded-md flex flex-wrap items-center justify-between gap-4">
            <div className="text-xs space-y-1">
              <div className="text-slate-600">
                Customer:{' '}
                <span className="font-semibold text-slate-900">
                  {selectedRefundInv?.customer?.companyName || 'ABC Corp'}
                </span>
              </div>
              <div className="text-slate-500 font-mono tabular-nums">
                Paid Plan Base: ₹{basePaidAmount.toLocaleString()} · Used: {usedDays}d · Remaining:{' '}
                {remainingDays}d
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-xs text-slate-500">
                  {t?.refundAmountLabel || 'Refund Amount'}
                </div>
                <div className="text-lg font-bold text-slate-900 font-mono tabular-nums">
                  ₹{calculatedRefundAmount.toLocaleString()}
                </div>
              </div>
              <button
                type="button"
                disabled={isBusy || !selectedRefundInv}
                onClick={async () => {
                  if (!selectedRefundInv) return;
                  setIsBusy(true);
                  try {
                    await onIssueRefund(selectedRefundInv.id, usedDays, refundReason);
                  } finally {
                    setIsBusy(false);
                  }
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 whitespace-nowrap"
              >
                {t?.issueRefundBtn || 'Issue Refund'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* M2 Task 4 & M3 Task 2: Failed Payment Queue (Dunning Retry Schedule) */}
      <div className="bg-white border border-slate-200 rounded-lg">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {t?.dunningQueueTitle ||
                'Failed Payment Dunning Queue (Retry Schedule: Day 1 → Day 3 → Day 7)'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Retries recover subscriptions from past_due → active, or cancel automatically after 3 exhausted attempts
            </p>
          </div>
          <span className="text-xs font-mono text-slate-600 tabular-nums">
            {failedPayments.length} queued failed payments
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-3 px-6">Customer</th>
                <th className="py-3 px-4">Invoice</th>
                <th className="py-3 px-4 text-right">Amount</th>
                <th className="py-3 px-4">Retry Attempt</th>
                <th className="py-3 px-4">Next Scheduled Retry</th>
                <th className="py-3 px-4">Subscription Status</th>
                <th className="py-3 px-6 text-right">Dunning Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {failedPayments.map((fp) => (
                <tr key={fp.id} className="hover:bg-slate-50/80">
                  <td className="py-3 px-6">
                    <div className="font-medium text-slate-900">{fp.companyName}</div>
                    <div className="text-xs text-slate-500">{fp.customerName}</div>
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-700 tabular-nums">
                    {fp.invoiceNumber}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-sm font-semibold text-red-600 tabular-nums">
                    ₹{fp.amount.toLocaleString()}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-amber-800 tabular-nums">
                    Attempt {fp.retryAttempt} of 3
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums">
                    {fp.nextRetryDate
                      ? new Date(fp.nextRetryDate).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })
                      : 'Exhausted'}
                  </td>
                  <td className="py-3 px-4 text-xs font-semibold capitalize text-amber-700">
                    {fp.subscriptionStatus || 'past_due'}
                  </td>
                  <td className="py-3 px-6 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onRetryPayment(fp.id, 'success')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-emerald-700 rounded hover:bg-emerald-800"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Retry (Recover)
                      </button>
                      <button
                        type="button"
                        onClick={() => onRetryPayment(fp.id, 'failed')}
                        className="px-2.5 py-1 text-xs font-medium text-red-700 border border-red-200 rounded hover:bg-red-50"
                      >
                        Simulate Retry Fail
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {failedPayments.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-slate-500">
                    No failed payments in the retry queue. All active invoices are settled.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom Split: Payment Transaction Ledger & Refund History */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg">
          <div className="px-6 py-4 border-b border-slate-200">
            <h3 className="text-base font-semibold text-slate-900">Payment Transaction History</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              All gateway transactions with reference IDs and payment dates
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-6">Transaction ID</th>
                  <th className="py-3 px-4">Invoice</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-6 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-6 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                      {p.paymentReference}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums">
                      {p.invoiceNumber}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700">{p.companyName}</td>
                    <td className="py-3 px-4 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                      ₹{p.amount.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-xs capitalize">
                      <span
                        className={
                          p.status === 'success'
                            ? 'text-emerald-700 font-semibold'
                            : p.status === 'failed'
                            ? 'text-red-600 font-semibold'
                            : 'text-slate-600'
                        }
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="py-3 px-6 text-right font-mono text-xs text-slate-500 tabular-nums">
                      {new Date(p.paymentDate).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg">
          <div className="px-6 py-4 border-b border-slate-200">
            <h3 className="text-base font-semibold text-slate-900">Refund History</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Completed prorated refunds issued to customers
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-5">Refund ID</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-5 text-right">Issued Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {refunds.map((rf) => (
                  <tr key={rf.id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-5 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                      {rf.refundNumber}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700">
                      <div className="font-medium text-slate-900">{rf.companyName}</div>
                      <div className="text-slate-500">{rf.remainingDays}d unused credit</div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                      ₹{rf.amount.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-xs font-medium text-emerald-700 capitalize">
                      {rf.status}
                    </td>
                    <td className="py-3 px-5 text-right font-mono text-xs text-slate-500 tabular-nums">
                      {new Date(rf.refundDate).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                  </tr>
                ))}
                {refunds.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-sm text-slate-500">
                      No refunds issued yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
