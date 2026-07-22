/**
 * Real Ship-on-Time aggregation for a single seller.
 *
 * Definition (matches what the UI describes):
 *   Numerator   = orders that reached `shipped` / `shipping` within SHIP_SLA_HOURS
 *                 of order creation.
 *   Denominator = orders that entered the shipping pipeline (any of:
 *                 to_pack, to_arrange, to_handover, pickup, shipped, shipping,
 *                 completed, delivered, return_*) in the selected period.
 *
 * Buyer cancellations / pre-pipeline cancellations are excluded automatically
 * because they never reach a pipeline status.
 */
import type { Order } from '@/types/order';
import type { Period } from './scoring';

export const SHIP_SLA_HOURS = 48; // default promised window

const PIPELINE_STATUSES = new Set([
  'to_pack',
  'to_arrange',
  'to_handover',
  'pickup',
  'shipped',
  'shipping',
  'completed',
  'delivered',
  'return_requested',
  'return_approved',
  'return_rejected',
  'returned',
  'refunded',
  'return_refund',
  'failed-delivery',
]);

const SHIPPED_STATUSES = new Set(['shipped', 'shipping']);

export const periodDays = (p: Period) => (p === '7d' ? 7 : p === '30d' ? 30 : 90);

// Start of the selected period window, in epoch millis.
export const windowStart = (p: Period) => Date.now() - periodDays(p) * 86_400_000;

export const toMs = (v: any): number | null => {
  if (!v) return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return isNaN(t) ? null : t;
  }
  if (v instanceof Date) return v.getTime();
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (typeof v?.toDate === 'function') return v.toDate().getTime();
  if (typeof v?.seconds === 'number') return v.seconds * 1000;
  return null;
};

export const orderCreatedMs = (o: Order): number | null => {
  return toMs(o.createdAt) ?? toMs(o.timestamp) ?? toMs(o.paidAt);
};

export const fmtLocalDate = (ms: number) => new Date(ms).toLocaleDateString();

// Earliest statusHistory entry where status is in the given set.
const earliestStatusAt = (o: Order, statuses: Set<string>): number | null => {
  const hist = o.statusHistory || [];
  let earliest: number | null = null;
  for (const h of hist) {
    if (statuses.has(String(h.status))) {
      const t = toMs(h.timestamp);
      if (t != null && (earliest == null || t < earliest)) earliest = t;
    }
  }
  return earliest;
};

// Latest pipeline status from history (falls back to order.status).
const latestPipelineStatus = (o: Order): string => {
  const hist = o.statusHistory || [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const s = String(hist[i].status);
    if (PIPELINE_STATUSES.has(s)) return s;
  }
  return String(o.status || '');
};

export interface LiveMetricRow {
  ref: string;
  date: string;
  productName: string;
  productImage: string;
  columns: { label: string; value: string }[];
}

export interface LiveMetricResult {
  numerator: number;
  denominator: number;
  rate: number; // 0..1
  // Native metric value in the unit the metric expects (rate 0..1, minutes, days,
  // or a count). Defaults to `rate` when omitted.
  value?: number;
  // Whether this metric has real data to show. Defaults to `denominator > 0`.
  available?: boolean;
  // True when `value` is a best-effort approximation (shown as a hint in the UI).
  approx?: boolean;
  rows: LiveMetricRow[];
}

// Convenience accessors with the documented fallbacks.
export const metricValue = (r: LiveMetricResult): number => r.value ?? r.rate;
export const metricAvailable = (r: LiveMetricResult): boolean => r.available ?? r.denominator > 0;

// Backwards-compatible aliases (Ship-on-Time was the first live metric).
export type ShipOnTimeRow = LiveMetricRow;
export type ShipOnTimeResult = LiveMetricResult;

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString();

export function computeShipOnTime(
  orders: Order[],
  period: Period,
  slaHours: number = SHIP_SLA_HOURS,
): LiveMetricResult {
  const since = Date.now() - periodDays(period) * 86_400_000;
  const slaMs = slaHours * 3_600_000;

  let numerator = 0;
  let denominator = 0;
  const rows: ShipOnTimeRow[] = [];

  for (const o of orders) {
    const createdMs = orderCreatedMs(o);
    if (createdMs == null || createdMs < since) continue;

    // Did this order enter the shipping pipeline?
    const enteredPipeline =
      PIPELINE_STATUSES.has(String(o.status)) ||
      (o.statusHistory || []).some((h) => PIPELINE_STATUSES.has(String(h.status)));
    if (!enteredPipeline) continue;

    denominator++;

    const shippedAt = earliestStatusAt(o, SHIPPED_STATUSES) ?? toMs(o.handoverAt);
    const isOnTime = shippedAt != null && shippedAt - createdMs <= slaMs;
    if (isOnTime) numerator++;

    const firstItem = (o.items && o.items[0]) || ({} as any);
    const productName = String(firstItem.name || o.itemsBrief || '—');
    const productImage = String(firstItem.imageUrl || o.imageUrl || '');
    const pipelineStatus = latestPipelineStatus(o);

    rows.push({
      ref: o.id,
      date: fmtDate(createdMs),
      productName,
      productImage,
      columns: [
        { label: 'Order', value: o.id },
        { label: 'Pipeline status', value: pipelineStatus },
        { label: 'Window', value: shippedAt == null ? 'Pending' : isOnTime ? 'On time' : 'Late' },
        { label: 'Date', value: fmtDate(createdMs) },
      ],
    });
  }

  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  const rate = denominator > 0 ? numerator / denominator : 0;
  return { numerator, denominator, rate, rows };
}

/* ─── Cancellation Rate (seller-side) ────────────────────────────── */

// Statuses that mean the order was paid / progressed past checkout. A
// seller-cancelled order belongs in the denominator too, so 'cancelled' is
// included here even though it is not a "pipeline" status.
const PAID_STATUSES = new Set<string>([
  ...PIPELINE_STATUSES,
  'confirmed',
  'cancelled',
]);

const orderWasPaid = (o: Order): boolean => {
  if (o.paidAt) return true;
  if (PAID_STATUSES.has(String(o.status))) return true;
  return (o.statusHistory || []).some((h) => PAID_STATUSES.has(String(h.status)));
};

// Resolve whether a `handledBy` value belongs to the seller (main/sub account).
// Returns true = seller, false = someone else (e.g. buyer), null = unknown.
const handledBySeller = (handledBy: any, sellerId: string): boolean | null => {
  if (handledBy == null) return null;
  if (typeof handledBy === 'string') {
    if (!handledBy) return null;
    return handledBy === sellerId ? true : false;
  }
  const role = String(handledBy.role || '').toLowerCase();
  if (role === 'main' || role === 'sub') return true;
  if (handledBy.id && handledBy.id === sellerId) return true;
  if (handledBy.parentId && handledBy.parentId === sellerId) return true;
  return role ? false : null;
};

// Was this order cancelled by the seller (excludes buyer cancellations when we
// can tell)? Unknown attribution falls back to counting it (best-effort).
const cancelledBySeller = (o: Order, sellerId: string): boolean => {
  if (String(o.status) !== 'cancelled') {
    const everCancelled = (o.statusHistory || []).some((h) => String(h.status) === 'cancelled');
    if (!everCancelled) return false;
  }
  const cancelEntry = (o.statusHistory || []).filter((h) => String(h.status) === 'cancelled').pop();
  const attribution = handledBySeller(cancelEntry?.handledBy, sellerId);
  return attribution !== false; // true or unknown → seller-side
};

export function computeCancellationRate(
  orders: Order[],
  period: Period,
  sellerId: string,
): LiveMetricResult {
  const since = Date.now() - periodDays(period) * 86_400_000;
  let numerator = 0;
  let denominator = 0;
  const rows: LiveMetricRow[] = [];

  for (const o of orders) {
    const createdMs = orderCreatedMs(o);
    if (createdMs == null || createdMs < since) continue;
    if (!orderWasPaid(o)) continue;

    denominator++;
    const isCancelled = cancelledBySeller(o, sellerId);
    if (isCancelled) numerator++;

    const firstItem = (o.items && o.items[0]) || ({} as any);
    rows.push({
      ref: o.id,
      date: fmtDate(createdMs),
      productName: String(firstItem.name || o.itemsBrief || '—'),
      productImage: String(firstItem.imageUrl || o.imageUrl || ''),
      columns: [
        { label: 'Order', value: o.id },
        { label: 'Status', value: String(o.status || '') },
        { label: 'Cancelled by seller', value: isCancelled ? 'Yes' : 'No' },
        { label: 'Date', value: fmtDate(createdMs) },
      ],
    });
  }

  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  const rate = denominator > 0 ? numerator / denominator : 0;
  return { numerator, denominator, rate, rows };
}

/* ─── Same-Day Handover ──────────────────────────────────────────── */

const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export function computeSameDayHandover(
  orders: Order[],
  period: Period,
): LiveMetricResult {
  const since = Date.now() - periodDays(period) * 86_400_000;
  let numerator = 0;
  let denominator = 0;
  const rows: LiveMetricRow[] = [];

  for (const o of orders) {
    const createdMs = orderCreatedMs(o);
    if (createdMs == null || createdMs < since) continue;

    // Eligible = order reached handover / shipped (has a handover time).
    const handoverMs = toMs(o.handoverAt) ?? earliestStatusAt(o, SHIPPED_STATUSES);
    if (handoverMs == null) continue;

    denominator++;
    const isSameDay = localDay(handoverMs) === localDay(createdMs);
    if (isSameDay) numerator++;

    const firstItem = (o.items && o.items[0]) || ({} as any);
    rows.push({
      ref: o.id,
      date: fmtDate(createdMs),
      productName: String(firstItem.name || o.itemsBrief || '—'),
      productImage: String(firstItem.imageUrl || o.imageUrl || ''),
      columns: [
        { label: 'Order', value: o.id },
        { label: 'Handover', value: fmtDate(handoverMs) },
        { label: 'Window', value: isSameDay ? 'Same day' : 'Late' },
        { label: 'Date', value: fmtDate(createdMs) },
      ],
    });
  }

  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  const rate = denominator > 0 ? numerator / denominator : 0;
  return { numerator, denominator, rate, rows };
}

/* ─── Convenience: all three Fulfillment metrics at once ─────────── */

export interface FulfillmentLive {
  shipOnTimeRate: LiveMetricResult;
  cancellationRate: LiveMetricResult;
  sameDayHandoverRate: LiveMetricResult;
}

export function computeFulfillmentLive(
  orders: Order[],
  period: Period,
  sellerId: string,
): FulfillmentLive {
  return {
    shipOnTimeRate: computeShipOnTime(orders, period),
    cancellationRate: computeCancellationRate(orders, period, sellerId),
    sameDayHandoverRate: computeSameDayHandover(orders, period),
  };
}
