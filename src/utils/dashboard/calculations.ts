/**
 * Dashboard Calculation Utilities
 * Pure functions for metric calculations
 */

import { Order } from '@/types/order';
import { 
  KPIMetrics, 
  FinancialMetrics, 
  ItemMetrics, 
  CategoryMetrics, 
  PaymentTypeMetrics 
} from '@/types/dashboard';
import { toMs, avg } from './dateHelpers';
import { isWithdrawableStatus } from './filterHelpers';

/**
 * Calculate KPI metrics for seller dashboard
 */
export const calculateKPIMetrics = (paidOrders: Order[]): KPIMetrics => {
  const receipts = paidOrders.length;
  const totalRevenue = paidOrders.reduce((s, o) => s + (Number(o.summary?.subtotal) || 0), 0);
  const avgSalePerTxn = receipts ? (totalRevenue / receipts) : 0;
  const logisticsDue = paidOrders.reduce((s, o) => s + (Number(o.shipping || 0) + Number(o.fees || 0)), 0);

  // Calculate pack and handover durations
  const packDurations: number[] = [];
  const handoverDurations: number[] = [];
  
  paidOrders.forEach(o => {
    const created = toMs(o.createdAt || o.timestamp);
    const packed = toMs(o.packedAt);
    const handover = toMs(o.handoverAt);
    
    if (created != null && packed != null && packed >= created) {
      packDurations.push((packed - created) / 60000);
    }
    if (created != null && handover != null && handover >= created) {
      handoverDurations.push((handover - created) / 60000);
    }
  });

  const avgPackMins = avg(packDurations) ?? 80;
  const avgHandoverMins = avg(handoverDurations) ?? 165;

  return { 
    receipts, 
    totalRevenue, 
    avgSalePerTxn, 
    logisticsDue, 
    avgPackMins, 
    avgHandoverMins 
  };
};

/**
 * Calculate financial metrics for seller dashboard
 */
export const calculateFinancialMetrics = (orders: Order[]): FinancialMetrics => {
  if (!orders || orders.length === 0) {
    return {
      totalPaymentProcessingFee: 0,
      totalPlatformFee: 0,
      totalShippingCharge: 0,
      totalNetPayout: 0,
      totalGross: 0,
    };
  }

  let totalPaymentProcessingFee = 0;
  let totalPlatformFee = 0;
  let totalShippingCharge = 0;
  let totalNetPayout = 0;
  let totalGross = 0;

  orders.forEach(order => {
    // Only count completed orders for withdrawal metrics
    if (!isWithdrawableStatus(order.status)) return;

    const summary = order.summary || {};
    const subtotal = Number(summary.subtotal || 0);
    
    if (subtotal > 0) {
      totalGross += subtotal;
      
      const feesData = order.feesBreakdown || {};
      totalPaymentProcessingFee += Number(feesData.paymentProcessingFee || 0);
      totalPlatformFee += Number(feesData.platformFee || 0);
      totalShippingCharge += Number(summary.sellerShippingCharge || 0);
      
      const payout = order.payout || {};
      totalNetPayout += Number(payout.netPayoutToSeller || 0);
    }
  });

  return {
    totalPaymentProcessingFee,
    totalPlatformFee,
    totalShippingCharge,
    totalNetPayout,
    totalGross,
  };
};

/**
 * Calculate item-level metrics
 */
export const calculateItemMetrics = (paidOrders: Order[]): ItemMetrics[] => {
  const itemMap = new Map<string, ItemMetrics>();

  paidOrders.forEach(order => {
    const items = order.items || [];
    const summary = order.summary || {};
    const fees = order.feesBreakdown || {};
    
    const orderSubtotal = Number(summary.subtotal) || 0;
    const orderPaymentFee = Number(fees.paymentProcessingFee) || 0;
    const orderShippingFee = Number(summary.sellerShippingCharge) || 0;
    const orderPlatformFee = Number(fees.platformFee) || 0;

    items.forEach((item: any) => {
      const itemName = item.productName || item.name || 'Unknown Item';
      const quantity = Number(item.quantity) || 0;
      const price = Number(item.price) || 0;
      const itemSubtotal = Number(item.subtotal) || (price * quantity);
      
      // Proportionally allocate fees to this item
      const feeRatio = orderSubtotal > 0 ? itemSubtotal / orderSubtotal : 0;
      const itemPaymentFee = orderPaymentFee * feeRatio;
      const itemShippingFee = orderShippingFee * feeRatio;
      const itemPlatformFee = orderPlatformFee * feeRatio;
      const itemNetPayout = itemSubtotal - itemPaymentFee - itemShippingFee - itemPlatformFee;

      const existing = itemMap.get(itemName) || {
        name: itemName,
        sold: 0,
        refunded: 0,
        grossSales: 0,
        refunds: 0,
        paymentFee: 0,
        shippingFee: 0,
        platformFee: 0,
        netPayout: 0
      };

      itemMap.set(itemName, {
        name: itemName,
        sold: existing.sold + quantity,
        refunded: existing.refunded,
        grossSales: existing.grossSales + itemSubtotal,
        refunds: existing.refunds,
        paymentFee: existing.paymentFee + itemPaymentFee,
        shippingFee: existing.shippingFee + itemShippingFee,
        platformFee: existing.platformFee + itemPlatformFee,
        netPayout: existing.netPayout + itemNetPayout
      });
    });
  });

  return Array.from(itemMap.values()).sort((a, b) => b.netPayout - a.netPayout);
};

/**
 * Calculate category-level metrics
 */
export const calculateCategoryMetrics = (paidOrders: Order[]): CategoryMetrics[] => {
  const categoryMap = new Map<string, CategoryMetrics>();

  paidOrders.forEach(order => {
    const items = order.items || [];
    const summary = order.summary || {};
    const fees = order.feesBreakdown || {};
    
    const orderSubtotal = Number(summary.subtotal) || 0;
    const orderPaymentFee = Number(fees.paymentProcessingFee) || 0;
    const orderShippingFee = Number(summary.sellerShippingCharge) || 0;
    const orderPlatformFee = Number(fees.platformFee) || 0;

    items.forEach((item: any) => {
      const categoryName = item.category || 'Uncategorized';
      const quantity = Number(item.quantity) || 0;
      const price = Number(item.price) || 0;
      const itemSubtotal = Number(item.subtotal) || (price * quantity);
      
      const feeRatio = orderSubtotal > 0 ? itemSubtotal / orderSubtotal : 0;
      const itemPaymentFee = orderPaymentFee * feeRatio;
      const itemShippingFee = orderShippingFee * feeRatio;
      const itemPlatformFee = orderPlatformFee * feeRatio;
      const itemNetPayout = itemSubtotal - itemPaymentFee - itemShippingFee - itemPlatformFee;

      const existing = categoryMap.get(categoryName) || {
        name: categoryName,
        sold: 0,
        refunded: 0,
        grossSales: 0,
        refunds: 0,
        paymentFee: 0,
        shippingFee: 0,
        platformFee: 0,
        netPayout: 0
      };

      categoryMap.set(categoryName, {
        name: categoryName,
        sold: existing.sold + quantity,
        refunded: existing.refunded,
        grossSales: existing.grossSales + itemSubtotal,
        refunds: existing.refunds,
        paymentFee: existing.paymentFee + itemPaymentFee,
        shippingFee: existing.shippingFee + itemShippingFee,
        platformFee: existing.platformFee + itemPlatformFee,
        netPayout: existing.netPayout + itemNetPayout
      });
    });
  });

  return Array.from(categoryMap.values()).sort((a, b) => b.netPayout - a.netPayout);
};

/**
 * Calculate payment type metrics
 */
export const calculatePaymentTypeMetrics = (paidOrders: Order[]): PaymentTypeMetrics[] => {
  const paymentTypeMap = new Map<string, PaymentTypeMetrics>();

  paidOrders.forEach(order => {
    const items = order.items || [];
    const summary = order.summary || {};
    const fees = order.feesBreakdown || {};
    
    const paymentMethod = fees.paymentMethod || 'Unknown';
    const orderSubtotal = Number(summary.subtotal) || 0;
    const orderPaymentFee = Number(fees.paymentProcessingFee) || 0;
    const orderShippingFee = Number(summary.sellerShippingCharge) || 0;
    const orderPlatformFee = Number(fees.platformFee) || 0;

    items.forEach((item: any) => {
      const quantity = Number(item.quantity) || 0;
      const price = Number(item.price) || 0;
      const itemSubtotal = Number(item.subtotal) || (price * quantity);
      
      const feeRatio = orderSubtotal > 0 ? itemSubtotal / orderSubtotal : 0;
      const itemPaymentFee = orderPaymentFee * feeRatio;
      const itemShippingFee = orderShippingFee * feeRatio;
      const itemPlatformFee = orderPlatformFee * feeRatio;
      const itemNetPayout = itemSubtotal - itemPaymentFee - itemShippingFee - itemPlatformFee;

      const existing = paymentTypeMap.get(paymentMethod) || {
        name: paymentMethod,
        sold: 0,
        refunded: 0,
        grossSales: 0,
        refunds: 0,
        paymentFee: 0,
        shippingFee: 0,
        platformFee: 0,
        netPayout: 0
      };

      paymentTypeMap.set(paymentMethod, {
        name: paymentMethod,
        sold: existing.sold + quantity,
        refunded: existing.refunded,
        grossSales: existing.grossSales + itemSubtotal,
        refunds: existing.refunds,
        paymentFee: existing.paymentFee + itemPaymentFee,
        shippingFee: existing.shippingFee + itemShippingFee,
        platformFee: existing.platformFee + itemPlatformFee,
        netPayout: existing.netPayout + itemNetPayout
      });
    });
  });

  return Array.from(paymentTypeMap.values()).sort((a, b) => b.netPayout - a.netPayout);
};
