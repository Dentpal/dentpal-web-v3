import { Timestamp } from 'firebase/firestore';

// Interface for order data structure
export interface Order {
  id: string;
  orderCount: number;
  barcode: string;
  timestamp: string; // Accrual basis date (order created date, YYYY-MM-DD)
  // New: full createdAt ISO timestamp to compute durations more precisely
  createdAt?: string; // ISO string e.g. 2024-09-09T08:30:00.000Z
  customer: {
    name: string;
    contact: string;
  };
  // Optional identifiers for reporting
  userId?: string; // Primary field: User ID who placed the order
  customerId?: string; // Legacy/alternative field name
  sellerIds?: string[];
  // Region info derived from shipping address
  region?: {
    barangay?: string;
    municipality?: string;
    province?: string;
    zip?: string;
  };
  // New: seller display name (may be "Multiple Sellers" in admin view)
  sellerName?: string;
  // New: brief of items like "Product A x 2 + 1 more"
  itemsBrief?: string;
  // New: monetary total and currency
  total?: number;
  currency?: string;
  // New: payment type/method for reporting
  paymentType?: string;
  // New: payment transaction id and cash-basis timestamps
  paymentTxnId?: string;
  paidAt?: string; // Cash basis date (YYYY-MM-DD) or ISO if available
  refundedAt?: string; // Refund recognition date (YYYY-MM-DD) or ISO if available
  // New: breakdown amounts for accounting
  tax?: number;
  discount?: number;
  shipping?: number;
  fees?: number;
  // Costing
  cogs?: number;
  grossMargin?: number;
  // New: thumbnail of the first item purchased
  imageUrl?: string;
  // New: fulfillment lifecycle timestamps (ISO strings if present in Firestore)
  packedAt?: string; // when the order was packed / moved to to-ship
  handoverAt?: string; // when the parcel was handed over to courier
  deliveredAt?: string; // when the parcel was delivered/completed
  package: {
    size: 'small' | 'medium' | 'large';
    dimensions: string;
    weight: string;
  };
  priority: 'normal' | 'priority' | 'urgent';
  // Extended to support additional lifecycle stages in Seller Orders
  status: 'pending' | 'confirmed' | 'to_ship' | 'processing' | 'shipped' | 'shipping' | 'pickup' | 'completed' | 'cancelled' | 'returned' | 'refunded' | 'return_refund' | 'failed-delivery' | 'return_requested' | 'return_approved' | 'return_rejected';
  // New: fulfillment stage for to-ship sub-tabs
  fulfillmentStage?: 'to-pack' | 'to-arrangement' | 'to-hand-over';
  // New: status history tracking
  statusHistory?: Array<{
    status: string;
    note: string;
    timestamp: Timestamp | Date;
    // Actor who performed this transition.
    // Legacy entries may have a plain uid string; new entries are an object
    // self-describing the role (main seller vs sub-account).
    handledBy?: string | {
      id: string;
      role: 'main' | 'sub';
      parentId?: string; // owning seller uid (only when role === 'sub')
    };
  }>;
  // Return request information
  returnRequestId?: string;
  returnRequest?: {
    id: string;
    reason: string;
    customReason?: string;
    status: 'pending' | 'approved' | 'rejected' | 'completed';
    requestedAt: Timestamp | Date | string;
    deliveryDate?: Timestamp | Date | string;
    orderTotal?: number;
    itemsToReturn?: string[];
    responseMessage?: string;
    respondedAt?: Timestamp | Date | string;
    completedAt?: Timestamp | Date | string;
    evidenceImages?: string[];
    evidenceSubmitted?: boolean;
  };
  // New: full line items for invoices/exports
  items?: Array<{
    name: string;
    quantity: number;
    price?: number;
    productId?: string;
    sku?: string;
    imageUrl?: string;
    category?: string; // optional category label
    subcategory?: string; // optional subcategory label
    categoryId?: string; // optional category id reference
    cost?: number; // unit cost for COGS
  }>;
  // NEW: Raw nested financial data structures from Firestore
  summary?: {
    subtotal?: number;
    shippingCost?: number;
    taxAmount?: number;
    discountAmount?: number;
    total?: number;
    totalItems?: number;
    sellerShippingCharge?: number;
    buyerShippingCharge?: number;
    shippingSplitRule?: string;
    packagingSize?: string;
  };
  feesBreakdown?: {
    paymentProcessingFee?: number;
    platformFee?: number;
    totalSellerFees?: number;
    paymentMethod?: string;
  };
  payout?: {
    netPayoutToSeller?: number;
    calculatedAt?: Timestamp | Date | string;
  };
  // NEW: Shipping information from JRS Express
  shippingInfo?: {
    addressId?: string;
    fullName?: string;
    addressLine1?: string;
    addressLine2?: string | null;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    phoneNumber?: string;
    packagingSize?: string;
    jrs?: {
      trackingId?: string;
      trackingNumber?: string;
      status?: string;
      createdAt?: Timestamp | Date | string;
      pickupSchedule?: string;
      courier?: string;
    };
  };
  // NEW: PayMongo payment information
  paymongo?: {
    paymentStatus?: string; // e.g., "paid", "pending", "failed"
    checkoutSessionId?: string;
    paymentIntentId?: string;
    amount?: number;
    currency?: string;
  };
}

// Props for booking-related components
export interface BookingProps {
  // Add any props needed for booking functionality
}
