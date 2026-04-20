import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface UserOrder {
  id: string;
  sellerName: string;
  sellerIds?: string[];
  itemsBrief: string;
  total: number;
  status: string;
  createdAt: string;
  items: Array<{ name: string; quantity: number; price?: number }>;
}

export interface StoreBreakdown {
  storeName: string;
  orderCount: number;
  amount: number;
}

interface UseUserOrdersResult {
  orders: UserOrder[];
  completedOrders: UserOrder[];
  totalOrders: number;
  totalSpent: number;
  totalItems: number;
  storeBreakdown: StoreBreakdown[];
  loading: boolean;
  error: string | null;
}

function resolveTotal(data: any): number {
  return data.total ?? data.summary?.total ?? data.paymentInfo?.amount ?? data.totalAmount ?? 0;
}

function resolveDate(data: any): string {
  if (data.createdAt) {
    if (typeof data.createdAt === 'string') return data.createdAt;
    if (data.createdAt?.toDate) return data.createdAt.toDate().toISOString();
    if (typeof data.createdAt.seconds === 'number') return new Date(data.createdAt.seconds * 1000).toISOString();
  }
  return data.timestamp || '';
}

function makeItemsBrief(items: any[]): string {
  if (!items || items.length === 0) return '—';
  const first = items[0]?.name || 'Item';
  const qty = items[0]?.quantity || 1;
  if (items.length === 1) return `${first} x ${qty}`;
  return `${first} x ${qty} + ${items.length - 1} more`;
}

function mapDocToUserOrder(id: string, data: any): UserOrder {
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    id,
    sellerName: data.sellerName || (Array.isArray(data.sellerIds) && data.sellerIds.length > 1 ? 'Multiple Sellers' : '') || '',
    sellerIds: data.sellerIds,
    itemsBrief: data.itemsBrief || makeItemsBrief(items),
    total: resolveTotal(data),
    status: data.status || '',
    createdAt: resolveDate(data),
    items: items.map((i: any) => ({ name: i.name || '', quantity: i.quantity || 0, price: i.price })),
  };
}

export function useUserOrders(userId: string | null): UseUserOrdersResult {
  const [orders, setOrders] = useState<UserOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setOrders([]);
      return;
    }

    let cancelled = false;
    const fetchOrders = async () => {
      setLoading(true);
      setError(null);
      try {
        const ordersCol = collection(db, 'Order');
        const qUserId = query(ordersCol, where('userId', '==', userId));
        const qCustomerId = query(ordersCol, where('customerId', '==', userId));

        const [snapUser, snapCustomer] = await Promise.all([getDocs(qUserId), getDocs(qCustomerId)]);

        // Deduplicate by doc ID
        const seen = new Map<string, UserOrder>();
        [...snapUser.docs, ...snapCustomer.docs].forEach(d => {
          if (!seen.has(d.id)) {
            seen.set(d.id, mapDocToUserOrder(d.id, d.data()));
          }
        });

        const all = Array.from(seen.values());
        // Sort by date descending
        all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

        if (!cancelled) setOrders(all);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load orders');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchOrders();
    return () => { cancelled = true; };
  }, [userId]);

  const completedOrders = orders.filter(o => o.status === 'completed');

  const totalOrders = completedOrders.length;

  const totalSpent = completedOrders.reduce((sum, o) => sum + (o.total || 0), 0);

  const totalItems = completedOrders.reduce(
    (sum, o) => sum + o.items.reduce((s, i) => s + (i.quantity || 0), 0),
    0
  );

  // Store breakdown from completed orders
  const storeMap = new Map<string, StoreBreakdown>();
  completedOrders.forEach(o => {
    const key = o.sellerName || o.sellerIds?.[0] || 'Unknown Store';
    const existing = storeMap.get(key);
    if (existing) {
      existing.orderCount += 1;
      existing.amount += o.total || 0;
    } else {
      storeMap.set(key, { storeName: key, orderCount: 1, amount: o.total || 0 });
    }
  });
  const storeBreakdown = Array.from(storeMap.values()).sort((a, b) => b.amount - a.amount);

  return { orders, completedOrders, totalOrders, totalSpent, totalItems, storeBreakdown, loading, error };
}
