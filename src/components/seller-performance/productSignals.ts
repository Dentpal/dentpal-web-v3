/**
 * Real Product-Health signals for a single seller:
 *   - Stock Availability  (active SKUs in stock ÷ active SKUs)
 *   - New Listings (30d)  (active products created in window)
 *   - Avg OOS Days        (approx — inferred from stock-adjustment history)
 */
import type { Period } from './scoring';
import { windowStart, fmtLocalDate, type LiveMetricResult, type LiveMetricRow } from './fulfillmentSignals';

// Subset of ProductService.listenBySeller rows that we need.
export interface ProductRow {
  id: string;
  name?: string;
  imageUrl?: string;
  status: string;
  inStock: number;
  createdAt: number;
}

// Normalized stock-adjustment event (from InventoryService.listenAdjustmentsBySeller raw).
export interface AdjustmentRow {
  itemId: string;
  itemName?: string;
  at: number; // epoch ms
  stockAfter: number;
}

const ONE_DAY = 86_400_000;

export function computeStockAvailability(products: ProductRow[]): LiveMetricResult {
  const active = products.filter((p) => p.status === 'active');
  const inStock = active.filter((p) => p.inStock > 0);
  const rows: LiveMetricRow[] = active.map((p) => ({
    ref: p.id,
    date: fmtLocalDate(p.createdAt || Date.now()),
    productName: p.name || '—',
    productImage: p.imageUrl || '',
    columns: [
      { label: 'In stock', value: p.inStock > 0 ? `Yes (${p.inStock})` : 'Out of stock' },
      { label: 'Status', value: p.status },
    ],
  }));
  return {
    numerator: inStock.length,
    denominator: active.length,
    rate: active.length > 0 ? inStock.length / active.length : 0,
    rows,
  };
}

export function computeNewListings(products: ProductRow[], period: Period): LiveMetricResult {
  const since = windowStart(period);
  const fresh = products.filter((p) => p.status === 'active' && p.createdAt >= since);
  const rows: LiveMetricRow[] = fresh.map((p) => ({
    ref: p.id,
    date: fmtLocalDate(p.createdAt),
    productName: p.name || '—',
    productImage: p.imageUrl || '',
    columns: [
      { label: 'Created', value: fmtLocalDate(p.createdAt) },
      { label: 'Status', value: p.status },
    ],
  }));
  return {
    numerator: fresh.length,
    denominator: products.length, // population = the catalog
    rate: 0,
    value: fresh.length, // native metric is a count
    available: products.length > 0,
    rows,
  };
}

export function computeAvgOosDays(adjustments: AdjustmentRow[], period: Period): LiveMetricResult {
  const since = windowStart(period);
  const now = Date.now();

  // Group adjustments per item, ascending by time.
  const byItem = new Map<string, AdjustmentRow[]>();
  for (const a of adjustments) {
    if (!a.itemId) continue;
    const list = byItem.get(a.itemId) ?? [];
    list.push(a);
    byItem.set(a.itemId, list);
  }

  const episodeDays: number[] = [];
  const rows: LiveMetricRow[] = [];

  for (const [itemId, evs] of byItem) {
    evs.sort((x, y) => x.at - y.at);
    for (let i = 0; i < evs.length; i++) {
      if (evs[i].stockAfter !== 0) continue; // not an out-of-stock transition
      const startMs = evs[i].at;
      if (startMs < since) continue; // episode started before the window
      // Next event for this item that restocks (>0).
      const restock = evs.slice(i + 1).find((e) => e.stockAfter > 0);
      const endMs = restock ? restock.at : now; // open-ended → measure to now
      const days = Math.max(0, (endMs - startMs) / ONE_DAY);
      episodeDays.push(days);
      rows.push({
        ref: `${itemId}-${i}`,
        date: fmtLocalDate(startMs),
        productName: evs[i].itemName || itemId,
        productImage: '',
        columns: [
          { label: 'Out of stock', value: fmtLocalDate(startMs) },
          { label: 'Restocked', value: restock ? fmtLocalDate(endMs) : 'Still out' },
          { label: 'Days', value: days.toFixed(1) },
        ],
      });
    }
  }

  const avg = episodeDays.length > 0 ? episodeDays.reduce((s, d) => s + d, 0) / episodeDays.length : 0;
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  return {
    numerator: episodeDays.length,
    denominator: episodeDays.length,
    rate: 0,
    value: avg,
    available: adjustments.length > 0, // we have stock history to reason about
    approx: true,
    rows,
  };
}
