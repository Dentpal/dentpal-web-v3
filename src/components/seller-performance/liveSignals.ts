/**
 * Shared real-data signal pipeline for a single seller.
 *
 * `buildLiveSignals` is the pure computation the DetailView already used
 * inline; it turns raw Firebase sources into { liveByKey, availability,
 * signals } so the overview list and the drill-in view score identically.
 *
 * `loadSellerSources` fetches those sources once (a snapshot, not a live
 * subscription) — used by the overview to score every seller in the list.
 */
import SellersService, { type BannedBuyerRecord } from '@/services/sellers';
import OrdersService from '@/services/orders';
import ProductService from '@/services/product';
import { InventoryService } from '@/services/inventory';
import { getSellerChatThreads, type ChatThread } from '@/services/chatMetrics';
import type { Order } from '@/types/order';
import {
  computeFulfillmentLive,
  metricValue,
  metricAvailable,
  type LiveMetricResult,
} from './fulfillmentSignals';
import { computeChatMetrics, computeDisputeRate } from './serviceSignals';
import {
  computeStockAvailability,
  computeNewListings,
  computeAvgOosDays,
  type ProductRow,
  type AdjustmentRow,
} from './productSignals';
import { computeValidBanRate } from './governanceSignals';
import type { Period, PillarSignals } from './scoring';

export interface LiveSources {
  orders: Order[] | null;
  products: ProductRow[] | null;
  adjustments: AdjustmentRow[] | null;
  bans: BannedBuyerRecord[] | null;
  disputedOrderIds: Set<string> | null;
  chatThreads: ChatThread[] | null;
}

// Neutral baseline for metrics without live data. `liveCompositeScore` only
// reads values for metrics flagged available, so these numbers never reach the
// score — they exist purely to satisfy the PillarSignals shape.
export const NEUTRAL_SIGNALS: PillarSignals = {
  fulfillment: { shipOnTimeRate: 0, cancellationRate: 0, sameDayHandoverRate: 0 },
  service: { chatResponseRate: 0, avgResponseMinutes: 0, disputeRate: 0 },
  product: { stockAvailabilityRate: 0, avgOosDays: 0, newListingsLast30: 0 },
  satisfaction: { avgRating: 0, lowStarRate: 0, reviewResponseRate: 0 },
  governance: { voucherAbuseFlags: 0, validBanRate: 0, subAccountIncidents: 0 },
};

export interface BuiltSignals {
  liveByKey: Record<string, LiveMetricResult | null>;
  availability: Record<string, boolean>;
  signals: PillarSignals;
}

// Pure: raw sources → per-metric results, availability flags, and a
// PillarSignals object with live values overriding the baseline wherever
// real data exists.
export function buildLiveSignals(
  sources: LiveSources,
  period: Period,
  sellerId: string,
  baseline: PillarSignals = NEUTRAL_SIGNALS,
): BuiltSignals {
  const { orders, products, adjustments, bans, disputedOrderIds, chatThreads } = sources;

  const f = orders ? computeFulfillmentLive(orders, period, sellerId) : null;
  const chat = chatThreads ? computeChatMetrics(chatThreads, period) : null;
  const dispute = orders && disputedOrderIds ? computeDisputeRate(orders, disputedOrderIds, period) : null;

  const liveByKey: Record<string, LiveMetricResult | null> = {
    shipOnTimeRate: f?.shipOnTimeRate ?? null,
    cancellationRate: f?.cancellationRate ?? null,
    sameDayHandoverRate: f?.sameDayHandoverRate ?? null,
    chatResponseRate: chat?.chatResponseRate ?? null,
    avgResponseMinutes: chat?.avgResponseMinutes ?? null,
    disputeRate: dispute,
    stockAvailabilityRate: products ? computeStockAvailability(products) : null,
    newListingsLast30: products ? computeNewListings(products, period) : null,
    avgOosDays: adjustments ? computeAvgOosDays(adjustments, period) : null,
    validBanRate: bans ? computeValidBanRate(bans, period) : null,
  };

  const availability: Record<string, boolean> = {};
  for (const [k, r] of Object.entries(liveByKey)) availability[k] = !!r && metricAvailable(r);

  const signals: PillarSignals = {
    fulfillment: { ...baseline.fulfillment },
    service: { ...baseline.service },
    product: { ...baseline.product },
    satisfaction: { ...baseline.satisfaction },
    governance: { ...baseline.governance },
  };
  const set = (key: string, apply: (v: number) => void) => {
    const r = liveByKey[key];
    if (r && metricAvailable(r)) apply(metricValue(r));
  };
  set('shipOnTimeRate', (v) => (signals.fulfillment.shipOnTimeRate = v));
  set('cancellationRate', (v) => (signals.fulfillment.cancellationRate = v));
  set('sameDayHandoverRate', (v) => (signals.fulfillment.sameDayHandoverRate = v));
  set('chatResponseRate', (v) => (signals.service.chatResponseRate = v));
  set('avgResponseMinutes', (v) => (signals.service.avgResponseMinutes = v));
  set('disputeRate', (v) => (signals.service.disputeRate = v));
  set('stockAvailabilityRate', (v) => (signals.product.stockAvailabilityRate = v));
  set('newListingsLast30', (v) => (signals.product.newListingsLast30 = v));
  set('avgOosDays', (v) => (signals.product.avgOosDays = v));
  set('validBanRate', (v) => (signals.governance.validBanRate = v));

  return { liveByKey, availability, signals };
}

// Subscribe, resolve on the first emission, then immediately unsubscribe —
// turns a realtime listener into a one-shot fetch for the list.
function once<T>(subscribe: (cb: (v: T) => void) => (() => void) | void): Promise<T> {
  return new Promise<T>((resolve) => {
    // Holder so the callback can reach `unsub` even if it fires synchronously
    // during `subscribe()`, before the return value is assigned.
    const state: { unsub?: () => void; done: boolean } = { done: false };
    const handle = (v: T) => {
      if (state.done) return;
      state.done = true;
      resolve(v);
      state.unsub?.();
    };
    const u = subscribe(handle);
    if (typeof u === 'function') state.unsub = u;
    if (state.done) state.unsub?.();
  });
}

// Loosely-typed raw shapes emitted by the underlying services (which type
// these callbacks as any[]); narrowed to the fields we actually read.
type RawProduct = {
  id: string;
  name?: string;
  imageUrl?: string;
  status: string;
  inStock: number;
  createdAt: number;
};
type RawAdjustment = {
  id: string;
  itemName?: string;
  stockAfter?: number;
  raw?: { itemId?: string; itemName?: string; at?: { toMillis?: () => number } };
};
type RawReturnRequest = { orderId: string | number };

// One-time snapshot of every source `buildLiveSignals` needs for a seller.
export async function loadSellerSources(sellerId: string): Promise<LiveSources> {
  const [orders, products, adjustments, bans, disputedOrderIds, chatThreads] = await Promise.all([
    once<Order[]>((cb) => OrdersService.listenBySeller(sellerId, cb)).catch(() => [] as Order[]),
    once<unknown[]>((cb) => ProductService.listenBySeller(sellerId, cb))
      .then((rows) =>
        (rows as RawProduct[]).map((p) => ({
          id: p.id,
          name: p.name,
          imageUrl: p.imageUrl,
          status: p.status,
          inStock: p.inStock,
          createdAt: p.createdAt,
        })) as ProductRow[],
      )
      .catch(() => [] as ProductRow[]),
    once<unknown[]>((cb) => InventoryService.listenAdjustmentsBySeller(sellerId, cb))
      .then((rows) =>
        (rows as RawAdjustment[]).map((r) => ({
          itemId: String(r.raw?.itemId ?? r.id),
          itemName: r.itemName || r.raw?.itemName,
          at: r.raw?.at?.toMillis?.() ?? Date.now(),
          stockAfter: Number(r.stockAfter ?? 0),
        })) as AdjustmentRow[],
      )
      .catch(() => [] as AdjustmentRow[]),
    SellersService.listBannedBuyers(sellerId).catch(() => [] as BannedBuyerRecord[]),
    OrdersService.fetchReturnRequestsForSeller([sellerId])
      .then((reqs: RawReturnRequest[]) => new Set(reqs.map((r) => String(r.orderId))))
      .catch(() => new Set<string>()),
    getSellerChatThreads(sellerId).catch(() => [] as ChatThread[]),
  ]);
  return { orders, products, adjustments, bans, disputedOrderIds, chatThreads };
}
