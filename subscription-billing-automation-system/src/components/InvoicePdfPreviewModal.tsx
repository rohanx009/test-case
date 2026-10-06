import React, { useEffect, useState } from 'react';
import { Download, X, FileText, Eye, Code } from 'lucide-react';
import {
  InvoicePdfData,
  parseInvoiceLineItems,
  generateInvoicePdfBlobUrl,
  generateAndDownloadInvoicePdf,
} from '../lib/pdf-invoice.ts';

interface InvoicePdfPreviewModalProps {
  invoice: InvoicePdfData | null;
  onClose: () => void;
}

export const InvoicePdfPreviewModal: React.FC<InvoicePdfPreviewModalProps> = ({
  invoice,
  onClose,
}) => {
  const [viewMode, setViewMode] = useState<'sheet' | 'pdf'>('sheet');
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!invoice) {
      setPdfBlobUrl(null);
      return;
    }

    const url = generateInvoicePdfBlobUrl(invoice);
    setPdfBlobUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [invoice]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (invoice) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [invoice, onClose]);

  if (!invoice) return null;

  const lineItems = parseInvoiceLineItems(invoice);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-preview-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* Top Modal Control Bar */}
        <div className="bg-slate-950 text-white px-6 py-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-indigo-600 text-white font-bold text-sm flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </span>
            <div>
              <h2 id="pdf-preview-modal-title" className="text-sm sm:text-base font-bold text-white">
                Invoice PDF Preview · {invoice.invoiceNumber}
              </h2>
              <p className="text-xs text-slate-400">
                Inspect generated A4 GST tax invoice before downloading
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* View Mode Toggle: Crisp A4 Document Sheet vs Embedded PDF Stream */}
            <div className="hidden sm:inline-flex items-center bg-slate-900 border border-slate-800 rounded-lg p-1">
              <button
                type="button"
                onClick={() => setViewMode('sheet')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  viewMode === 'sheet'
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                Document Sheet
              </button>
              <button
                type="button"
                onClick={() => setViewMode('pdf')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  viewMode === 'pdf'
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Code className="w-3.5 h-3.5" />
                Native PDF Frame
              </button>
            </div>

            <button
              type="button"
              onClick={() => generateAndDownloadInvoicePdf(invoice)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors whitespace-nowrap shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              Download PDF ({invoice.invoiceNumber}.pdf)
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close PDF preview modal"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Preview Canvas */}
        <div className="flex-1 overflow-y-auto bg-slate-100 p-4 sm:p-8 flex justify-center">
          {viewMode === 'pdf' && pdfBlobUrl ? (
            <div className="w-full h-[640px] bg-white rounded-lg border border-slate-300 overflow-hidden shadow-md">
              <iframe
                src={pdfBlobUrl}
                title={`PDF Preview for ${invoice.invoiceNumber}`}
                className="w-full h-full border-0"
              />
            </div>
          ) : (
            /* High-Precision A4 Paper Sheet Preview matching buildInvoicePdfDoc */
            <div className="w-full max-w-2xl bg-white border border-slate-300 rounded-sm shadow-lg overflow-hidden flex flex-col justify-between min-h-[680px]">
              <div>
                {/* A4 Top Header Band */}
                <div className="bg-slate-950 text-white px-8 py-6 flex items-start justify-between gap-4">
                  <div>
                    <div className="inline-flex items-center gap-2.5">
                      <span className="w-7 h-7 rounded-md bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">
                        S
                      </span>
                      <span className="text-xl font-bold tracking-tight text-white">SubBill</span>
                    </div>
                    <div className="text-[11px] font-medium tracking-wider text-slate-300 uppercase mt-2">
                      TAX INVOICE / GST RECEIPT
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-mono text-base font-bold text-white tabular-nums">
                      {invoice.invoiceNumber}
                    </div>
                    <div className="text-xs text-slate-300 mt-1 uppercase font-mono">
                      Status:{' '}
                      <span
                        className={
                          invoice.status === 'paid'
                            ? 'text-emerald-400 font-semibold'
                            : invoice.status === 'failed'
                            ? 'text-red-400 font-semibold'
                            : 'text-amber-300 font-semibold'
                        }
                      >
                        {invoice.status.toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Billed To & Metadata Row */}
                <div className="px-8 py-6 grid grid-cols-1 sm:grid-cols-2 gap-6 border-b border-slate-200 text-xs">
                  <div>
                    <div className="font-bold text-slate-900 uppercase tracking-wider text-[11px] mb-2">
                      Billed To:
                    </div>
                    <div className="font-semibold text-slate-900 text-sm">
                      {invoice.companyName || invoice.customerName}
                    </div>
                    <div className="text-slate-600 mt-0.5">{invoice.customerName}</div>
                    <div className="text-slate-500 font-mono mt-0.5">{invoice.customerEmail}</div>
                  </div>

                  <div className="sm:text-right">
                    <div className="font-bold text-slate-900 uppercase tracking-wider text-[11px] mb-2">
                      Invoice Metadata:
                    </div>
                    <div className="text-slate-700 font-mono tabular-nums">
                      Invoice Date:{' '}
                      <span className="font-semibold text-slate-900">
                        {new Date(invoice.invoiceDate).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                    <div className="text-slate-700 font-mono tabular-nums mt-1">
                      Due Date:{' '}
                      <span className="font-semibold text-slate-900">
                        {new Date(invoice.dueDate).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                    <div className="text-slate-700 mt-1">
                      Subscription Plan:{' '}
                      <span className="font-semibold text-slate-900">{invoice.planName}</span>
                    </div>
                  </div>
                </div>

                {/* Line Items Table */}
                <div className="px-8 py-6">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-y border-slate-200 text-xs font-bold text-slate-700">
                        <th className="py-2.5 px-3">Description</th>
                        <th className="py-2.5 px-3 text-right">Amount (INR)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {lineItems.map((item, idx) => (
                        <tr key={idx}>
                          <td className="py-3 px-3 text-slate-800 font-medium">
                            {item.description}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-900 tabular-nums">
                            {item.amount < 0 ? '-' : ''}₹{Math.abs(item.amount).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Totals Breakdown */}
                  <div className="mt-6 flex justify-end">
                    <div className="w-full sm:w-64 space-y-2 text-xs border-t border-slate-200 pt-4">
                      <div className="flex items-center justify-between text-slate-600">
                        <span>Subtotal:</span>
                        <span className="font-mono font-medium text-slate-900 tabular-nums">
                          ₹{invoice.subtotal.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-600">
                        <span>GST Tax (18%):</span>
                        <span className="font-mono font-medium text-slate-900 tabular-nums">
                          ₹{invoice.taxAmount.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm font-bold text-slate-950 border-t border-slate-300 pt-2.5">
                        <span>Total Amount:</span>
                        <span className="font-mono text-base text-slate-950 tabular-nums">
                          ₹{invoice.totalAmount.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* A4 Footer */}
              <div className="px-8 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>
                  Computer generated GST invoice from SubBill Subscription Billing System. Valid without signature.
                </span>
                <span className="font-mono text-slate-400">A4 Portrait · 18% GST</span>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Modal Footer */}
        <div className="bg-white border-t border-slate-200 px-6 py-3.5 flex items-center justify-between gap-4">
          <div className="text-xs text-slate-500">
            Ready to export <span className="font-mono font-semibold text-slate-800">{invoice.invoiceNumber}.pdf</span>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Close Preview
            </button>
            <button
              type="button"
              onClick={() => generateAndDownloadInvoicePdf(invoice)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-950 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
