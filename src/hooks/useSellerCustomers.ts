/**
 * useSellerCustomers
 * Derives a per-buyer roll-up from a seller's own order list:
 *   - total orders / completed / cancelled
 *   - cancellation rate
 *   - last order timestamp
 *   - blocked status (joined from Seller/{sellerId}/bannedBuyers via listenBannedBuyers)
 *
 * Buyer name + email are resolved from the Firestore User collection (cached
 * across the hook's lifetime). Falls back to whatever the order itself carries.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Order } from '@/types/order';
import SellersService, { type BannedBuyerRecord } from '@/services/sellers';

export interface SellerCustomer {
  buyerId: string;
  name: string;
  email: string;
  totalOrders: number;
  completed: number;
  cancelled: number;
  cancellationRate: number; // 0..1
  lastOrderAt: number; // epoch ms (0 if unknown)
  blocked: boolean;
  ban?: BannedBuyerRecord;
  highRisk: boolean;
}

const COMPLETED_STATUSES = new Set(['completed', 'delivered']);
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled', 'expired']);

const orderBuyerId = (o: Order): string => {
  const a = o as unknown as Record<string, unknown>;
  return ((a.userId as string) || (a.customerId as string) || '').toString();
};

const orderBuyerName = (o: Order): string => {
  const a = o as unknown as Record<string, unknown>;
  return ((a.customerName as string) || (o.customer?.name as string) || (a.buyerName as string) || '').toString().trim();
};

const orderTime = (o: Order): number => {
  const ts = o.createdAt || o.timestamp;
  if (!ts) return 0;
  const ms = new Date(ts as string).getTime();
  return Number.isNaN(ms) ? 0 : ms;
};

export const useSellerCustomers = (orders: Order[], sellerId: string | null | undefined) => {
  const [userProfiles, setUserProfiles] = useState<Record<string, { name: string; email: string }>>({});
  const [bans, setBans] = useState<Record<string, BannedBuyerRecord>>({});
  const profileCacheRef = useRef<Set<string>>(new Set());

  // Aggregate raw per-buyer stats from orders (no IO).
  const baseRows = useMemo(() => {
    const map = new Map<string, {
      buyerId: string;
      orderName: string;
      total: number;
      completed: number;
      cancelled: number;
      lastOrderAt: number;
    }>();
    orders.forEach(o => {
      const uid = orderBuyerId(o);
      if (!uid) return;
      const prev = map.get(uid) || { buyerId: uid, orderName: '', total: 0, completed: 0, cancelled: 0, lastOrderAt: 0 };
      prev.total += 1;
      const status = (o.status || '').toString().toLowerCase();
      if (COMPLETED_STATUSES.has(status)) prev.completed += 1;
      if (CANCELLED_STATUSES.has(status)) prev.cancelled += 1;
      const t = orderTime(o);
      if (t > prev.lastOrderAt) prev.lastOrderAt = t;
      if (!prev.orderName) prev.orderName = orderBuyerName(o);
      map.set(uid, prev);
    });
    return Array.from(map.values());
  }, [orders]);

  // Resolve display name + email from Firestore User docs (one lookup per buyer).
  useEffect(() => {
    const cache = profileCacheRef.current;
    const missing = baseRows.map(r => r.buyerId).filter(uid => !cache.has(uid));
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(missing.map(async (uid) => {
        cache.add(uid);
        try {
          const snap = await getDoc(doc(db, 'User', uid));
          if (!snap.exists()) return [uid, { name: '', email: '' }] as const;
          const d = snap.data() as { firstName?: string; lastName?: string; email?: string };
          const name = [d.firstName, d.lastName].filter(Boolean).join(' ').trim();
          return [uid, { name, email: (d.email || '').trim() }] as const;
        } catch {
          return [uid, { name: '', email: '' }] as const;
        }
      }));
      if (cancelled) return;
      setUserProfiles(prev => {
        const next = { ...prev };
        for (const [uid, profile] of entries) next[uid] = profile;
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [baseRows]);

  // Live ban list for this seller.
  useEffect(() => {
    if (!sellerId) { setBans({}); return; }
    const unsub = SellersService.listenBannedBuyers(
      sellerId,
      (records) => {
        const next: Record<string, BannedBuyerRecord> = {};
        records.forEach(r => { next[r.buyerId] = r; });
        setBans(next);
      },
      (err) => console.error('listenBannedBuyers error:', err),
    );
    return () => { try { unsub?.(); } catch { /* noop */ } };
  }, [sellerId]);

  const customers: SellerCustomer[] = useMemo(() => {
    return baseRows.map(r => {
      const profile = userProfiles[r.buyerId];
      const ban = bans[r.buyerId];
      const cancellationRate = r.total > 0 ? r.cancelled / r.total : 0;
      const highRisk = r.total >= 3 && cancellationRate >= 0.3;
      return {
        buyerId: r.buyerId,
        name: profile?.name || r.orderName || '—',
        email: profile?.email || '',
        totalOrders: r.total,
        completed: r.completed,
        cancelled: r.cancelled,
        cancellationRate,
        lastOrderAt: r.lastOrderAt,
        blocked: !!ban,
        ban,
        highRisk,
      };
    });
  }, [baseRows, userProfiles, bans]);

  return { customers, bans };
};

export default useSellerCustomers;
