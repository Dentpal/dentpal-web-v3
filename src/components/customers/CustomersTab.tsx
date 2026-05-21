/**
 * CustomersTab
 * Seller's e-commerce-style customer hub.
 *
 * Lists every buyer who has placed an order with this seller, with order
 * counts / cancellation rate / last order, and lets the seller block/unblock
 * abusive buyers. Sub-accounts with the `customers` permission can act on
 * behalf of the parent seller; the `handledBy` on each ban records who acted.
 */

import { useEffect, useMemo, useState } from 'react';
import { Search, MoreHorizontal, ShieldOff, ShieldCheck, AlertTriangle, Users } from 'lucide-react';
import { doc as fsDoc, getDoc as fsGetDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import OrdersService from '@/services/orders';
import SellersService, { type BanHandler } from '@/services/sellers';
import useSellerCustomers, { type SellerCustomer } from '@/hooks/useSellerCustomers';
import type { Order } from '@/types/order';
import BlockCustomerModal from './BlockCustomerModal';
import CustomerDetailModal from './CustomerDetailModal';

type Filter = 'all' | 'active' | 'blocked' | 'high-risk';

const PAGE_SIZE = 10;

const formatRate = (r: number) => `${(r * 100).toFixed(0)}%`;
const formatDate = (ms: number) => (ms > 0 ? new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

const Initials = ({ name }: { name: string }) => {
  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s.charAt(0).toUpperCase())
    .join('');
  return (
    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 text-white flex items-center justify-center text-xs font-semibold shadow-sm">
      {initials || '?'}
    </div>
  );
};

export const CustomersTab = () => {
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [handler, setHandler] = useState<BanHandler | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [confirm, setConfirm] = useState<{ customer: SellerCustomer; mode: 'block' | 'unblock' } | null>(null);
  const [detailCustomer, setDetailCustomer] = useState<SellerCustomer | null>(null);

  // Resolve current handler (main seller or sub-account) and the effective sellerId
  // (parent for sub-accounts).
  useEffect(() => {
    const u = user?.uid;
    if (!u) { setHandler(null); setSellerId(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const snap = await fsGetDoc(fsDoc(db, 'User', u));
        const d = snap.exists() ? (snap.data() as { isSubAccount?: boolean; parentId?: string }) : null;
        if (cancelled) return;
        if (d?.isSubAccount && d.parentId) {
          setHandler({ id: u });
          setSellerId(d.parentId);
        } else {
          setHandler({ id: u });
          setSellerId(u);
        }
      } catch {
        if (!cancelled) { setHandler({ id: u }); setSellerId(u); }
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Subscribe to this seller's orders to derive the customer list.
  useEffect(() => {
    if (!sellerId) return;
    setOrdersLoading(true);
    const unsub = OrdersService.listenBySeller(sellerId, (list: Order[]) => {
      setOrders(list);
      setOrdersLoading(false);
    });
    return () => { try { unsub?.(); } catch { /* noop */ } };
  }, [sellerId]);

  const { customers } = useSellerCustomers(orders, sellerId);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers
      .filter(c => {
        if (filter === 'active' && c.blocked) return false;
        if (filter === 'blocked' && !c.blocked) return false;
        if (filter === 'high-risk' && !c.highRisk) return false;
        if (q && !(c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))) return false;
        return true;
      })
      .sort((a, b) => b.lastOrderAt - a.lastOrderAt);
  }, [customers, filter, search]);

  useEffect(() => { setPage(1); }, [filter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleBlock = async (customer: SellerCustomer, reason: string) => {
    if (!sellerId || !handler) return;
    await SellersService.banBuyer(sellerId, customer.buyerId, {
      handledBy: handler,
      buyerName: customer.name || undefined,
      reason: reason || undefined,
      cancelCount: customer.cancelled,
    });
  };

  const handleUnblock = async (customer: SellerCustomer) => {
    if (!sellerId) return;
    await SellersService.unbanBuyer(sellerId, customer.buyerId);
  };

  const counts = useMemo(() => ({
    all: customers.length,
    active: customers.filter(c => !c.blocked).length,
    blocked: customers.filter(c => c.blocked).length,
    highRisk: customers.filter(c => c.highRisk && !c.blocked).length,
  }), [customers]);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-teal-600" />
            <h3 className="text-sm font-semibold text-gray-800 tracking-wide">BUYERS</h3>
            <span className="text-xs text-gray-500 ml-2">{counts.all} total</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search name or email…"
                className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-400 w-56"
              />
            </div>
          </div>
        </div>

        {/* Filter pills */}
        <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
          {([
            { key: 'all' as Filter, label: 'All', count: counts.all },
            { key: 'active' as Filter, label: 'Active', count: counts.active },
            { key: 'blocked' as Filter, label: 'Banned', count: counts.blocked },
            { key: 'high-risk' as Filter, label: 'High-risk', count: counts.highRisk },
          ]).map(p => (
            <button
              key={p.key}
              onClick={() => setFilter(p.key)}
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr className="text-left text-xs font-semibold tracking-wide">
                <th className="px-6 py-3">Buyer</th>
                <th className="px-6 py-3 text-right">Total Orders</th>
                <th className="px-6 py-3 text-right">Completed</th>
                <th className="px-6 py-3 text-right">Cancelled</th>
                <th className="px-6 py-3 text-right">Cancel Rate</th>
                <th className="px-6 py-3">Last Order</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {ordersLoading ? (
                <tr><td colSpan={8} className="px-6 py-16 text-center text-gray-400 text-sm">Loading customers…</td></tr>
              ) : paged.length === 0 ? (
                <tr><td colSpan={8} className="px-6 py-16 text-center text-gray-500 text-sm">
                  {counts.all === 0
                    ? 'Buyers who place orders with you will appear here.'
                    : 'No buyers match the current filter.'}
                </td></tr>
              ) : (
                paged.map(c => (
                  <tr
                    key={c.buyerId}
                    className="border-t hover:bg-teal-50/40 cursor-pointer transition-colors"
                    onClick={() => setDetailCustomer(c)}
                    title="Click to view this buyer's orders"
                  >
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <Initials name={c.name} />
                        <div>
                          <div className="font-medium text-gray-900 text-sm">{c.name || '—'}</div>
                          {c.email && <div className="text-xs text-gray-500">{c.email}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-right text-gray-900 font-medium">{c.totalOrders}</td>
                    <td className="px-6 py-3 text-right text-emerald-700">{c.completed}</td>
                    <td className="px-6 py-3 text-right text-rose-600">{c.cancelled}</td>
                    <td className="px-6 py-3 text-right">
                      <span className={c.highRisk ? 'text-amber-700 font-semibold' : 'text-gray-700'}>
                        {formatRate(c.cancellationRate)}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-600 whitespace-nowrap">{formatDate(c.lastOrderAt)}</td>
                    <td className="px-6 py-3">
                      {c.blocked ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-700">
                          <ShieldOff className="w-3 h-3" /> Banned
                        </span>
                      ) : c.highRisk ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">
                          <AlertTriangle className="w-3 h-3" /> High cancellation
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                          <ShieldCheck className="w-3 h-3" /> Active
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={(e) => {
                          if (openMenuId === c.buyerId) {
                            setOpenMenuId(null);
                            setMenuPos(null);
                            return;
                          }
                          const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                          const MENU_W = 176;
                          const MENU_H = 44;
                          const margin = 8;
                          const openUp = rect.bottom + MENU_H + margin > window.innerHeight;
                          setMenuPos({
                            top: openUp ? rect.top - MENU_H - 4 : rect.bottom + 4,
                            left: Math.max(margin, Math.min(rect.right - MENU_W, window.innerWidth - MENU_W - margin)),
                          });
                          setOpenMenuId(c.buyerId);
                        }}
                        className="p-1.5 rounded hover:bg-gray-100"
                        aria-label="Actions"
                      >
                        <MoreHorizontal className="w-4 h-4 text-gray-500" />
                      </button>
                      {openMenuId === c.buyerId && menuPos && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => { setOpenMenuId(null); setMenuPos(null); }} />
                          <div
                            className="fixed w-44 bg-white rounded-md shadow-lg border border-gray-200 z-50 overflow-hidden"
                            style={{ top: menuPos.top, left: menuPos.left }}
                          >
                            {c.blocked ? (
                              <button
                                onClick={() => { setOpenMenuId(null); setMenuPos(null); setConfirm({ customer: c, mode: 'unblock' }); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-emerald-700 hover:bg-emerald-50 text-left"
                              >
                                <ShieldCheck className="w-3.5 h-3.5" /> Unban Buyer
                              </button>
                            ) : (
                              <button
                                onClick={() => { setOpenMenuId(null); setMenuPos(null); setConfirm({ customer: c, mode: 'block' }); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose-700 hover:bg-rose-50 text-left"
                              >
                                <ShieldOff className="w-3.5 h-3.5" /> Ban Buyer
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer / pagination */}
        {filtered.length > 0 && (
          <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs text-gray-600">
            <div>
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-2 py-1 rounded border border-gray-200 bg-white disabled:opacity-40 hover:bg-white"
              >
                Prev
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                <button
                  key={n}
                  onClick={() => setPage(n)}
                  className={`min-w-[28px] px-2 py-1 rounded border ${n === page ? 'bg-teal-600 text-white border-teal-600' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  {n}
                </button>
              ))}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-2 py-1 rounded border border-gray-200 bg-white disabled:opacity-40 hover:bg-white"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {confirm && (
        <BlockCustomerModal
          customer={confirm.customer}
          mode={confirm.mode}
          onConfirm={(reason) => confirm.mode === 'block' ? handleBlock(confirm.customer, reason) : handleUnblock(confirm.customer)}
          onClose={() => setConfirm(null)}
        />
      )}

      {detailCustomer && (
        <CustomerDetailModal
          customer={detailCustomer}
          orders={orders.filter(o => {
            const a = o as unknown as Record<string, unknown>;
            const uid = ((a.userId as string) || (a.customerId as string) || '').toString();
            return uid === detailCustomer.buyerId;
          })}
          onClose={() => setDetailCustomer(null)}
          onBlock={() => setConfirm({ customer: detailCustomer, mode: 'block' })}
          onUnblock={() => setConfirm({ customer: detailCustomer, mode: 'unblock' })}
        />
      )}
    </div>
  );
};

export default CustomersTab;
