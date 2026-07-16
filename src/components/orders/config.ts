import { Order } from '@/types/order';

export type LifecycleStage = 'all' | 'unpaid' | 'confirmed' | 'to-ship' | 'shipping' | 'pick-up' | 'same-day' | 'delivered' | 'completed' | 'unfulfilled' | 'return-refund';

export type ToShipStage = 'to-pack' | 'to-arrangement' | 'to-hand-over';

export interface SubTabConfig {
  id: LifecycleStage;
  label: string;
  predicate: (o: Order) => boolean; // stage membership
}

// Provisional mapping using current simplified status values
export const mapOrderToStage = (o: Order): LifecycleStage => {
  switch (o.status) {
    case 'pending': return 'unpaid';
    case 'confirmed': return 'confirmed'; // Orders confirmed/paid but not yet moved to fulfillment
    case 'to_ship': return 'to-ship';
    case 'processing': return 'shipping';
    case 'shipping': return 'shipping';
    case 'pickup': return 'pick-up';
    case 'shipped': return 'delivered'; // Shipped orders appear in "Delivered" tab awaiting customer confirmation
    case 'completed': return 'completed';
    case 'failed-delivery': return 'unfulfilled';
    case 'cancelled': return 'unfulfilled';
    case 'return_requested':
    case 'return_approved':
    case 'return_rejected':
    case 'returned':
    case 'refunded':
    case 'return_refund':
      return 'return-refund';
    default: return 'all';
  }
};

const PICKUP_TERMINAL_STATUSES = new Set<Order['status']>([
  'completed',
  'cancelled',
  'failed-delivery',
  'return_requested',
  'return_approved',
  'return_rejected',
  'returned',
  'refunded',
  'return_refund',
]);

export const isPickupOrder = (o: Order): boolean => {
  if (PICKUP_TERMINAL_STATUSES.has(o.status)) return false;
  const breakdowns = (o as unknown as { sellerFeeBreakdowns?: Array<{ shippingMode?: string }> }).sellerFeeBreakdowns;
  if (Array.isArray(breakdowns) && breakdowns.some(b => b?.shippingMode === 'pickup')) return true;
  return o.status === 'pickup';
};

/** Same Day Delivery (Lalamove) orders — mirrors isPickupOrder. */
export const isSameDayOrder = (o: Order): boolean => {
  if (PICKUP_TERMINAL_STATUSES.has(o.status)) return false;
  const norm = (m?: string) => String(m || '').toLowerCase();
  if (Array.isArray(o.sellerFeeBreakdowns) && o.sellerFeeBreakdowns.some(b => norm(b?.shippingMode) === 'sameday')) {
    return true;
  }
  const modes = o.shippingInfo?.sellerShippingModes;
  return !!modes && Object.values(modes).some(m => norm(m) === 'sameday');
};

/**
 * "Shipping" stage: orders in transit or out for pickup/same-day — everything
 * after "To Ship" and before delivery. Delivered ('shipped', awaiting customer
 * confirmation) is its own top-level tab. The shipping method
 * (Standard/Express/Pickup/Same Day) is a sub-tab within this stage.
 */
const IN_DELIVERY_STATUSES: Order['status'][] = ['shipping', 'processing', 'pickup'];
export const isInDeliveryStage = (o: Order): boolean => IN_DELIVERY_STATUSES.includes(o.status);

/** Shipping-method sub-tab keys under the "Shipping" stage. */
export type ShippingMethod = 'all' | 'standard' | 'express' | 'pickup' | 'sameday';

/** Whether any seller in the order uses the given shipping method (multi-membership). */
export const orderUsesMethod = (o: Order, method: ShippingMethod): boolean => {
  if (method === 'all') return true;
  const norm = (m?: string) => String(m || '').toLowerCase();
  if (Array.isArray(o.sellerFeeBreakdowns) && o.sellerFeeBreakdowns.some(b => norm(b?.shippingMode) === method)) {
    return true;
  }
  const modes = o.shippingInfo?.sellerShippingModes;
  return !!modes && Object.values(modes).some(m => norm(m) === method);
};

export const SHIPPING_METHOD_SUB_TABS: { id: ShippingMethod; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'standard', label: 'Standard' },
  { id: 'express', label: 'Express' },
  { id: 'pickup', label: 'Pickup' },
  { id: 'sameday', label: 'Same Day' },
];

export const SUB_TABS: SubTabConfig[] = [
  { id: 'all', label: 'All', predicate: () => true },
  // Hidden tabs: unpaid and confirmed - orders go directly to to-ship after payment
  // { id: 'unpaid', label: 'Unpaid', predicate: (o) => mapOrderToStage(o) === 'unpaid' },
  // { id: 'confirmed', label: 'Confirmed', predicate: (o) => mapOrderToStage(o) === 'confirmed' },
  { id: 'to-ship', label: 'To Ship', predicate: (o) => mapOrderToStage(o) === 'to-ship' },
  // Shipping merges in-transit + pickup + same-day; method is a sub-tab.
  { id: 'shipping', label: 'Shipping', predicate: isInDeliveryStage },
  { id: 'delivered', label: 'Delivered', predicate: (o) => o.status === 'shipped' }, // shipped, awaiting customer confirmation
  { id: 'completed', label: 'Completed', predicate: (o) => o.status === 'completed' },
  { id: 'return-refund', label: 'Return or Refund', predicate: (o) => ['return_requested', 'return_approved', 'return_rejected', 'returned', 'refunded', 'return_refund'].includes(o.status) },
  { id: 'unfulfilled', label: 'Failed Transactions', predicate: (o) => o.status === 'cancelled' || o.status === 'failed-delivery' },
];

export const TO_SHIP_SUB_TABS: { id: ToShipStage; label: string }[] = [
  { id: 'to-pack', label: 'To Pack' },
  { id: 'to-arrangement', label: 'To Arrangement' },
  { id: 'to-hand-over', label: 'To Hand Over' },
];
