/**
 * Seller reputation scoring — single source of truth for the formula.
 *
 * Five pillars, each 0–100. Composite = weighted sum.
 * Tiers map composite → label. Weights are tunable in Settings view.
 *
 * Each pillar also has named sub-metrics with targets / directions / improve
 * tips so the UI can show a Shopee-style breakdown. Raw signal aggregation
 * from Firestore replaces `mockSignalsFor` later.
 */

export type PillarKey =
  | 'fulfillment'
  | 'service'
  | 'product'
  | 'satisfaction'
  | 'governance';

export type Period = '7d' | '30d' | '90d';

export const PILLAR_META: Record<PillarKey, { label: string; blurb: string }> = {
  fulfillment: {
    label: 'Fulfillment',
    blurb: 'Ship-on-time, cancellation rate, same-day handover',
  },
  service: {
    label: 'Service',
    blurb: 'Chat response rate & speed, dispute resolution',
  },
  product: {
    label: 'Product Health',
    blurb: 'Stock availability, OOS days, catalog freshness',
  },
  satisfaction: {
    label: 'Buyer Satisfaction',
    blurb: 'Average rating, % low-star reviews, review responses',
  },
  governance: {
    label: 'Governance',
    blurb: 'Voucher hygiene, ban-with-valid-reason rate, sub-account accountability',
  },
};

export const DEFAULT_WEIGHTS: Record<PillarKey, number> = {
  fulfillment: 0.35,
  service: 0.25,
  product: 0.20,
  satisfaction: 0.15,
  governance: 0.05,
};

export interface PillarSignals {
  fulfillment: {
    shipOnTimeRate: number;       // 0..1 (higher better)
    cancellationRate: number;     // 0..1 (lower better)
    sameDayHandoverRate: number;  // 0..1 (higher better)
  };
  service: {
    chatResponseRate: number;     // 0..1 (higher better)
    avgResponseMinutes: number;   // lower better
    disputeRate: number;          // 0..1 (lower better)
  };
  product: {
    stockAvailabilityRate: number; // 0..1 (higher better)
    avgOosDays: number;            // lower better
    newListingsLast30: number;     // count (higher better, capped)
  };
  satisfaction: {
    avgRating: number;             // 0..5 (higher better)
    lowStarRate: number;           // 0..1 (lower better)
    reviewResponseRate: number;    // 0..1 (higher better)
  };
  governance: {
    voucherAbuseFlags: number;     // count (lower better)
    validBanRate: number;          // 0..1 (higher better)
    subAccountIncidents: number;   // count (lower better)
  };
}

// ----- Sub-metric definitions (for the Shopee/Lazada style breakdown) -----

export type MetricStatus = 'excellent' | 'good' | 'needs-improvement' | 'poor';
export type MetricFormat = 'percent' | 'rating' | 'minutes' | 'days' | 'count';
export type MetricDirection = 'higher' | 'lower'; // higher-is-better / lower-is-better

export interface MetricDef {
  key: string;
  label: string;
  pillar: PillarKey;
  format: MetricFormat;
  direction: MetricDirection;
  // Thresholds in the metric's native units.
  // For higher-is-better: excellent >= t.excellent, good >= t.good, needsImprovement >= t.needsImprovement, else poor.
  // For lower-is-better: excellent <= t.excellent, good <= t.good, needsImprovement <= t.needsImprovement, else poor.
  thresholds: { excellent: number; good: number; needsImprovement: number };
  target: number; // headline target shown to seller
  blurb: string;
  improve: string;
  read: (s: PillarSignals) => number;
  // Plain-language formula shown in the breakdown panel.
  formula: string;
  // Labels for the inputs used in the formula (helps render raw counts cleanly).
  inputs: { numerator?: string; denominator?: string; raw?: string };
  // How this metric is mixed into the pillar score (string mirrors scorePillar below).
  contribution: string;
}

export const METRIC_DEFS: MetricDef[] = [
  {
    key: 'shipOnTimeRate',
    label: 'Ship-on-Time Rate',
    pillar: 'fulfillment',
    format: 'percent',
    direction: 'higher',
    thresholds: { excellent: 0.97, good: 0.9, needsImprovement: 0.8 },
    target: 0.95,
    blurb: 'Orders moved from to_pack → to_arrange → to_handover (or pickup) to shipped within the promised window.',
    improve: 'Cut packing time by preparing high-velocity SKUs the night before; flag couriers that arrive late.',
    read: (s) => s.fulfillment.shipOnTimeRate,
    formula: 'orders shipped on time ÷ total orders entering the shipping pipeline',
    inputs: { numerator: 'On-time shipments', denominator: 'Orders to ship (to_pack/to_arrange/to_handover/pickup)' },
    contribution: 'ship-on-time × 60 → Fulfillment',
  },
  {
    key: 'cancellationRate',
    label: 'Cancellation Rate',
    pillar: 'fulfillment',
    format: 'percent',
    direction: 'lower',
    thresholds: { excellent: 0.02, good: 0.05, needsImprovement: 0.1 },
    target: 0.03,
    blurb: 'Seller-side cancellations only (buyer cancellations are excluded). Reasons: out-of-stock, no-stock, refusal.',
    improve: 'Sync inventory daily and disable variants that fall below safety stock automatically.',
    read: (s) => s.fulfillment.cancellationRate,
    formula: 'orders cancelled by seller ÷ total paid orders',
    inputs: { numerator: 'Seller cancellations (excludes buyer cancels)', denominator: 'Paid orders' },
    contribution: '(1 − cancellation rate) × 25 → Fulfillment',
  },
  {
    key: 'sameDayHandoverRate',
    label: 'Same-Day Handover',
    pillar: 'fulfillment',
    format: 'percent',
    direction: 'higher',
    thresholds: { excellent: 0.85, good: 0.7, needsImprovement: 0.5 },
    target: 0.8,
    blurb: 'Orders packed and handed to the courier on the day they were placed.',
    improve: 'Set an internal cutoff time and batch-pack orders before the courier sweep.',
    read: (s) => s.fulfillment.sameDayHandoverRate,
    formula: 'same-day handovers ÷ orders placed before cutoff',
    inputs: { numerator: 'Same-day handovers', denominator: 'Eligible orders' },
    contribution: 'same-day handover × 15 → Fulfillment',
  },
  {
    key: 'chatResponseRate',
    label: 'Chat Response Rate',
    pillar: 'service',
    format: 'percent',
    direction: 'higher',
    thresholds: { excellent: 0.95, good: 0.85, needsImprovement: 0.7 },
    target: 0.9,
    blurb: 'Percentage of buyer messages replied to within the response window.',
    improve: 'Enable mobile push and assign one sub-account to chat duty during peak hours.',
    read: (s) => s.service.chatResponseRate,
    formula: 'messages replied within window ÷ buyer-initiated threads',
    inputs: { numerator: 'Replied threads', denominator: 'Buyer threads' },
    contribution: 'chat response × 50 → Service',
  },
  {
    key: 'avgResponseMinutes',
    label: 'Avg Response Time',
    pillar: 'service',
    format: 'minutes',
    direction: 'lower',
    thresholds: { excellent: 10, good: 30, needsImprovement: 60 },
    target: 15,
    blurb: 'Median time between buyer message and seller reply.',
    improve: 'Use canned replies for FAQs (sizing, shipping, payment confirmation).',
    read: (s) => s.service.avgResponseMinutes,
    formula: 'median of (reply_at − message_at) across all replied threads',
    inputs: { raw: 'Median response time' },
    contribution: 'clamp(100 − minutes) ÷ 100 × 30 → Service',
  },
  {
    key: 'disputeRate',
    label: 'Dispute Rate',
    pillar: 'service',
    format: 'percent',
    direction: 'lower',
    thresholds: { excellent: 0.01, good: 0.03, needsImprovement: 0.06 },
    target: 0.02,
    blurb: 'Orders that escalated to a return/refund dispute.',
    improve: 'Add clearer product photos and size guides; address top dispute reasons first.',
    read: (s) => s.service.disputeRate,
    formula: 'orders with a dispute opened ÷ delivered orders',
    inputs: { numerator: 'Disputed orders', denominator: 'Delivered orders' },
    contribution: '(1 − dispute rate) × 20 → Service',
  },
  {
    key: 'stockAvailabilityRate',
    label: 'Stock Availability',
    pillar: 'product',
    format: 'percent',
    direction: 'higher',
    thresholds: { excellent: 0.95, good: 0.85, needsImprovement: 0.7 },
    target: 0.9,
    blurb: 'Share of active listings that are in stock right now.',
    improve: 'Set reorder thresholds in Inventory; review low-stock report weekly.',
    read: (s) => s.product.stockAvailabilityRate,
    formula: 'in-stock SKUs ÷ active SKUs',
    inputs: { numerator: 'In-stock SKUs', denominator: 'Active SKUs' },
    contribution: 'stock availability × 60 → Product Health',
  },
  {
    key: 'avgOosDays',
    label: 'Avg Out-of-Stock Days',
    pillar: 'product',
    format: 'days',
    direction: 'lower',
    thresholds: { excellent: 3, good: 7, needsImprovement: 14 },
    target: 5,
    blurb: 'Average days a SKU stays out of stock before restock.',
    improve: 'Pre-order fast movers when stock dips below 14 days of cover.',
    read: (s) => s.product.avgOosDays,
    formula: 'Σ days each SKU was OOS ÷ count of OOS events',
    inputs: { raw: 'Average OOS days' },
    contribution: 'clamp(1 − days÷30) × 25 → Product Health',
  },
  {
    key: 'newListingsLast30',
    label: 'New Listings (30d)',
    pillar: 'product',
    format: 'count',
    direction: 'higher',
    thresholds: { excellent: 10, good: 5, needsImprovement: 2 },
    target: 8,
    blurb: 'New active SKUs added in the last 30 days.',
    improve: 'Catalog refresh boosts discovery — aim for at least one new SKU per week.',
    read: (s) => s.product.newListingsLast30,
    formula: 'count(listings created within window AND status = active)',
    inputs: { raw: 'New active listings' },
    contribution: 'clamp(count ÷ 10) × 15 → Product Health',
  },
  {
    key: 'avgRating',
    label: 'Average Rating',
    pillar: 'satisfaction',
    format: 'rating',
    direction: 'higher',
    thresholds: { excellent: 4.7, good: 4.3, needsImprovement: 3.8 },
    target: 4.5,
    blurb: 'Weighted average review score across all orders in the period.',
    improve: 'Follow up after delivery; ask buyers to update reviews after issues are resolved.',
    read: (s) => s.satisfaction.avgRating,
    formula: 'Σ (review stars) ÷ count(reviews)',
    inputs: { numerator: 'Total stars given', denominator: 'Reviews' },
    contribution: '(rating ÷ 5) × 70 → Buyer Satisfaction',
  },
  {
    key: 'lowStarRate',
    label: '1–2 Star Rate',
    pillar: 'satisfaction',
    format: 'percent',
    direction: 'lower',
    thresholds: { excellent: 0.02, good: 0.05, needsImprovement: 0.1 },
    target: 0.03,
    blurb: 'Share of reviews that came in at 1 or 2 stars.',
    improve: 'Tag low-star reviews by reason and address the top 3 every week.',
    read: (s) => s.satisfaction.lowStarRate,
    formula: 'count(reviews with 1–2 stars) ÷ count(reviews)',
    inputs: { numerator: '1–2 star reviews', denominator: 'Reviews' },
    contribution: '(1 − low-star rate) × 15 → Buyer Satisfaction',
  },
  {
    key: 'reviewResponseRate',
    label: 'Review Response Rate',
    pillar: 'satisfaction',
    format: 'percent',
    direction: 'higher',
    thresholds: { excellent: 0.7, good: 0.5, needsImprovement: 0.3 },
    target: 0.6,
    blurb: 'Share of reviews the seller replied to (especially low-star).',
    improve: 'Reply to every 1–2 star review within 48 hours with a remediation.',
    read: (s) => s.satisfaction.reviewResponseRate,
    formula: 'count(reviews with seller reply) ÷ count(reviews)',
    inputs: { numerator: 'Replied reviews', denominator: 'Reviews' },
    contribution: 'review response × 15 → Buyer Satisfaction',
  },
  {
    key: 'voucherAbuseFlags',
    label: 'Voucher Abuse Flags',
    pillar: 'governance',
    format: 'count',
    direction: 'lower',
    thresholds: { excellent: 0, good: 1, needsImprovement: 3 },
    target: 0,
    blurb: 'Voucher policy violations flagged by the platform (stacking, fake codes, retroactive use).',
    improve: 'Review voucher rules before publishing; avoid backdating or overlapping promos.',
    read: (s) => s.governance.voucherAbuseFlags,
    formula: 'count(voucher_flag events in window)',
    inputs: { raw: 'Voucher flags' },
    contribution: 'clamp(1 − flags÷10) × 40 → Governance',
  },
  {
    key: 'validBanRate',
    label: 'Valid Ban Rate',
    pillar: 'governance',
    format: 'percent',
    direction: 'higher',
    thresholds: { excellent: 0.9, good: 0.7, needsImprovement: 0.5 },
    target: 0.85,
    blurb: 'Share of buyer-bans that included a documented, valid reason.',
    improve: 'Always pick a reason from the dropdown and attach evidence (chat, order ID).',
    read: (s) => s.governance.validBanRate,
    formula: 'count(bans with valid reason + evidence) ÷ count(bans)',
    inputs: { numerator: 'Bans with valid reason', denominator: 'Total bans' },
    contribution: 'valid ban rate × 40 → Governance',
  },
  {
    key: 'subAccountIncidents',
    label: 'Sub-Account Incidents',
    pillar: 'governance',
    format: 'count',
    direction: 'lower',
    thresholds: { excellent: 0, good: 1, needsImprovement: 3 },
    target: 0,
    blurb: 'Policy or process incidents traced to sub-accounts (mishandled orders, mass actions).',
    improve: 'Audit sub-account activity weekly; restrict permissions for new hires.',
    read: (s) => s.governance.subAccountIncidents,
    formula: 'count(incidents flagged where actor is a sub-account)',
    inputs: { raw: 'Sub-account incidents' },
    contribution: 'clamp(1 − incidents÷10) × 20 → Governance',
  },
];

// Per-pillar weighted formula (mirrors scorePillar). Shown in the breakdown.
export const PILLAR_FORMULA: Record<PillarKey, string> = {
  fulfillment: 'ship-on-time × 60 + (1 − cancellation) × 25 + same-day × 15',
  service: 'chat response × 50 + clamp(100 − minutes)÷100 × 30 + (1 − dispute) × 20',
  product: 'stock availability × 60 + clamp(1 − OOS÷30) × 25 + clamp(new÷10) × 15',
  satisfaction: '(rating ÷ 5) × 70 + (1 − low-star) × 15 + review response × 15',
  governance: 'clamp(1 − voucher÷10) × 40 + valid-ban × 40 + clamp(1 − incidents÷10) × 20',
};

export const METRICS_BY_PILLAR: Record<PillarKey, MetricDef[]> = METRIC_DEFS.reduce(
  (acc, m) => {
    (acc[m.pillar] ||= []).push(m);
    return acc;
  },
  {} as Record<PillarKey, MetricDef[]>,
);

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

export function statusFor(def: MetricDef, value: number): MetricStatus {
  const t = def.thresholds;
  if (def.direction === 'higher') {
    if (value >= t.excellent) return 'excellent';
    if (value >= t.good) return 'good';
    if (value >= t.needsImprovement) return 'needs-improvement';
    return 'poor';
  }
  if (value <= t.excellent) return 'excellent';
  if (value <= t.good) return 'good';
  if (value <= t.needsImprovement) return 'needs-improvement';
  return 'poor';
}

export const STATUS_STYLE: Record<MetricStatus, { label: string; cls: string; dot: string }> = {
  excellent: { label: 'Excellent', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  good: { label: 'Good', cls: 'bg-blue-100 text-blue-800 border-blue-200', dot: 'bg-blue-500' },
  'needs-improvement': { label: 'Needs Improvement', cls: 'bg-amber-100 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  poor: { label: 'Poor', cls: 'bg-red-100 text-red-800 border-red-200', dot: 'bg-red-500' },
};

export function formatMetric(def: MetricDef, value: number): string {
  switch (def.format) {
    case 'percent': return `${(value * 100).toFixed(1)}%`;
    case 'rating': return `${value.toFixed(2)} / 5`;
    case 'minutes': return value < 60 ? `${Math.round(value)} min` : `${(value / 60).toFixed(1)} hr`;
    case 'days': return `${value.toFixed(1)} days`;
    case 'count': return `${Math.round(value)}`;
  }
}

export function scorePillar(key: PillarKey, s: PillarSignals): number {
  switch (key) {
    case 'fulfillment': {
      const { shipOnTimeRate, cancellationRate, sameDayHandoverRate } = s.fulfillment;
      return clamp(
        shipOnTimeRate * 60 +
          (1 - cancellationRate) * 25 +
          sameDayHandoverRate * 15,
      );
    }
    case 'service': {
      const { chatResponseRate, avgResponseMinutes, disputeRate } = s.service;
      const speedScore = clamp(100 - avgResponseMinutes, 0, 100) / 100;
      return clamp(chatResponseRate * 50 + speedScore * 30 + (1 - disputeRate) * 20);
    }
    case 'product': {
      const { stockAvailabilityRate, avgOosDays, newListingsLast30 } = s.product;
      const oosScore = clamp(1 - avgOosDays / 30, 0, 1);
      const freshnessScore = clamp(newListingsLast30 / 10, 0, 1);
      return clamp(stockAvailabilityRate * 60 + oosScore * 25 + freshnessScore * 15);
    }
    case 'satisfaction': {
      const { avgRating, lowStarRate, reviewResponseRate } = s.satisfaction;
      return clamp((avgRating / 5) * 70 + (1 - lowStarRate) * 15 + reviewResponseRate * 15);
    }
    case 'governance': {
      const { voucherAbuseFlags, validBanRate, subAccountIncidents } = s.governance;
      const voucherScore = clamp(1 - voucherAbuseFlags / 10, 0, 1);
      const subAcctScore = clamp(1 - subAccountIncidents / 10, 0, 1);
      return clamp(voucherScore * 40 + validBanRate * 40 + subAcctScore * 20);
    }
  }
}

export function compositeScore(
  signals: PillarSignals,
  weights: Record<PillarKey, number> = DEFAULT_WEIGHTS,
): { total: number; pillars: Record<PillarKey, number> } {
  const pillars = (Object.keys(PILLAR_META) as PillarKey[]).reduce(
    (acc, k) => { acc[k] = scorePillar(k, signals); return acc; },
    {} as Record<PillarKey, number>,
  );
  const total = (Object.keys(pillars) as PillarKey[]).reduce(
    (sum, k) => sum + pillars[k] * (weights[k] ?? 0),
    0,
  );
  return { total: Math.round(total), pillars };
}

// Per-metric contribution to its pillar score. Weight + a 0..1 value function
// that mirrors the math in scorePillar above. Used by liveCompositeScore to
// renormalize over only the metrics that have real data.
export const METRIC_CONTRIB: Record<string, { pillar: PillarKey; weight: number; value: (s: PillarSignals) => number }> = {
  shipOnTimeRate:        { pillar: 'fulfillment',  weight: 60, value: (s) => s.fulfillment.shipOnTimeRate },
  cancellationRate:      { pillar: 'fulfillment',  weight: 25, value: (s) => 1 - s.fulfillment.cancellationRate },
  sameDayHandoverRate:   { pillar: 'fulfillment',  weight: 15, value: (s) => s.fulfillment.sameDayHandoverRate },
  chatResponseRate:      { pillar: 'service',      weight: 50, value: (s) => s.service.chatResponseRate },
  avgResponseMinutes:    { pillar: 'service',      weight: 30, value: (s) => clamp(100 - s.service.avgResponseMinutes, 0, 100) / 100 },
  disputeRate:           { pillar: 'service',      weight: 20, value: (s) => 1 - s.service.disputeRate },
  stockAvailabilityRate: { pillar: 'product',      weight: 60, value: (s) => s.product.stockAvailabilityRate },
  avgOosDays:            { pillar: 'product',      weight: 25, value: (s) => clamp(1 - s.product.avgOosDays / 30, 0, 1) },
  newListingsLast30:     { pillar: 'product',      weight: 15, value: (s) => clamp(s.product.newListingsLast30 / 10, 0, 1) },
  avgRating:             { pillar: 'satisfaction', weight: 70, value: (s) => s.satisfaction.avgRating / 5 },
  lowStarRate:           { pillar: 'satisfaction', weight: 15, value: (s) => 1 - s.satisfaction.lowStarRate },
  reviewResponseRate:    { pillar: 'satisfaction', weight: 15, value: (s) => s.satisfaction.reviewResponseRate },
  voucherAbuseFlags:     { pillar: 'governance',   weight: 40, value: (s) => clamp(1 - s.governance.voucherAbuseFlags / 10, 0, 1) },
  validBanRate:          { pillar: 'governance',   weight: 40, value: (s) => s.governance.validBanRate },
  subAccountIncidents:   { pillar: 'governance',   weight: 20, value: (s) => clamp(1 - s.governance.subAccountIncidents / 10, 0, 1) },
};

// Composite + pillar scores that include only metrics with real data.
// Intra-pillar weights renormalize over available metrics; a pillar with no
// available metrics scores `null` and is dropped from the composite (whose
// pillar weights then renormalize over the remaining pillars).
export function liveCompositeScore(
  signals: PillarSignals,
  availability: Record<string, boolean>,
  weights: Record<PillarKey, number> = DEFAULT_WEIGHTS,
): { total: number; pillars: Record<PillarKey, number | null> } {
  const pillars = {} as Record<PillarKey, number | null>;
  for (const pk of Object.keys(PILLAR_META) as PillarKey[]) {
    const entries = Object.entries(METRIC_CONTRIB).filter(([k, c]) => c.pillar === pk && availability[k]);
    if (entries.length === 0) { pillars[pk] = null; continue; }
    const totalWeight = entries.reduce((sum, [, c]) => sum + c.weight, 0);
    const weighted = entries.reduce((sum, [, c]) => sum + c.value(signals) * c.weight, 0);
    pillars[pk] = clamp((weighted / totalWeight) * 100);
  }
  const present = (Object.keys(pillars) as PillarKey[]).filter((pk) => pillars[pk] != null);
  const wsum = present.reduce((sum, pk) => sum + (weights[pk] ?? 0), 0);
  const total = wsum > 0
    ? Math.round(present.reduce((sum, pk) => sum + (pillars[pk] as number) * (weights[pk] ?? 0), 0) / wsum)
    : 0;
  return { total, pillars };
}

export type Tier = 'preferred' | 'standard' | 'probation' | 'suspended';

export function tierFor(score: number): Tier {
  if (score >= 85) return 'preferred';
  if (score >= 65) return 'standard';
  if (score >= 45) return 'probation';
  return 'suspended';
}

export const TIER_STYLE: Record<Tier, { label: string; cls: string }> = {
  preferred: { label: 'Preferred', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  standard: { label: 'Standard', cls: 'bg-green-100 text-green-800 border-green-200' },
  probation: { label: 'Probation', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  suspended: { label: 'At Risk', cls: 'bg-red-100 text-red-800 border-red-200' },
};

export const TIER_BENEFITS: Record<Tier, string[]> = {
  preferred: [
    'Search ranking boost',
    'Eligible for featured placement & campaigns',
    'Lower platform fee tier',
    'Priority support response',
  ],
  standard: [
    'Standard search ranking',
    'Eligible for general promotions',
    'Standard platform fee',
  ],
  probation: [
    'Reduced search visibility',
    'Cannot join featured campaigns',
    'Daily monitoring by ops team',
    'Action plan required to recover',
  ],
  suspended: [
    'Listings hidden from discovery',
    'No promotional eligibility',
    'Withdrawal hold may apply',
    'Account review required to reinstate',
  ],
};

// Penalty point system (Shopee-style). Each non-compliant signal accrues
// points that decay after 90 days. 8+ points → tier downgrade; 12+ → suspension.
export function penaltyPoints(signals: PillarSignals): {
  total: number;
  items: { reason: string; points: number }[];
} {
  const items: { reason: string; points: number }[] = [];
  if (signals.fulfillment.cancellationRate > 0.1) items.push({ reason: 'Cancellation rate exceeds 10%', points: 4 });
  else if (signals.fulfillment.cancellationRate > 0.05) items.push({ reason: 'Cancellation rate exceeds 5%', points: 2 });
  if (signals.fulfillment.shipOnTimeRate < 0.8) items.push({ reason: 'Late shipment rate over 20%', points: 3 });
  if (signals.service.disputeRate > 0.06) items.push({ reason: 'High dispute rate', points: 3 });
  if (signals.service.chatResponseRate < 0.7) items.push({ reason: 'Low chat response rate', points: 2 });
  if (signals.governance.voucherAbuseFlags > 0) items.push({ reason: `${signals.governance.voucherAbuseFlags} voucher abuse flag(s)`, points: signals.governance.voucherAbuseFlags * 2 });
  if (signals.governance.subAccountIncidents > 2) items.push({ reason: 'Multiple sub-account incidents', points: 3 });
  return { total: items.reduce((s, i) => s + i.points, 0), items };
}

// Deterministic placeholder signals derived from sellerId+period — replaced
// when the real event aggregation is wired up.
export function mockSignalsFor(sellerId: string, period: Period = '30d'): PillarSignals {
  const seed = sellerId + '|' + period;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const r = (offset: number) => {
    const x = Math.sin(h + offset) * 10000;
    return x - Math.floor(x);
  };
  return {
    fulfillment: {
      shipOnTimeRate: 0.7 + r(1) * 0.3,
      cancellationRate: r(2) * 0.15,
      sameDayHandoverRate: 0.5 + r(3) * 0.5,
    },
    service: {
      chatResponseRate: 0.6 + r(4) * 0.4,
      avgResponseMinutes: r(5) * 90,
      disputeRate: r(6) * 0.1,
    },
    product: {
      stockAvailabilityRate: 0.7 + r(7) * 0.3,
      avgOosDays: r(8) * 20,
      newListingsLast30: Math.floor(r(9) * 15),
    },
    satisfaction: {
      avgRating: 3.5 + r(10) * 1.5,
      lowStarRate: r(11) * 0.2,
      reviewResponseRate: r(12),
    },
    governance: {
      voucherAbuseFlags: Math.floor(r(13) * 5),
      validBanRate: 0.5 + r(14) * 0.5,
      subAccountIncidents: Math.floor(r(15) * 4),
    },
  };
}

// Mock historical points for a metric — used by sparklines.
export function mockHistory(sellerId: string, metricKey: string, period: Period): number[] {
  const points = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const seed = sellerId + '|' + metricKey;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const out: number[] = [];
  const cur = (Math.sin(h) * 10000) - Math.floor(Math.sin(h) * 10000);
  let v = cur;
  for (let i = 0; i < points; i++) {
    const j = (Math.sin(h + i * 7) * 10000);
    v = Math.max(0, Math.min(1, v + (j - Math.floor(j) - 0.5) * 0.06));
    out.push(v);
  }
  return out;
}

// Compare current to previous period of the same length for delta arrows.
export function previousSignals(sellerId: string, period: Period): PillarSignals {
  return mockSignalsFor(sellerId + '|prev', period);
}

// Plausible raw counts for the breakdown panel. Stable per (seller, metric, period).
// Replace with real Firestore aggregates when wiring data.
export interface RawCounts {
  numerator?: number;
  denominator?: number;
  raw?: number;
}

export function mockRawCounts(
  sellerId: string,
  def: MetricDef,
  value: number,
  period: Period,
): RawCounts {
  const seed = sellerId + '|' + def.key + '|' + period;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const r = Math.sin(h) * 10000;
  const jitter = r - Math.floor(r);
  const baseDen = period === '7d' ? 60 : period === '30d' ? 240 : 720;

  if (def.format === 'percent') {
    const denominator = Math.max(10, Math.floor(baseDen * (0.7 + jitter * 0.6)));
    const numerator = Math.round(value * denominator);
    return { numerator, denominator };
  }
  if (def.format === 'rating') {
    const denominator = Math.max(8, Math.floor(baseDen * 0.4 * (0.7 + jitter * 0.6)));
    const numerator = Math.round(value * denominator * 10) / 10;
    return { numerator, denominator };
  }
  return { raw: value };
}

// What threshold rule placed the metric in its current status — used by UI.
export function thresholdExplain(def: MetricDef, value: number): {
  matched: string;
  scale: { label: MetricStatus; rule: string; active: boolean }[];
} {
  const t = def.thresholds;
  const fmt = (n: number) => formatMetric(def, n);
  const rules: { label: MetricStatus; rule: string }[] =
    def.direction === 'higher'
      ? [
          { label: 'excellent', rule: `≥ ${fmt(t.excellent)}` },
          { label: 'good', rule: `≥ ${fmt(t.good)}` },
          { label: 'needs-improvement', rule: `≥ ${fmt(t.needsImprovement)}` },
          { label: 'poor', rule: `< ${fmt(t.needsImprovement)}` },
        ]
      : [
          { label: 'excellent', rule: `≤ ${fmt(t.excellent)}` },
          { label: 'good', rule: `≤ ${fmt(t.good)}` },
          { label: 'needs-improvement', rule: `≤ ${fmt(t.needsImprovement)}` },
          { label: 'poor', rule: `> ${fmt(t.needsImprovement)}` },
        ];
  const status = statusFor(def, value);
  return {
    matched: rules.find((r) => r.label === status)?.rule || '',
    scale: rules.map((r) => ({ ...r, active: r.label === status })),
  };
}
