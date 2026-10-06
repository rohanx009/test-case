import { jsPDF } from 'jspdf';

export interface InvoicePdfData {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  status: string;
  customerName: string;
  companyName: string;
  customerEmail: string;
  planName: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  itemsJson: string;
}

export interface InvoiceLineItem {
  description: string;
  amount: number;
}

export function parseInvoiceLineItems(inv: InvoicePdfData): InvoiceLineItem[] {
  let items: InvoiceLineItem[] = [];
  try {
    items = JSON.parse(inv.itemsJson || '[]');
  } catch {
    items = [];
  }

  if (!Array.isArray(items) || items.length === 0) {
    items = [
      { description: `${inv.planName} Subscription Fee`, amount: inv.subtotal },
      { description: 'GST (18%)', amount: inv.taxAmount },
    ];
  }
  return items;
}

export function buildInvoicePdfDoc(inv: InvoicePdfData): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // Top Header Band
  doc.setFillColor(2, 6, 23); // slate-950
  doc.rect(0, 0, 210, 38, 'F');

  // Brand Box [S]
  doc.setFillColor(79, 70, 229); // indigo-600
  doc.roundedRect(16, 11, 9, 9, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('S', 20.5, 17.2, { align: 'center' });

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('SubBill', 28, 17.5);

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225);
  doc.text('TAX INVOICE / GST RECEIPT', 16, 27);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(inv.invoiceNumber, 194, 17.5, { align: 'right' });

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Status: ${inv.status.toUpperCase()}`, 194, 26, { align: 'right' });

  // Billing Info Section
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Billed To:', 16, 52);

  doc.setFont('helvetica', 'normal');
  doc.text(inv.companyName || inv.customerName, 16, 58);
  doc.text(inv.customerName, 16, 64);
  doc.text(inv.customerEmail, 16, 70);

  doc.setFont('helvetica', 'bold');
  doc.text('Invoice Metadata:', 130, 52);
  doc.setFont('helvetica', 'normal');
  doc.text(`Invoice Date: ${new Date(inv.invoiceDate).toLocaleDateString()}`, 130, 58);
  doc.text(`Due Date: ${new Date(inv.dueDate).toLocaleDateString()}`, 130, 64);
  doc.text(`Subscription Plan: ${inv.planName}`, 130, 70);

  // Table Header
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.rect(16, 82, 178, 10, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Description', 20, 88.5);
  doc.text('Amount (INR)', 190, 88.5, { align: 'right' });

  let yPos = 100;
  const items = parseInvoiceLineItems(inv);

  doc.setFont('helvetica', 'normal');
  for (const item of items) {
    doc.text(item.description, 20, yPos);
    const formatted = `${item.amount < 0 ? '-' : ''}Rs. ${Math.abs(item.amount).toLocaleString()}`;
    doc.text(formatted, 190, yPos, { align: 'right' });
    doc.line(16, yPos + 4, 194, yPos + 4);
    yPos += 11;
  }

  // Totals Summary Box
  yPos += 6;
  doc.setFont('helvetica', 'normal');
  doc.text('Subtotal:', 135, yPos);
  doc.text(`Rs. ${inv.subtotal.toLocaleString()}`, 190, yPos, { align: 'right' });

  yPos += 8;
  doc.text('GST Tax (18%):', 135, yPos);
  doc.text(`Rs. ${inv.taxAmount.toLocaleString()}`, 190, yPos, { align: 'right' });

  yPos += 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Total Amount:', 135, yPos);
  doc.text(`Rs. ${inv.totalAmount.toLocaleString()}`, 190, yPos, { align: 'right' });

  // Footer note
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(
    'Computer generated GST invoice from SubBill Subscription Billing System. Valid without signature.',
    16,
    275
  );

  return doc;
}

export function generateInvoicePdfBlobUrl(inv: InvoicePdfData): string {
  const doc = buildInvoicePdfDoc(inv);
  const blob = doc.output('blob');
  return URL.createObjectURL(blob);
}

export function generateAndDownloadInvoicePdf(inv: InvoicePdfData) {
  const doc = buildInvoicePdfDoc(inv);
  doc.save(`${inv.invoiceNumber}.pdf`);
}
