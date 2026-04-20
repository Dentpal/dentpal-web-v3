/**
 * Order Summary Modal – Excel-style table view with sorting, search,
 * pagination, row expansion, and PDF / Excel / Print exports.
 */

import { useMemo, useState } from 'react';
import { Order } from '@/types/order';
import { formatCurrency, formatDate } from '@/utils/dashboard/formatters';
import {
  X, Search, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  ArrowUpDown, Package, DollarSign, Printer, FileText, FileSpreadsheet,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

/* ─── Types ──────────────────────────────────────────────── */

interface SellerMetric {
  sellerId: string;
  sellerName: string;
  province: string;
  city: string;
  totalOrders: number;
  totalRevenue: number;
  totalFees: number;
  netPayout: number;
  avgOrderValue: number;
  orders: Order[];
}

interface OrderSummaryModalProps {
  seller: SellerMetric;
  onClose: () => void;
}

type SortKey = 'id' | 'customer' | 'date' | 'status' | 'subtotal' | 'paymentFee' | 'platformFee' | 'netPayout';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 10;

/* ─── Helpers ────────────────────────────────────────────── */

const resolveDate = (o: Order) => new Date(o.createdAt || o.timestamp || '');

const resolveSubtotal   = (o: Order) => Number(o.summary?.subtotal)  || o.total || 0;
const resolvePaymentFee = (o: Order) => Number(o.feesBreakdown?.paymentProcessingFee) || 0;
const resolveShipping   = (o: Order) => Number(o.summary?.sellerShippingCharge) || 0;
const resolvePlatformFee= (o: Order) => Number(o.feesBreakdown?.platformFee) || 0;
const resolveNet = (o: Order) => resolveSubtotal(o) - resolvePaymentFee(o) - resolveShipping(o) - resolvePlatformFee(o);

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  completed:  { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Completed' },
  confirmed:  { bg: 'bg-green-100',   text: 'text-green-700',   label: 'Confirmed' },
  processing: { bg: 'bg-blue-100',    text: 'text-blue-700',    label: 'Processing' },
  to_ship:    { bg: 'bg-indigo-100',   text: 'text-indigo-700',  label: 'To Ship' },
  shipped:    { bg: 'bg-purple-100',   text: 'text-purple-700',  label: 'Shipped' },
  shipping:   { bg: 'bg-purple-100',   text: 'text-purple-700',  label: 'Shipping' },
  pending:    { bg: 'bg-amber-100',    text: 'text-amber-700',   label: 'Pending' },
  refunded:   { bg: 'bg-rose-100',     text: 'text-rose-700',    label: 'Refunded' },
  returned:   { bg: 'bg-rose-100',     text: 'text-rose-700',    label: 'Returned' },
  cancelled:  { bg: 'bg-gray-100',     text: 'text-gray-600',    label: 'Cancelled' },
};

const getStatus = (s: string) => statusConfig[s] || { bg: 'bg-gray-100', text: 'text-gray-600', label: s };

/* ─── Component ──────────────────────────────────────────── */

export const OrderSummaryModal = ({ seller, onClose }: OrderSummaryModalProps) => {
  const [search, setSearch]         = useState('');
  const [sortKey, setSortKey]       = useState<SortKey>('date');
  const [sortDir, setSortDir]       = useState<SortDir>('desc');
  const [page, setPage]             = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /* ── filter + sort ── */
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = seller.orders;
    if (q) {
      list = list.filter(o =>
        o.id?.toLowerCase().includes(q) ||
        o.customer?.name?.toLowerCase().includes(q) ||
        o.status?.toLowerCase().includes(q) ||
        o.feesBreakdown?.paymentMethod?.toLowerCase().includes(q) ||
        o.paymentType?.toLowerCase().includes(q)
      );
    }
    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'id':         cmp = (a.id || '').localeCompare(b.id || ''); break;
        case 'customer':   cmp = (a.customer?.name || '').localeCompare(b.customer?.name || ''); break;
        case 'date':       cmp = resolveDate(a).getTime() - resolveDate(b).getTime(); break;
        case 'status':     cmp = (a.status || '').localeCompare(b.status || ''); break;
        case 'subtotal':   cmp = resolveSubtotal(a) - resolveSubtotal(b); break;
        case 'paymentFee': cmp = resolvePaymentFee(a) - resolvePaymentFee(b); break;
        case 'platformFee':cmp = resolvePlatformFee(a) - resolvePlatformFee(b); break;
        case 'netPayout':  cmp = resolveNet(a) - resolveNet(b); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [seller.orders, search, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
    setPage(1);
  };

  /* ── totals row ── */
  const totals = useMemo(() => {
    const sub = filtered.reduce((s, o) => s + resolveSubtotal(o), 0);
    const pf  = filtered.reduce((s, o) => s + resolvePaymentFee(o), 0);
    const sf  = filtered.reduce((s, o) => s + resolveShipping(o), 0);
    const plf = filtered.reduce((s, o) => s + resolvePlatformFee(o), 0);
    return { sub, pf, sf, plf, net: sub - pf - sf - plf };
  }, [filtered]);

  /* ── exports ── */
  const buildRows = () => filtered.map(o => [
    o.id || '',
    o.customer?.name || '—',
    formatDate(o.createdAt || o.timestamp || ''),
    getStatus(o.status).label,
    o.items?.map(i => `${i.name} x${i.quantity || 1}`).join('; ') || '—',
    o.feesBreakdown?.paymentMethod || o.paymentType || '—',
    resolveSubtotal(o),
    resolvePaymentFee(o),
    resolvePlatformFee(o),
    resolveNet(o),
  ]);

  const headers = ['Order ID', 'Customer', 'Date', 'Status', 'Items', 'Payment', 'Subtotal', 'Payment Fee', 'Platform Fee', 'Net Payout'];

  const handleExportPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(14);
    doc.text(`Order Summary – ${seller.sellerName}`, 14, 15);
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`${seller.province}, ${seller.city}  |  ${filtered.length} orders  |  Generated: ${new Date().toLocaleString('en-US')}`, 14, 21);
    doc.text(`Gross: ${formatCurrency(totals.sub)}   Payment Fees: ${formatCurrency(totals.pf)}   Platform Fees: ${formatCurrency(totals.plf)}   Net: ${formatCurrency(totals.net)}`, 14, 26);

    const rows = buildRows().map(r => [...r.slice(0, 6), formatCurrency(r[6] as number), formatCurrency(r[7] as number), formatCurrency(r[8] as number), formatCurrency(r[9] as number)]);

    autoTable(doc, {
      startY: 30,
      head: [headers],
      body: rows,
      headStyles: { fillColor: [13, 148, 136], fontSize: 7, cellPadding: 2 },
      bodyStyles: { fontSize: 7, cellPadding: 2 },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      columnStyles: { 0: { cellWidth: 28 }, 4: { cellWidth: 50 } },
    });

    doc.save(`order-summary-${seller.sellerName.replace(/[^a-z0-9]/gi, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const handleExportExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Orders');

    ws.addRow([`Order Summary – ${seller.sellerName}`]);
    ws.addRow([`${seller.province}, ${seller.city}`, `${filtered.length} orders`, `Generated: ${new Date().toLocaleString('en-US')}`]);
    ws.addRow([]);

    const hRow = ws.addRow(headers);
    hRow.eachCell(c => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D9488' } };
    });

    buildRows().forEach(r => {
      const row = ws.addRow([...r.slice(0, 6), ...r.slice(6)]);
      [7, 8, 9, 10].forEach(ci => { row.getCell(ci).numFmt = '#,##0.00'; });
    });

    // Totals
    ws.addRow([]);
    const tRow = ws.addRow(['', '', '', '', '', 'TOTAL', totals.sub, totals.pf, totals.plf, totals.net]);
    tRow.font = { bold: true };
    [7, 8, 9, 10].forEach(ci => { tRow.getCell(ci).numFmt = '#,##0.00'; });

    ws.columns.forEach(col => {
      let max = 10;
      col.eachCell?.({ includeEmpty: false }, cell => { const l = String(cell.value || '').length; if (l > max) max = l; });
      col.width = Math.min(max + 2, 40);
    });

    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `order-summary-${seller.sellerName.replace(/[^a-z0-9]/gi, '-')}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handlePrint = () => {
    const rows = buildRows().map(r => `<tr>${
      [...r.slice(0, 6), formatCurrency(r[6] as number), formatCurrency(r[7] as number), formatCurrency(r[8] as number), formatCurrency(r[9] as number)]
        .map((c, i) => `<td style="padding:4px 8px;border:1px solid #ddd;${i >= 6 ? 'text-align:right' : ''}">${c}</td>`).join('')
    }</tr>`).join('');

    const html = `<!DOCTYPE html><html><head><title>Order Summary – ${seller.sellerName}</title>
    <style>body{font-family:Arial,sans-serif;padding:20px}table{border-collapse:collapse;width:100%}
    th{background:#0D9488;color:#fff;padding:6px 8px;text-align:left;font-size:11px}
    td{font-size:11px}tr:nth-child(even){background:#f5f5f5}
    @media print{button{display:none}}</style></head>
    <body><h2>Order Summary – ${seller.sellerName}</h2>
    <p style="color:#666;font-size:12px">${seller.province}, ${seller.city} | ${filtered.length} orders | ${new Date().toLocaleString('en-US')}</p>
    <p style="font-size:12px"><b>Gross:</b> ${formatCurrency(totals.sub)} &nbsp; <b>Payment Fees:</b> ${formatCurrency(totals.pf)} &nbsp; <b>Platform Fees:</b> ${formatCurrency(totals.plf)} &nbsp; <b>Net:</b> ${formatCurrency(totals.net)}</p>
    <table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
    <script>window.print();</script></body></html>`;

    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
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
                <h3 className="text-xl font-bold">Order Summary</h3>
                <p className="text-sm text-teal-100 mt-1">{seller.sellerName} &bull; {seller.province}, {seller.city}</p>
              </div>
              <button onClick={onClose} className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-4 gap-3 mt-4">
              {[
                { icon: Package,    label: 'Total Orders',  value: filtered.length.toLocaleString() },
                { icon: DollarSign, label: 'Gross Revenue', value: formatCurrency(totals.sub) },
                { icon: DollarSign, label: 'Total Fees',    value: formatCurrency(totals.pf + totals.sf + totals.plf) },
                { icon: DollarSign, label: 'Net Payout',    value: formatCurrency(totals.net) },
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

          {/* ── Toolbar ── */}
          <div className="px-6 py-3 border-b border-gray-200 flex items-center justify-between gap-3 flex-shrink-0 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search order ID, customer, status…"
                className="w-full pl-9 pr-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-400 focus:border-teal-400 outline-none"
              />
            </div>
            {/* Export buttons */}
            <div className="flex items-center gap-2">
              <button onClick={handleExportPdf} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                <FileText className="w-3.5 h-3.5 text-red-500" /> PDF
              </button>
              <button onClick={handleExportExcel} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                <FileSpreadsheet className="w-3.5 h-3.5 text-green-600" /> Excel
              </button>
              <button onClick={handlePrint} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                <Printer className="w-3.5 h-3.5 text-blue-500" /> Print
              </button>
            </div>
          </div>

          {/* ── Table ── */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs border-collapse" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th className="sticky top-0 bg-gray-100 z-10 border-b border-gray-300 px-3 py-2.5 text-left text-[11px] font-semibold w-6" />
                  <Th k="id">Order ID</Th>
                  <Th k="customer">Customer</Th>
                  <Th k="date">Date</Th>
                  <Th k="status">Status</Th>
                  <th className="sticky top-0 bg-gray-100 z-10 border-b border-gray-300 px-3 py-2.5 text-left text-[11px] font-semibold whitespace-nowrap">Items</th>
                  <th className="sticky top-0 bg-gray-100 z-10 border-b border-gray-300 px-3 py-2.5 text-left text-[11px] font-semibold whitespace-nowrap">Payment</th>
                  <Th k="subtotal" align="text-right">Subtotal</Th>
                  <Th k="paymentFee" align="text-right">Pmt Fee</Th>
                  <Th k="platformFee" align="text-right">Plat Fee</Th>
                  <Th k="netPayout" align="text-right">Net Payout</Th>
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 && (
                  <tr><td colSpan={11} className="text-center py-12 text-gray-400">No orders match your search.</td></tr>
                )}
                {paged.map((o, i) => {
                  const st = getStatus(o.status);
                  const isExp = expandedId === o.id;
                  return (
                    <tr key={o.id}>
                      <td colSpan={11} className="p-0 border-b border-gray-100">
                        {/* Main Row */}
                        <div
                          className={`grid cursor-pointer transition hover:bg-teal-50/40 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`}
                          style={{ gridTemplateColumns: '24px 1fr 1fr 100px 90px 1fr 90px 80px 80px 80px 90px' }}
                          onClick={() => setExpandedId(isExp ? null : (o.id || null))}
                        >
                          <div className="flex items-center justify-center py-2.5">
                            {isExp ? <ChevronUp className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                          </div>
                          <div className="px-3 py-2.5 font-mono text-gray-600 truncate">{(o.id || '').slice(0, 12)}</div>
                          <div className="px-3 py-2.5 text-gray-800 truncate">{o.customer?.name || '—'}</div>
                          <div className="px-3 py-2.5 text-gray-600">{formatDate(o.createdAt || o.timestamp || '')}</div>
                          <div className="px-3 py-2.5">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${st.bg} ${st.text}`}>{st.label}</span>
                          </div>
                          <div className="px-3 py-2.5 text-gray-600 truncate">{o.items?.map(it => `${it.name} x${it.quantity || 1}`).join(', ') || '—'}</div>
                          <div className="px-3 py-2.5 text-gray-600 truncate">{o.feesBreakdown?.paymentMethod || o.paymentType || '—'}</div>
                          <div className="px-3 py-2.5 text-right font-medium text-gray-900">{formatCurrency(resolveSubtotal(o))}</div>
                          <div className="px-3 py-2.5 text-right text-red-600">{formatCurrency(resolvePaymentFee(o))}</div>
                          <div className="px-3 py-2.5 text-right text-red-600">{formatCurrency(resolvePlatformFee(o))}</div>
                          <div className="px-3 py-2.5 text-right font-semibold text-green-700">{formatCurrency(resolveNet(o))}</div>
                        </div>

                        {/* Expanded Detail */}
                        {isExp && (
                          <div className="bg-blue-50/50 border-t border-blue-100 px-8 py-4 space-y-3 animate-fade-in">
                            {/* Items sub-table */}
                            {o.items && o.items.length > 0 && (
                              <div>
                                <h4 className="text-[11px] font-semibold text-gray-700 mb-2">Order Items ({o.items.length})</h4>
                                <div className="overflow-x-auto rounded border border-blue-200">
                                  <table className="w-full text-[11px]">
                                    <thead>
                                      <tr className="bg-blue-100/80 text-blue-800">
                                        <th className="px-3 py-1.5 text-left font-semibold">#</th>
                                        <th className="px-3 py-1.5 text-left font-semibold">Item</th>
                                        <th className="px-3 py-1.5 text-left font-semibold">Category</th>
                                        <th className="px-3 py-1.5 text-right font-semibold">Price</th>
                                        <th className="px-3 py-1.5 text-center font-semibold">Qty</th>
                                        <th className="px-3 py-1.5 text-right font-semibold">Line Total</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {o.items.map((it: any, idx: number) => (
                                        <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-blue-50/40'}>
                                          <td className="px-3 py-1.5 text-gray-500">{idx + 1}</td>
                                          <td className="px-3 py-1.5 text-gray-900 font-medium">{it.name || 'Unknown'}</td>
                                          <td className="px-3 py-1.5 text-gray-600">{it.category || '—'}</td>
                                          <td className="px-3 py-1.5 text-right">{formatCurrency(it.price || 0)}</td>
                                          <td className="px-3 py-1.5 text-center">{it.quantity || 1}</td>
                                          <td className="px-3 py-1.5 text-right font-medium">{formatCurrency((it.price || 0) * (it.quantity || 1))}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}

                            {/* Financial + Shipping */}
                            <div className="grid grid-cols-3 gap-3 text-[11px]">
                              <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-1.5">
                                <div className="font-semibold text-gray-700 mb-1">Financials</div>
                                <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatCurrency(resolveSubtotal(o))}</span></div>
                                <div className="flex justify-between"><span className="text-gray-500">Shipping</span><span>{formatCurrency(resolveShipping(o))}</span></div>
                                <div className="flex justify-between text-red-600"><span>Payment Fee</span><span>-{formatCurrency(resolvePaymentFee(o))}</span></div>
                                <div className="flex justify-between text-red-600"><span>Platform Fee</span><span>-{formatCurrency(resolvePlatformFee(o))}</span></div>
                                <div className="flex justify-between pt-1.5 border-t font-semibold text-green-700"><span>Net Payout</span><span>{formatCurrency(resolveNet(o))}</span></div>
                              </div>
                              <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-1.5">
                                <div className="font-semibold text-gray-700 mb-1">Payment</div>
                                <div className="flex justify-between"><span className="text-gray-500">Method</span><span>{o.feesBreakdown?.paymentMethod || o.paymentType || '—'}</span></div>
                                <div className="flex justify-between"><span className="text-gray-500">Status</span><span className="capitalize">{(o as any).paymongo?.paymentStatus || o.status.replace(/_/g, ' ')}</span></div>
                              </div>
                              {o.region && (
                                <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-1.5">
                                  <div className="font-semibold text-gray-700 mb-1">Location</div>
                                  <div className="flex justify-between"><span className="text-gray-500">Municipality</span><span>{o.region.municipality || '—'}</span></div>
                                  <div className="flex justify-between"><span className="text-gray-500">Province</span><span>{o.region.province || '—'}</span></div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Totals row */}
              {filtered.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-100 font-semibold border-t-2 border-gray-300">
                    <td colSpan={7} className="px-3 py-2.5 text-right text-[11px] text-gray-700">TOTAL ({filtered.length} orders)</td>
                    <td className="px-3 py-2.5 text-right text-[11px]">{formatCurrency(totals.sub)}</td>
                    <td className="px-3 py-2.5 text-right text-[11px] text-red-600">{formatCurrency(totals.pf)}</td>
                    <td className="px-3 py-2.5 text-right text-[11px] text-red-600">{formatCurrency(totals.plf)}</td>
                    <td className="px-3 py-2.5 text-right text-[11px] text-green-700">{formatCurrency(totals.net)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* ── Footer / Pagination ── */}
          <div className="border-t border-gray-200 px-6 py-3 bg-gray-50 flex items-center justify-between flex-shrink-0">
            <div className="text-xs text-gray-500">
              Showing {Math.min((page - 1) * PAGE_SIZE + 1, filtered.length)}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} orders
            </div>
            <div className="flex items-center gap-2">
              {totalPages > 1 && (
                <div className="flex items-center gap-1 mr-3">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                    className="p-1.5 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-40 transition">
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    const p = totalPages <= 5 ? i + 1 : Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
                    return (
                      <button key={p} onClick={() => setPage(p)}
                        className={`w-7 h-7 rounded text-xs font-medium transition ${p === page ? 'bg-teal-600 text-white' : 'border border-gray-300 hover:bg-gray-100'}`}>
                        {p}
                      </button>
                    );
                  })}
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                    className="p-1.5 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-40 transition">
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <button onClick={onClose} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-xs font-medium hover:bg-teal-700 transition">
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
