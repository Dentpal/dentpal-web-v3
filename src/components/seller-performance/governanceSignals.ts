/**
 * Real Governance signal for a single seller:
 *   - Valid Ban Rate (approx — bans that carry a written reason ÷ total bans)
 *
 * Approximate: there is no reason taxonomy or evidence field today, so "valid"
 * is taken to mean "has a non-empty reason".
 */
import type { Period } from './scoring';
import type { BannedBuyerRecord } from '@/services/sellers';
import { windowStart, fmtLocalDate, toMs, type LiveMetricResult, type LiveMetricRow } from './fulfillmentSignals';

export function computeValidBanRate(bans: BannedBuyerRecord[], period: Period): LiveMetricResult {
  const since = windowStart(period);
  let numerator = 0;
  let denominator = 0;
  const rows: LiveMetricRow[] = [];

  for (const b of bans) {
    const bannedMs = toMs(b.bannedAt) ?? Date.now();
    if (bannedMs < since) continue;
    denominator++;
    const hasReason = !!(b.reason && b.reason.trim());
    if (hasReason) numerator++;
    rows.push({
      ref: b.buyerId,
      date: fmtLocalDate(bannedMs),
      productName: b.buyerName || b.buyerId,
      productImage: '',
      columns: [
        { label: 'Buyer', value: b.buyerName || b.buyerId },
        { label: 'Reason', value: hasReason ? (b.reason as string) : '— (no reason)' },
        { label: 'Date', value: fmtLocalDate(bannedMs) },
      ],
    });
  }

  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  return {
    numerator,
    denominator,
    rate: denominator > 0 ? numerator / denominator : 0,
    approx: true,
    rows,
  };
}
