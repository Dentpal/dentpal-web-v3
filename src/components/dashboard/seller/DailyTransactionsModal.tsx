/**
 * Daily Transactions Modal — seller view
 * Style-matched to admin OrderSummaryModal: teal-gradient header with
 * summary cards, sortable columns, pagination, and expandable per-order
 * detail. Used to verify the Financial Summary (per date) row figures.
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Order } from '@/types/order';
import { formatCurrency } from '@/utils/dashboard/formatters';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  X, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  ArrowUpDown, Package, PhilippinePeso, Printer, FileText, FileSpreadsheet,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

interface DailyTransactionsModalProps {
  dateLabel: string;
  orders: Order[];
  onClose: () => void;
}

type SortKey =
  | 'id' | 'customer' | 'time' | 'status'
  | 'subtotal' | 'paymentFee' | 'shippingFee' | 'shippingVat' | 'platformFee' | 'netPayout';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 10;

/* ─── Resolvers ──────────────────────────────────────────── */

const sellerFees = (o: Order): Record<string, unknown> | undefined => {
  const raw = (o as unknown as { sellerFeeBreakdowns?: unknown }).sellerFeeBreakdowns;
  if (!raw) return undefined;
  if (Array.isArray(raw)) return raw[0] as Record<string, unknown> | undefined;
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (obj['0'] && typeof obj['0'] === 'object') return obj['0'] as Record<string, unknown>;
    if ('platformFee' in obj || 'netPayoutToSeller' in obj) return obj;
  }
  return undefined;
};

const resolveSubtotal   = (o: Order) => Number(o.summary?.subtotal) || Number(o.total) || 0;
const resolvePaymentFee = (o: Order) => Number(o.feesBreakdown?.paymentProcessingFee) || 0;
const resolveShipping   = (o: Order) =>
  Number(sellerFees(o)?.shippingCost) || Number(o.summary?.sellerShippingCharge) || 0;
const resolveShippingVat = (o: Order) => Number(sellerFees(o)?.shippingVat) || 0;
const resolvePlatformFee = (o: Order) =>
  Number(sellerFees(o)?.platformFee) || Number(o.feesBreakdown?.platformFee) || 0;
const resolveNet = (o: Order) =>
  resolveSubtotal(o)
  - resolveShipping(o)
  - resolveShippingVat(o)
  - resolvePaymentFee(o)
  - resolvePlatformFee(o);

const netClass = (n: number) => (n < 0 ? 'text-red-600' : 'text-green-700');

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash_on_delivery: 'COD',
  cod: 'COD',
  gcash: 'G-Cash',
  'debit/credit': 'Debit/Credit',
  debit_credit: 'Debit/Credit',
  card: 'Debit/Credit',
  grab_pay: 'Grab Pay',
  grabpay: 'Grab Pay',
  paymaya: 'Maya',
  maya: 'Maya',
  shopee_pay: 'Shopee Pay',
  shopeepay: 'Shopee Pay',
};

const resolvePaymentMethod = (o: Order): string => {
  const anyO = o as unknown as Record<string, unknown>;
  const fees = (anyO.fees as Record<string, unknown>) || {};
  const raw = (
    (fees.paymentMethod as string) ||
    (o.feesBreakdown?.paymentMethod as string) ||
    ((anyO.paymentType as string) || '')
  ).toString().trim().toLowerCase();
  if (!raw) return '—';
  return PAYMENT_METHOD_LABELS[raw] || raw;
};

const resolveTime = (o: Order) => {
  const d = o.createdAt ? new Date(o.createdAt) : null;
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const resolveTimeMs = (o: Order) => {
  const d = o.createdAt ? new Date(o.createdAt).getTime() : 0;
  return Number.isNaN(d) ? 0 : d;
};

const resolveUserId = (o: Order): string => {
  const anyO = o as unknown as Record<string, unknown>;
  return ((anyO.userId as string) || (anyO.customerId as string) || '').toString();
};

const formatCustomerName = (firstName?: string, lastName?: string): string => {
  const first = (firstName || '').trim();
  const last = (lastName || '').trim();
  if (!first && !last) return '—';
  const initial = last ? `${last.charAt(0).toUpperCase()}.` : '';
  return [first, initial].filter(Boolean).join(' ');
};

const resolveOrderId = (o: Order) => {
  const anyO = o as unknown as Record<string, unknown>;
  return (anyO.id as string) || (anyO.orderId as string) || (anyO.orderNumber as string) || '';
};

const truncateId = (s: string) => (s && s.length > 11 ? s.slice(0, 11) : s);

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  completed:  { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Completed' },
  confirmed:  { bg: 'bg-green-100',   text: 'text-green-700',   label: 'Confirmed' },
  processing: { bg: 'bg-blue-100',    text: 'text-blue-700',    label: 'Processing' },
  to_ship:    { bg: 'bg-indigo-100',  text: 'text-indigo-700',  label: 'To Ship' },
  shipped:    { bg: 'bg-purple-100',  text: 'text-purple-700',  label: 'Shipped' },
  shipping:   { bg: 'bg-purple-100',  text: 'text-purple-700',  label: 'Shipping' },
  pending:    { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Pending' },
  refunded:   { bg: 'bg-rose-100',    text: 'text-rose-700',    label: 'Refunded' },
  returned:   { bg: 'bg-rose-100',    text: 'text-rose-700',    label: 'Returned' },
  cancelled:  { bg: 'bg-gray-100',    text: 'text-gray-600',    label: 'Cancelled' },
  expired:    { bg: 'bg-gray-100',    text: 'text-gray-600',    label: 'Expired' },
};
const getStatus = (s: string) => statusConfig[s] || { bg: 'bg-gray-100', text: 'text-gray-600', label: s || '—' };

/* ─── Component ──────────────────────────────────────────── */

export const DailyTransactionsModal = ({ dateLabel, orders, onClose }: DailyTransactionsModalProps) => {
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<SortKey>('time');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [printMenuOpen, setPrintMenuOpen] = useState(false);

  // Resolve buyer names from Firestore User collection
  useEffect(() => {
    const uniqueIds = Array.from(new Set(orders.map(resolveUserId).filter(Boolean)));
    if (uniqueIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(uniqueIds.map(async (uid) => {
        try {
          const snap = await getDoc(doc(db, 'User', uid));
          if (!snap.exists()) return [uid, '—'] as const;
          const d = snap.data() as { firstName?: string; lastName?: string };
          return [uid, formatCustomerName(d.firstName, d.lastName)] as const;
        } catch {
          return [uid, '—'] as const;
        }
      }));
      if (cancelled) return;
      setUserNames(prev => {
        const next = { ...prev };
        for (const [uid, name] of entries) next[uid] = name;
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [orders]);

  const customerOf = (o: Order) => {
    const uid = resolveUserId(o);
    return uid ? (userNames[uid] || '…') : '—';
  };

  /* ── sort ── */
  const sorted = useMemo(() => {
    const list = [...orders];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'id':          cmp = resolveOrderId(a).localeCompare(resolveOrderId(b)); break;
        case 'customer':    cmp = customerOf(a).localeCompare(customerOf(b)); break;
        case 'time':        cmp = resolveTimeMs(a) - resolveTimeMs(b); break;
        case 'status':      cmp = (a.status || '').localeCompare(b.status || ''); break;
        case 'subtotal':    cmp = resolveSubtotal(a) - resolveSubtotal(b); break;
        case 'paymentFee':  cmp = resolvePaymentFee(a) - resolvePaymentFee(b); break;
        case 'shippingFee': cmp = resolveShipping(a) - resolveShipping(b); break;
        case 'shippingVat': cmp = resolveShippingVat(a) - resolveShippingVat(b); break;
        case 'platformFee': cmp = resolvePlatformFee(a) - resolvePlatformFee(b); break;
        case 'netPayout':   cmp = resolveNet(a) - resolveNet(b); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [orders, sortKey, sortDir, userNames]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
    setPage(1);
  };

  /* ── totals (exclude cancelled / expired / processing, matching admin) ── */
  const EXCLUDED_STATUSES = new Set(['cancelled', 'expired', 'processing']);
  const totals = useMemo(() => {
    const successful = orders.filter(o => !EXCLUDED_STATUSES.has((o.status || '').toLowerCase()));
    const sub = successful.reduce((s, o) => s + resolveSubtotal(o), 0);
    const pf  = successful.reduce((s, o) => s + resolvePaymentFee(o), 0);
    const sf  = successful.reduce((s, o) => s + resolveShipping(o), 0);
    const sv  = successful.reduce((s, o) => s + resolveShippingVat(o), 0);
    const plf = successful.reduce((s, o) => s + resolvePlatformFee(o), 0);
    return { sub, pf, sf, sv, plf, net: sub - sf - sv - pf - plf, successfulCount: successful.length };
  }, [orders]);

  /* ── exports ── */
  const exportHeaders = ['Order ID', 'Customer', 'Time', 'Status', 'Items', 'Payment', 'Gross Sales', 'Payment Fee', 'Shipping Fee', 'Shipping VAT', 'Platform Fee', 'Net Payout'];

  const buildExportRows = () => sorted.map(o => [
    resolveOrderId(o),
    customerOf(o),
    resolveTime(o),
    getStatus((o.status || '').toLowerCase()).label,
    o.items?.map(it => `${it.name} x${it.quantity || 1}`).join('; ') || '—',
    resolvePaymentMethod(o),
    resolveSubtotal(o),
    resolvePaymentFee(o),
    resolveShipping(o),
    resolveShippingVat(o),
    resolvePlatformFee(o),
    resolveNet(o),
  ]);

  const fileStem = `transactions-${dateLabel.replace(/[^a-z0-9]/gi, '-')}`;

  const handleExportPdf = () => {
    // jsPDF's default Helvetica doesn't carry U+20B1 (₱) — substitute ASCII "PHP" prefix.
    const formatPdfAmount = (n: number) =>
      'PHP ' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(14);
    doc.text(`Daily Transactions — ${dateLabel}`, 14, 15);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`${orders.length} ${orders.length === 1 ? 'order' : 'orders'}  |  Generated: ${new Date().toLocaleString('en-US')}`, 14, 21);
    doc.text(`Gross: ${formatPdfAmount(totals.sub)}   Shipping: ${formatPdfAmount(totals.sf)}   Net Payout: ${formatPdfAmount(totals.net)}`, 14, 26);

    const rows = buildExportRows().map(r => [
      ...r.slice(0, 6),
      formatPdfAmount(r[6] as number),
      formatPdfAmount(r[7] as number),
      formatPdfAmount(r[8] as number),
      formatPdfAmount(r[9] as number),
      formatPdfAmount(r[10] as number),
      formatPdfAmount(r[11] as number),
    ]);

    autoTable(doc, {
      startY: 30,
      head: [exportHeaders],
      body: rows,
      headStyles: { fillColor: [13, 148, 136], fontSize: 7, cellPadding: 2 },
      bodyStyles: { fontSize: 7, cellPadding: 2 },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      columnStyles: { 0: { cellWidth: 28 }, 4: { cellWidth: 50 } },
    });

    doc.save(`${fileStem}-${new Date().toISOString().slice(0, 10)}.pdf`);
    setPrintMenuOpen(false);
  };

  const handleExportExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Transactions');

    ws.addRow([`Daily Transactions — ${dateLabel}`]);
    ws.addRow([`${orders.length} orders`, `Generated: ${new Date().toLocaleString('en-US')}`]);
    ws.addRow([]);

    const hRow = ws.addRow(exportHeaders);
    hRow.eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D9488' } };
    });

    buildExportRows().forEach(r => {
      const row = ws.addRow(r);
      [7, 8, 9, 10, 11, 12].forEach(ci => { row.getCell(ci).numFmt = '#,##0.00'; });
    });

    ws.addRow([]);
    const tRow = ws.addRow(['', '', '', '', '', 'TOTAL', totals.sub, totals.pf, totals.sf, totals.sv, totals.plf, totals.net]);
    tRow.font = { bold: true };
    [7, 8, 9, 10, 11, 12].forEach(ci => { tRow.getCell(ci).numFmt = '#,##0.00'; });

    ws.columns.forEach(col => {
      let max = 10;
      col.eachCell?.({ includeEmpty: false }, cell => { const l = String(cell.value || '').length; if (l > max) max = l; });
      col.width = Math.min(max + 2, 40);
    });

    const buf = await wb.xlsx.writeBuffer();
    saveAs(
      new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `${fileStem}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
    setPrintMenuOpen(false);
  };

  /* ── sortable header cell ── */
  const Th = ({ k, children, align }: { k: SortKey; children: React.ReactNode; align?: string }) => (
    <th
      className={`px-3 py-2.5 text-[11px] font-semibold tracking-wide cursor-pointer select-none hover:bg-teal-50 transition whitespace-nowrap ${align || 'text-left'} sticky top-0 bg-gray-100 z-10 border-b border-gray-300`}
      onClick={() => toggleSort(k)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortKey === k
          ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-teal-600" /> : <ChevronDown className="w-3 h-3 text-teal-600" />)
          : <ArrowUpDown className="w-3 h-3 text-gray-400" />}
      </span>
    </th>
  );

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col">

          {/* ── Header ── */}
          <div className="bg-gradient-to-r from-teal-600 to-teal-700 text-white px-6 py-5 flex-shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold">Transactions</h3>
                <p className="text-sm text-teal-100 mt-1">{dateLabel} &bull; {orders.length} {orders.length === 1 ? 'order' : 'orders'}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    onClick={() => setPrintMenuOpen(o => !o)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-full bg-white/20 hover:bg-white/30 text-white transition"
                    aria-haspopup="menu"
                    aria-expanded={printMenuOpen}
                  >
                    <Printer className="w-4 h-4" />
                    Print
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  {printMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setPrintMenuOpen(false)} />
                      <div
                        role="menu"
                        className="absolute right-0 top-full mt-1 w-44 bg-white rounded-md shadow-lg border border-gray-200 z-20 overflow-hidden"
                      >
                        <button
                          onClick={handleExportPdf}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition text-left"
                        >
                          <FileText className="w-3.5 h-3.5 text-rose-600" />
                          Print as PDF
                        </button>
                        <button
                          onClick={handleExportExcel}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition text-left border-t border-gray-100"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                          Print as Excel
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <button onClick={onClose} className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-4 gap-3 mt-4">
              {[
                { icon: Package,         label: 'Total Orders', value: orders.length.toLocaleString() },
                { icon: PhilippinePeso,  label: 'Gross Sales',  value: formatCurrency(totals.sub) },
                { icon: PhilippinePeso,  label: 'Shipping',     value: formatCurrency(totals.sf) },
                { icon: PhilippinePeso,  label: 'Net Payout',   value: formatCurrency(totals.net) },
              ].map((c, i) => (
                <div key={i} className="bg-white/10 backdrop-blur-sm rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <c.icon className="w-4 h-4 text-teal-100" />
                    <span className="text-[10px] text-teal-100 font-medium">{c.label}</span>
                  </div>
                  <div className="text-lg font-bold">{c.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Table ── */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs border-collapse" style={{ minWidth: 1100, tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 32 }} />     {/* expand */}
                <col style={{ width: 112 }} />    {/* order id */}
                <col style={{ width: 120 }} />    {/* customer */}
                <col style={{ width: 78 }} />     {/* time */}
                <col style={{ width: 92 }} />     {/* status */}
                <col />                           {/* items - flex */}
                <col style={{ width: 100 }} />    {/* payment */}
                <col style={{ width: 96 }} />     {/* gross */}
                <col style={{ width: 84 }} />     {/* pmt fee */}
                <col style={{ width: 92 }} />     {/* ship fee */}
                <col style={{ width: 84 }} />     {/* ship vat */}
                <col style={{ width: 88 }} />     {/* plat fee */}
                <col style={{ width: 96 }} />     {/* net */}
              </colgroup>
              <thead>
                <tr>
                  <th className="sticky top-0 bg-gray-100 z-10 border-b border-gray-300 px-2 py-2.5" />
                  <Th k="id">Order ID</Th>
                  <Th k="customer">Customer</Th>
                  <Th k="time">Time</Th>
                  <Th k="status">Status</Th>
                  <th className="sticky top-0 bg-gray-100 z-10 border-b border-gray-300 px-3 py-2.5 text-left text-[11px] font-semibold whitespace-nowrap">Items</th>
                  <th className="sticky top-0 bg-gray-100 z-10 border-b border-gray-300 px-3 py-2.5 text-left text-[11px] font-semibold whitespace-nowrap">Payment</th>
                  <Th k="subtotal" align="text-right">Gross Sales</Th>
                  <Th k="paymentFee" align="text-right">Pmt Fee</Th>
                  <Th k="shippingFee" align="text-right">Ship Fee</Th>
                  <Th k="shippingVat" align="text-right">Ship VAT</Th>
                  <Th k="platformFee" align="text-right">Plat Fee</Th>
                  <Th k="netPayout" align="text-right">Net Payout</Th>
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 && (
                  <tr><td colSpan={13} className="text-center py-12 text-gray-400">No orders for this date.</td></tr>
                )}
                {paged.map((o, i) => {
                  const id = resolveOrderId(o);
                  const st = getStatus((o.status || '').toLowerCase());
                  const isExp = expandedId === id;
                  return (
                    <Fragment key={id || i}>
                      <tr
                        className={`cursor-pointer transition-colors hover:bg-teal-50/40 border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`}
                        onClick={() => setExpandedId(isExp ? null : (id || null))}
                      >
                        <td className="px-2 py-2.5 text-center align-middle">
                          {isExp
                            ? <ChevronUp className="w-3.5 h-3.5 text-gray-500 mx-auto" />
                            : <ChevronDown className="w-3.5 h-3.5 text-gray-400 mx-auto" />}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-gray-600 truncate align-middle" title={id}>{truncateId(id)}</td>
                        <td className="px-3 py-2.5 text-gray-800 truncate align-middle">{customerOf(o)}</td>
                        <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap align-middle">{resolveTime(o)}</td>
                        <td className="px-3 py-2.5 align-middle">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${st.bg} ${st.text}`}>{st.label}</span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-600 truncate align-middle">
                          {o.items?.map(it => `${it.name} x${it.quantity || 1}`).join(', ') || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600 truncate align-middle">{resolvePaymentMethod(o)}</td>
                        <td className="px-3 py-2.5 text-right font-medium text-gray-900 whitespace-nowrap align-middle">{formatCurrency(resolveSubtotal(o))}</td>
                        <td className="px-3 py-2.5 text-right text-red-600 whitespace-nowrap align-middle">{formatCurrency(resolvePaymentFee(o))}</td>
                        <td className="px-3 py-2.5 text-right text-amber-700 whitespace-nowrap align-middle">{formatCurrency(resolveShipping(o))}</td>
                        <td className="px-3 py-2.5 text-right text-amber-700 whitespace-nowrap align-middle">{formatCurrency(resolveShippingVat(o))}</td>
                        <td className="px-3 py-2.5 text-right text-red-600 whitespace-nowrap align-middle">{formatCurrency(resolvePlatformFee(o))}</td>
                        <td className={`px-3 py-2.5 text-right font-semibold whitespace-nowrap align-middle ${netClass(resolveNet(o))}`}>{formatCurrency(resolveNet(o))}</td>
                      </tr>

                      {isExp && (
                        <tr className="border-b border-blue-100">
                          <td colSpan={13} className="p-0">
                            <div className="bg-blue-50/50 border-t border-blue-100 px-8 py-4 space-y-3">
                              {o.items && o.items.length > 0 && (
                                <div>
                                  <h4 className="text-[11px] font-semibold text-gray-700 mb-2">Order Items ({o.items.length})</h4>
                                  <div className="overflow-x-auto rounded border border-blue-200">
                                    <table className="w-full text-[11px]">
                                      <thead>
                                        <tr className="bg-blue-100/80 text-blue-800">
                                          <th className="px-3 py-1.5 text-left font-semibold">#</th>
                                          <th className="px-3 py-1.5 text-left font-semibold">Item</th>
                                          <th className="px-3 py-1.5 text-right font-semibold">Price</th>
                                          <th className="px-3 py-1.5 text-center font-semibold">Qty</th>
                                          <th className="px-3 py-1.5 text-right font-semibold">Line Total</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {o.items.map((it, idx) => (
                                          <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-blue-50/40'}>
                                            <td className="px-3 py-1.5 text-gray-500">{idx + 1}</td>
                                            <td className="px-3 py-1.5 text-gray-900 font-medium">{it.name || 'Unknown'}</td>
                                            <td className="px-3 py-1.5 text-right">{formatCurrency(Number(it.price) || 0)}</td>
                                            <td className="px-3 py-1.5 text-center">{it.quantity || 1}</td>
                                            <td className="px-3 py-1.5 text-right font-medium">{formatCurrency((Number(it.price) || 0) * (it.quantity || 1))}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              <div className="grid grid-cols-2 gap-3 text-[11px]">
                                <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-1.5">
                                  <div className="font-semibold text-gray-700 mb-1">Financials</div>
                                  <div className="flex justify-between"><span className="text-gray-500">Gross Sales</span><span>{formatCurrency(resolveSubtotal(o))}</span></div>
                                  <div className="flex justify-between text-amber-700"><span>Shipping</span><span>-{formatCurrency(resolveShipping(o))}</span></div>
                                  <div className="flex justify-between text-amber-700"><span>Shipping VAT</span><span>-{formatCurrency(resolveShippingVat(o))}</span></div>
                                  <div className="flex justify-between text-red-600"><span>Payment Fee</span><span>-{formatCurrency(resolvePaymentFee(o))}</span></div>
                                  <div className="flex justify-between text-red-600"><span>Platform Fee</span><span>-{formatCurrency(resolvePlatformFee(o))}</span></div>
                                  <div className={`flex justify-between pt-1.5 border-t font-semibold ${netClass(resolveNet(o))}`}><span>Net Payout</span><span>{formatCurrency(resolveNet(o))}</span></div>
                                </div>
                                <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-1.5">
                                  <div className="font-semibold text-gray-700 mb-1">Payment</div>
                                  <div className="flex justify-between"><span className="text-gray-500">Method</span><span>{resolvePaymentMethod(o)}</span></div>
                                  <div className="flex justify-between"><span className="text-gray-500">Status</span><span className="capitalize">{(o.status || '').replace(/_/g, ' ') || '—'}</span></div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              {sorted.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-100 font-semibold border-t-2 border-gray-300">
                    <td colSpan={7} className="px-3 py-2.5 text-right text-[11px] text-gray-700">
                      TOTAL ({totals.successfulCount} successful order{totals.successfulCount !== 1 ? 's' : ''})
                    </td>
                    <td className="px-3 py-2.5 text-right text-[11px]">{formatCurrency(totals.sub)}</td>
                    <td className="px-3 py-2.5 text-right text-[11px] text-red-600">{formatCurrency(totals.pf)}</td>
                    <td className="px-3 py-2.5 text-right text-[11px] text-amber-700">{formatCurrency(totals.sf)}</td>
                    <td className="px-3 py-2.5 text-right text-[11px] text-amber-700">{formatCurrency(totals.sv)}</td>
                    <td className="px-3 py-2.5 text-right text-[11px] text-red-600">{formatCurrency(totals.plf)}</td>
                    <td className={`px-3 py-2.5 text-right text-[11px] ${netClass(totals.net)}`}>{formatCurrency(totals.net)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* ── Footer / pagination ── */}
          <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between gap-3 flex-shrink-0">
            <div className="text-xs text-gray-600">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 bg-green-500 rounded-full" />
                Net Payout = Gross Sales − (Payment Fee + Shipping Fee + Shipping VAT + Platform Fee)
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-xs text-gray-500">
                {sorted.length === 0
                  ? 'Showing 0 orders'
                  : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, sorted.length)} of ${sorted.length} orders`}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-1.5 rounded border border-gray-200 disabled:opacity-40 hover:bg-white"
                >
                  <ChevronLeft className="w-4 h-4 text-gray-600" />
                </button>
                {Array.from({ length: totalPages }, (_, idx) => idx + 1).map(n => (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className={`w-7 h-7 text-xs rounded border ${n === page ? 'bg-teal-600 text-white border-teal-600' : 'border-gray-200 text-gray-700 hover:bg-white'}`}
                  >
                    {n}
                  </button>
                ))}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded border border-gray-200 disabled:opacity-40 hover:bg-white"
                >
                  <ChevronRight className="w-4 h-4 text-gray-600" />
                </button>
              </div>
              <button
                onClick={onClose}
                className="px-4 py-1.5 text-xs font-medium rounded-md bg-teal-600 text-white hover:bg-teal-700 transition"
              >
                Close
              </button>
            </div>
          </div>

        </div>
      </div>
    </>
  );
};

export default DailyTransactionsModal;
