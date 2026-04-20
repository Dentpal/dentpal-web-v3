import React, { useEffect, useState, useMemo } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShoppingCart, DollarSign, Package, Phone, Calendar, User as UserIcon, ChevronLeft, ChevronRight, ArrowUpDown, FileText, FileSpreadsheet, Store, Loader2 } from 'lucide-react';
import { maskName, maskContact, fmtDate, fmtDateTime, formatCurrency } from './formatters';
import { useUserOrders } from './useUserOrders';
import { exportUserOrdersPdf, exportUserOrdersExcel } from './userDetailExports';

interface UserDetailModalProps {
  userId: string | null;
  onClose: () => void;
}

type SortKey = 'sellerName' | 'total' | 'createdAt';
type SortDir = 'asc' | 'desc';

const ORDER_PAGE_SIZE = 5;

const UserDetailModal: React.FC<UserDetailModalProps> = ({ userId, onClose }) => {
  // User data
  const [userData, setUserData] = useState<any | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);

  // Order data
  const { completedOrders, totalOrders, totalSpent, totalItems, storeBreakdown, loading: ordersLoading } = useUserOrders(userId);

  // Order table state
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Reset pagination when user changes
  useEffect(() => { setPage(1); }, [userId]);

  // Fetch user profile
  useEffect(() => {
    if (!userId) { setUserData(null); return; }
    let cancelled = false;
    const load = async () => {
      setUserLoading(true);
      setUserError(null);
      try {
        const snap = await getDoc(doc(db, 'User', userId));
        if (!snap.exists()) { if (!cancelled) setUserError('User not found'); return; }
        if (!cancelled) setUserData({ id: userId, ...snap.data() });
      } catch {
        if (!cancelled) setUserError('Failed to load user');
      } finally {
        if (!cancelled) setUserLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [userId]);

  // Sorted & paginated orders
  const sortedOrders = useMemo(() => {
    const sorted = [...completedOrders].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'sellerName') cmp = (a.sellerName || '').localeCompare(b.sellerName || '');
      else if (sortKey === 'total') cmp = (a.total || 0) - (b.total || 0);
      else cmp = (a.createdAt || '').localeCompare(b.createdAt || '');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [completedOrders, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedOrders.length / ORDER_PAGE_SIZE));
  const pagedOrders = sortedOrders.slice((page - 1) * ORDER_PAGE_SIZE, page * ORDER_PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
    setPage(1);
  };

  const userName = maskName(userData?.firstName, userData?.lastName);

  const handleExportPdf = () => {
    exportUserOrdersPdf(userName, completedOrders, { totalOrders, totalSpent, totalItems }, storeBreakdown);
  };

  const handleExportExcel = async () => {
    await exportUserOrdersExcel(userName, completedOrders, storeBreakdown, { totalOrders, totalSpent, totalItems });
  };

  if (!userId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col">
        <div className="rounded-3xl shadow-2xl overflow-hidden border border-gray-200 bg-white animate-fade-in flex flex-col max-h-[90vh]">

          {/* ── Header ── */}
          <div className="bg-gradient-to-r from-teal-600 via-teal-500 to-teal-400 px-6 pt-6 pb-4 text-white relative flex-shrink-0">
            <button aria-label="Close" onClick={onClose}
              className="absolute top-4 right-4 text-white/80 hover:text-white transition text-lg">✕</button>
            <div className="flex items-start gap-5">
              <div className="relative">
                <Avatar className="h-20 w-20 rounded-2xl ring-4 ring-white/30 shadow-lg">
                  <AvatarImage src={userData?.photoURL} alt={userName} />
                  <AvatarFallback className="text-lg bg-white/20 text-white font-semibold">
                    {(userData?.firstName?.[0] ?? 'U')}{(userData?.lastName?.[0] ?? '')}
                  </AvatarFallback>
                </Avatar>
                {userData?.gender && (
                  <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[10px] px-2 py-1 rounded-full bg-white/90 text-teal-700 shadow">
                    {String(userData.gender).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-semibold leading-tight truncate">{userName}</h2>
                <p className="text-sm text-white/80 truncate">{userData?.email}</p>
                <div className="mt-2 inline-flex items-center gap-2 text-xs bg-white/15 backdrop-blur px-3 py-1 rounded-full">
                  <span className="font-medium tracking-wide">ID</span>
                  <span className="opacity-90">{userId}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Content ── */}
          <div className="flex-1 overflow-y-auto">
            {userLoading && (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
              </div>
            )}
            {userError && (
              <div className="text-center py-8 text-sm text-red-600 bg-red-50 m-4 rounded-xl border border-red-100">{userError}</div>
            )}
            {!userLoading && !userError && userData && (
              <Tabs defaultValue="profile" className="w-full">
                <div className="px-6 pt-4 border-b">
                  <TabsList className="grid w-full grid-cols-3 h-9">
                    <TabsTrigger value="profile" className="text-xs">Profile</TabsTrigger>
                    <TabsTrigger value="orders" className="text-xs">Order History</TabsTrigger>
                    <TabsTrigger value="stores" className="text-xs">Store Breakdown</TabsTrigger>
                  </TabsList>
                </div>

                {/* ── Profile Tab ── */}
                <TabsContent value="profile" className="p-6 space-y-5 mt-0">
                  {/* Summary Cards */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-teal-50 rounded-xl p-3 text-center border border-teal-100">
                      <ShoppingCart className="w-5 h-5 mx-auto text-teal-600 mb-1" />
                      <div className="text-xl font-bold text-teal-700">{ordersLoading ? '…' : totalOrders}</div>
                      <div className="text-[10px] text-teal-600 font-medium">Total Orders</div>
                    </div>
                    <div className="bg-emerald-50 rounded-xl p-3 text-center border border-emerald-100">
                      <DollarSign className="w-5 h-5 mx-auto text-emerald-600 mb-1" />
                      <div className="text-xl font-bold text-emerald-700">{ordersLoading ? '…' : formatCurrency(totalSpent)}</div>
                      <div className="text-[10px] text-emerald-600 font-medium">Total Spent</div>
                    </div>
                    <div className="bg-indigo-50 rounded-xl p-3 text-center border border-indigo-100">
                      <Package className="w-5 h-5 mx-auto text-indigo-600 mb-1" />
                      <div className="text-xl font-bold text-indigo-700">{ordersLoading ? '…' : totalItems}</div>
                      <div className="text-[10px] text-indigo-600 font-medium">Items Purchased</div>
                    </div>
                  </div>

                  {/* User Info */}
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-1">
                      <div className="text-[11px] font-medium text-gray-500 tracking-wide flex items-center gap-1"><Phone className="w-3 h-3" />Contact</div>
                      <div className="text-sm font-medium text-gray-900">{maskContact(userData.phoneNumber || userData.contactNumber || userData.contact || userData.mobile || userData.phone)}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] font-medium text-gray-500 tracking-wide flex items-center gap-1"><UserIcon className="w-3 h-3" />Gender</div>
                      <div className="text-sm font-medium text-gray-900">{userData.gender || '—'}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] font-medium text-gray-500 tracking-wide flex items-center gap-1"><Calendar className="w-3 h-3" />Birthdate</div>
                      <div className="text-sm font-medium text-gray-900">{fmtDate(userData.birthdate || userData.birthday || userData.dob)}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] font-medium text-gray-500 tracking-wide">Reward Points</div>
                      <div className="text-sm font-semibold text-teal-700">{(userData.rewardPoints ?? 0).toLocaleString()}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6 pt-4 border-t border-gray-100">
                    <div className="space-y-1">
                      <div className="text-[11px] font-medium text-gray-500 tracking-wide">Created At</div>
                      <div className="text-xs font-medium text-gray-800 bg-gray-50 rounded-md px-2 py-1 inline-block">{fmtDateTime(userData.createdAt)}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] font-medium text-gray-500 tracking-wide">Last Updated</div>
                      <div className="text-xs font-medium text-gray-800 bg-gray-50 rounded-md px-2 py-1 inline-block">{fmtDateTime(userData.updatedAt)}</div>
                    </div>
                  </div>
                </TabsContent>

                {/* ── Order History Tab ── */}
                <TabsContent value="orders" className="p-6 space-y-4 mt-0">
                  {/* Export buttons */}
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-700">Completed Orders ({totalOrders})</h3>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={handleExportPdf} disabled={completedOrders.length === 0}>
                        <FileText className="w-3.5 h-3.5" /> PDF
                      </Button>
                      <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={handleExportExcel} disabled={completedOrders.length === 0}>
                        <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
                      </Button>
                    </div>
                  </div>

                  {ordersLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 className="w-5 h-5 animate-spin text-teal-500" />
                    </div>
                  ) : completedOrders.length === 0 ? (
                    <div className="text-center py-10 text-sm text-gray-400">No completed orders found.</div>
                  ) : (
                    <>
                      <div className="overflow-x-auto rounded-lg border border-gray-200">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-gray-50 text-gray-600 font-semibold">
                              <th className="px-3 py-2 text-left">Order ID</th>
                              <th className="px-3 py-2 text-left cursor-pointer select-none hover:text-teal-600" onClick={() => toggleSort('sellerName')}>
                                <span className="inline-flex items-center gap-1">Store <ArrowUpDown className="w-3 h-3" /></span>
                              </th>
                              <th className="px-3 py-2 text-left">Items</th>
                              <th className="px-3 py-2 text-right cursor-pointer select-none hover:text-teal-600" onClick={() => toggleSort('total')}>
                                <span className="inline-flex items-center gap-1 justify-end">Total <ArrowUpDown className="w-3 h-3" /></span>
                              </th>
                              <th className="px-3 py-2 text-right cursor-pointer select-none hover:text-teal-600" onClick={() => toggleSort('createdAt')}>
                                <span className="inline-flex items-center gap-1 justify-end">Date <ArrowUpDown className="w-3 h-3" /></span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {pagedOrders.map((o, i) => (
                              <tr key={o.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                                <td className="px-3 py-2 font-mono text-gray-500">{o.id.slice(0, 10)}…</td>
                                <td className="px-3 py-2 text-gray-800">{o.sellerName || '—'}</td>
                                <td className="px-3 py-2 text-gray-600 max-w-[180px] truncate">{o.itemsBrief}</td>
                                <td className="px-3 py-2 text-right font-medium text-gray-900">{formatCurrency(o.total)}</td>
                                <td className="px-3 py-2 text-right text-gray-500">{fmtDateTime(o.createdAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Pagination */}
                      {totalPages > 1 && (
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[11px] text-gray-400">Page {page} of {totalPages}</span>
                          <div className="flex gap-1">
                            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </TabsContent>

                {/* ── Store Breakdown Tab ── */}
                <TabsContent value="stores" className="p-6 space-y-4 mt-0">
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                    <Store className="w-4 h-4 text-indigo-500" /> Purchasing by Store
                  </h3>

                  {ordersLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 className="w-5 h-5 animate-spin text-teal-500" />
                    </div>
                  ) : storeBreakdown.length === 0 ? (
                    <div className="text-center py-10 text-sm text-gray-400">No store data available.</div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-indigo-50 text-indigo-700 font-semibold">
                            <th className="px-3 py-2 text-left">Store Name</th>
                            <th className="px-3 py-2 text-center">Orders</th>
                            <th className="px-3 py-2 text-right">Total Spent</th>
                            <th className="px-3 py-2 text-right">% of Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {storeBreakdown.map((b, i) => {
                            const pct = totalSpent > 0 ? ((b.amount / totalSpent) * 100).toFixed(1) : '0';
                            return (
                              <tr key={b.storeName} className={i % 2 === 0 ? 'bg-white' : 'bg-indigo-50/30'}>
                                <td className="px-3 py-2 font-medium text-gray-800">{b.storeName}</td>
                                <td className="px-3 py-2 text-center text-gray-600">{b.orderCount}</td>
                                <td className="px-3 py-2 text-right font-medium text-gray-900">{formatCurrency(b.amount)}</td>
                                <td className="px-3 py-2 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                      <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                                    </div>
                                    <span className="text-gray-500 w-10 text-right">{pct}%</span>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            )}
          </div>

          {/* ── Footer ── */}
          <div className="px-6 py-4 border-t flex-shrink-0 flex justify-end">
            <Button variant="secondary" onClick={onClose} className="text-xs rounded-full px-4">Close</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserDetailModal;
