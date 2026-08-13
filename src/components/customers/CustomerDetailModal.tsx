/**
 * CustomerDetailModal
 * Opens from a row click in CustomersTab. Shows a buyer's order history
 * with the current seller — date, items, categories, status, payment,
 * total, and cancel reason — plus quick Block/Unblock from the header.
 */

import { useMemo, useState } from 'react';
import {
  X, Package, ShoppingCart, CheckCircle, XCircle, PhilippinePeso,
  ChevronLeft, ChevronRight, ShieldOff, ShieldCheck, AlertTriangle,
} from 'lucide-react';
import type { Order } from '@/types/order';
import { formatCurrency } from '@/utils/dashboard/formatters';
import { useCategoryResolution } from '@/hooks/dashboard/useCategoryResolution';
import type { SellerCustomer } from '@/hooks/useSellerCustomers';
import maskName from '@/utils/maskName';

interface CustomerDetailModalProps {
  customer: SellerCustomer;
  orders: Order[]; // orders for this buyer with this seller
  onClose: () => void;
  onBlock: () => void;
  onUnblock: () => void;
}

const PAGE_SIZE = 10;
type Filter = 'all' | 'completed' | 'cancelled';

const COMPLETED_STATUSES = new Set(['completed', 'delivered']);
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled', 'expired']);

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
  const a = o as unknown as Record<string, unknown>;
  const fees = (a.fees as Record<string, unknown>) || {};
  const raw = (
    (fees.paymentMethod as string) ||
    (o.feesBreakdown?.paymentMethod as string) ||
    ((a.paymentType as string) || '')
  ).toString().trim().toLowerCase();
  if (!raw) return '—';
  return PAYMENT_METHOD_LABELS[raw] || raw;
};

const orderTime = (o: Order) => {
  const t = o.createdAt || o.timestamp;
  if (!t) return 0;
  const ms = new Date(t as string).getTime();
  return Number.isNaN(ms) ? 0 : ms;
};

const formatDateTime = (ms: number) =>
  ms > 0
    ? new Date(ms).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

const truncate = (s: string, n: number) => (s && s.length > n ? s.slice(0, n) : s || '—');

// Extract the most recent cancel reason from statusHistory (note field on
// the cancelled / expired entry) — falls back to returnRequest.reason.
const resolveCancelReason = (o: Order): string => {
  const status = (o.status || '').toLowerCase();
  if (!CANCELLED_STATUSES.has(status)) return '—';

  const history = Array.isArray(o.statusHistory) ? o.statusHistory : [];
  const cancelEntries = history.filter(h => {
    const s = (h.status || '').toLowerCase();
    return CANCELLED_STATUSES.has(s);
  });
  const last = cancelEntries[cancelEntries.length - 1];
  const fromHistory = (last?.note || '').toString().trim();
  if (fromHistory) return fromHistory;

  const rr = (o as unknown as { returnRequest?: { reason?: string } }).returnRequest;
  const fromReturn = (rr?.reason || '').toString().trim();
  return fromReturn || '—';
};

const Initials = ({ name }: { name: string }) => {
  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s.charAt(0).toUpperCase())
    .join('');
  return (
    <div className="w-12 h-12 rounded-full bg-white/20 text-white flex items-center justify-center text-sm font-bold shadow-sm">
      {initials || '?'}
    </div>
  );
};

export const CustomerDetailModal = ({ customer, orders, onClose, onBlock, onUnblock }: CustomerDetailModalProps) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);

  // For category resolution we only need this buyer's orders.
  const { productCategoryMap, categoryNameMap } = useCategoryResolution(orders);

  const resolveCategoriesForOrder = (o: Order): string => {
    const items = (o.items || []) as Array<Record<string, unknown>>;
    const names = new Set<string>();
    items.forEach(it => {
      const categoryId = (it.categoryId as string) || (it.productId ? productCategoryMap.get(it.productId as string) : undefined);
      const name = categoryId ? categoryNameMap.get(categoryId) : undefined;
      const fallback = (it.category as string) || '';
      if (name) names.add(name);
      else if (fallback) names.add(fallback);
    });
    return names.size ? Array.from(names).join(' · ') : '—';
  };

  const totals = useMemo(() => {
    const completed = orders.filter(o => COMPLETED_STATUSES.has((o.status || '').toLowerCase())).length;
    const cancelled = orders.filter(o => CANCELLED_STATUSES.has((o.status || '').toLowerCase())).length;
    const spent = orders.reduce((sum, o) => sum + (Number(o.summary?.subtotal) || Number(o.total) || 0), 0);
    return { total: orders.length, completed, cancelled, spent };
  }, [orders]);

  const filtered = useMemo(() => {
    let list = [...orders];
    if (filter === 'completed') list = list.filter(o => COMPLETED_STATUSES.has((o.status || '').toLowerCase()));
    if (filter === 'cancelled') list = list.filter(o => CANCELLED_STATUSES.has((o.status || '').toLowerCase()));
    list.sort((a, b) => orderTime(b) - orderTime(a));
    return list;
  }, [orders, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col">

          {/* Header */}
          <div className="bg-gradient-to-r from-teal-600 to-teal-700 text-white px-6 py-5 flex-shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Initials name={customer.name} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-bold truncate">{maskName(customer.name) || '—'}</h3>
                    {customer.blocked ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-700">
                        <ShieldOff className="w-3 h-3" /> Banned
                      </span>
                    ) : customer.highRisk ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">
                        <AlertTriangle className="w-3 h-3" /> High cancellation
                      </span>
                    ) : null}
                  </div>
                  {customer.email && <p className="text-xs text-teal-100 mt-0.5 truncate">{customer.email}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {customer.blocked ? (
                  <button
                    onClick={onUnblock}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-full bg-white/20 hover:bg-white/30 text-white transition"
                  >
                    <ShieldCheck className="w-4 h-4" /> Unban
                  </button>
                ) : (
                  <button
                    onClick={onBlock}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-full bg-white/20 hover:bg-white/30 text-white transition"
                  >
                    <ShieldOff className="w-4 h-4" /> Ban
                  </button>
                )}
                <button onClick={onClose} className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-3 mt-4">
              {[
                { icon: Package,         label: 'Total Orders', value: totals.total.toLocaleString() },
                { icon: CheckCircle,     label: 'Completed',    value: totals.completed.toLocaleString() },
                { icon: XCircle,         label: 'Cancelled',    value: totals.cancelled.toLocaleString() },
                { icon: PhilippinePeso,  label: 'Total Spent',  value: formatCurrency(totals.spent) },
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

          {/* Filter pills */}
          <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap flex-shrink-0">
            {([
              { key: 'all' as Filter, label: 'All', count: totals.total },
              { key: 'completed' as Filter, label: 'Completed', count: totals.completed },
              { key: 'cancelled' as Filter, label: 'Cancelled', count: totals.cancelled },
            ]).map(p => (
              <button
                key={p.key}
                onClick={() => { setFilter(p.key); setPage(1); }}
                className={`px-3 py-1 text-xs rounded-full font-medium border transition ${
                  filter === p.key
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {p.label}
                <span className={`ml-1.5 text-[10px] ${filter === p.key ? 'text-teal-100' : 'text-gray-400'}`}>{p.count}</span>
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs border-collapse" style={{ minWidth: 1000, tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 32 }} />     {/* # */}
                <col style={{ width: 140 }} />    {/* date/time */}
                <col style={{ width: 112 }} />    {/* order id */}
                <col />                            {/* items */}
                <col style={{ width: 140 }} />    {/* categories */}
                <col style={{ width: 96 }} />     {/* status */}
                <col style={{ width: 100 }} />    {/* payment */}
                <col style={{ width: 100 }} />    {/* total */}
                <col style={{ width: 180 }} />    {/* cancel reason */}
              </colgroup>
              <thead>
                <tr>
                  <th className="sticky top-0 bg-gray-100 z-10 border-b border-gray-300 px-3 py-2.5 text-left text-[11px] font-semibold">#</th>
                  <th className="sticky top-0 bg-gray-100 z-10 border-b border-gray-300 px-3 py-2.5 text-left text-[11px] font-semibold whitespace-nowrap">Date / Time</th>
                  <th className="sticky top-0 bg-gray-100 z-10 border-b border-gray-300 px-3 py-2.5 text-left text-[11px] font-semibold">Order ID</th>
                  <th className="sticky top-0 bg-gray-100 z-10 border-b border-gray-300 px-3 py-2.5 text-left text-[11px] font-semibold">Items</th>
                  <th className="sticky top-0 bg-gray-100 z-10 border-b border-gray-300 px-3 py-2.5 text-left text-[11px] font-semibold">Categories</th>
                  <th className="sticky top-0 bg-gray-100 z-10 border-b border-gray-300 px-3 py-2.5 text-left text-[11px] font-semibold">Status</th>
                  <th className="sticky top-0 bg-gray-100 z-10 border-b border-gray-300 px-3 py-2.5 text-left text-[11px] font-semibold">Payment</th>
                  <th className="sticky top-0 bg-gray-100 z-10 border-b border-gray-300 px-3 py-2.5 text-right text-[11px] font-semibold">Total</th>
                  <th className="sticky top-0 bg-gray-100 z-10 border-b border-gray-300 px-3 py-2.5 text-left text-[11px] font-semibold">Cancel Reason</th>
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-gray-400 text-sm">
                      <ShoppingCart className="w-6 h-6 mx-auto mb-2 text-gray-300" />
                      No orders match this filter.
                    </td>
                  </tr>
                ) : paged.map((o, i) => {
                  const st = getStatus((o.status || '').toLowerCase());
                  const id = (o.id || '').toString();
                  const total = Number(o.summary?.subtotal) || Number(o.total) || 0;
                  const items = (o.items || []).map((it: any) => `${it.name} x${it.quantity || 1}`).join(', ') || '—';
                  return (
                    <tr key={id || i} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'} hover:bg-teal-50/40`}>
                      <td className="px-3 py-2.5 text-gray-500 align-middle">{(page - 1) * PAGE_SIZE + i + 1}</td>
                      <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap align-middle">{formatDateTime(orderTime(o))}</td>
                      <td className="px-3 py-2.5 font-mono text-gray-600 truncate align-middle" title={id}>{truncate(id, 11)}</td>
                      <td className="px-3 py-2.5 text-gray-700 truncate align-middle" title={items}>{items}</td>
                      <td className="px-3 py-2.5 text-gray-700 truncate align-middle">{resolveCategoriesForOrder(o)}</td>
                      <td className="px-3 py-2.5 align-middle">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${st.bg} ${st.text}`}>{st.label}</span>
                      </td>
                      <td className="px-3 py-2.5 text-gray-700 align-middle">{resolvePaymentMethod(o)}</td>
                      <td className="px-3 py-2.5 text-right font-medium text-gray-900 align-middle whitespace-nowrap">{formatCurrency(total)}</td>
                      <td className="px-3 py-2.5 align-middle">
                        <span className={CANCELLED_STATUSES.has((o.status || '').toLowerCase()) ? 'text-rose-700' : 'text-gray-400'} title={resolveCancelReason(o)}>
                          {resolveCancelReason(o)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between gap-3 flex-shrink-0 text-xs text-gray-600">
            <div>
              {filtered.length === 0
                ? 'Showing 0 orders'
                : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, filtered.length)} of ${filtered.length} orders`}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-1.5 rounded border border-gray-200 bg-white disabled:opacity-40 hover:bg-white"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-3.5 h-3.5 text-gray-600" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className={`min-w-[26px] h-7 px-1.5 text-xs rounded border ${n === page ? 'bg-teal-600 text-white border-teal-600' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
                  >
                    {n}
                  </button>
                ))}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded border border-gray-200 bg-white disabled:opacity-40 hover:bg-white"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
};

export default CustomerDetailModal;
