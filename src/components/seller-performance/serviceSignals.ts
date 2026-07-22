/**
 * Real Service-pillar signals for a single seller:
 *   - Chat Response Rate   (buyer threads replied to within 24h)
 *   - Avg Response Time    (median minutes to first seller reply)
 *   - Dispute Rate         (delivered orders that opened a ReturnRequest)
 */
import type { Order } from '@/types/order';
import type { Period } from './scoring';
import type { ChatThread } from '@/services/chatMetrics';
import { windowStart, orderCreatedMs, fmtLocalDate, type LiveMetricResult, type LiveMetricRow } from './fulfillmentSignals';

const RESPONSE_SLA_MS = 24 * 3_600_000; // "within the response window" = 24h

const fmtMinutes = (m: number) => (m >= 60 ? `${(m / 60).toFixed(1)}h` : `${Math.round(m)}m`);

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export interface ChatMetrics {
  chatResponseRate: LiveMetricResult;
  avgResponseMinutes: LiveMetricResult;
}

export function computeChatMetrics(threads: ChatThread[], period: Period): ChatMetrics {
  const since = windowStart(period);

  let respDenominator = 0; // buyer-initiated threads in window
  let respNumerator = 0; // …replied within 24h
  const respRows: LiveMetricRow[] = [];
  const responseMinutes: number[] = [];
  const timeRows: LiveMetricRow[] = [];

  for (const t of threads) {
    const firstBuyer = t.messages.find((m) => m.senderId === t.buyerId);
    if (!firstBuyer || firstBuyer.timestamp < since) continue; // not buyer-initiated in window

    respDenominator++;
    const firstReply = t.messages.find((m) => m.senderId !== t.buyerId && m.timestamp > firstBuyer.timestamp);
    const replyGapMs = firstReply ? firstReply.timestamp - firstBuyer.timestamp : null;
    const within = replyGapMs != null && replyGapMs <= RESPONSE_SLA_MS;
    if (within) respNumerator++;

    respRows.push({
      ref: t.id,
      date: fmtLocalDate(firstBuyer.timestamp),
      productName: t.productName || t.buyerName || '—',
      productImage: '',
      columns: [
        { label: 'Thread', value: t.id },
        { label: 'Buyer', value: t.buyerName || t.buyerId },
        { label: 'Replied ≤24h', value: within ? 'Yes' : firstReply ? 'Late' : 'No reply' },
        { label: 'Date', value: fmtLocalDate(firstBuyer.timestamp) },
      ],
    });

    if (replyGapMs != null) {
      const mins = replyGapMs / 60000;
      responseMinutes.push(mins);
      timeRows.push({
        ref: t.id,
        date: fmtLocalDate(firstBuyer.timestamp),
        productName: t.productName || t.buyerName || '—',
        productImage: '',
        columns: [
          { label: 'Thread', value: t.id },
          { label: 'Buyer', value: t.buyerName || t.buyerId },
          { label: 'Response', value: fmtMinutes(mins) },
          { label: 'Date', value: fmtLocalDate(firstBuyer.timestamp) },
        ],
      });
    }
  }

  const medMinutes = median(responseMinutes);

  return {
    chatResponseRate: {
      numerator: respNumerator,
      denominator: respDenominator,
      rate: respDenominator > 0 ? respNumerator / respDenominator : 0,
      rows: respRows,
    },
    avgResponseMinutes: {
      numerator: responseMinutes.length,
      denominator: responseMinutes.length, // replied threads
      rate: 0,
      value: medMinutes,
      rows: timeRows,
    },
  };
}

/* ─── Dispute Rate ───────────────────────────────────────────────── */

const DELIVERED_STATUSES = new Set(['completed', 'delivered']);

// `disputedOrderIds` = order ids that have a ReturnRequest (from
// OrdersService.fetchReturnRequestsForSeller). Denominator = delivered orders
// in the window; numerator = those that opened a dispute.
export function computeDisputeRate(
  orders: Order[],
  disputedOrderIds: Set<string>,
  period: Period,
): LiveMetricResult {
  const since = windowStart(period);
  let numerator = 0;
  let denominator = 0;
  const rows: LiveMetricRow[] = [];

  for (const o of orders) {
    const createdMs = orderCreatedMs(o);
    if (createdMs == null || createdMs < since) continue;
    const delivered = DELIVERED_STATUSES.has(String(o.status)) ||
      (o.statusHistory || []).some((h) => DELIVERED_STATUSES.has(String(h.status)));
    if (!delivered) continue;

    denominator++;
    const disputed = disputedOrderIds.has(o.id) || !!o.returnRequestId;
    if (disputed) numerator++;

    const firstItem = (o.items && o.items[0]) || ({} as any);
    rows.push({
      ref: o.id,
      date: fmtLocalDate(createdMs),
      productName: String(firstItem.name || o.itemsBrief || '—'),
      productImage: String(firstItem.imageUrl || o.imageUrl || ''),
      columns: [
        { label: 'Order', value: o.id },
        { label: 'Status', value: String(o.status || '') },
        { label: 'Dispute', value: disputed ? 'Yes' : 'No' },
        { label: 'Date', value: fmtLocalDate(createdMs) },
      ],
    });
  }

  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { numerator, denominator, rate: denominator > 0 ? numerator / denominator : 0, rows };
}
