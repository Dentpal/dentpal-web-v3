/**
 * Dashboard Filter Utilities
 * Pure functions for filtering and categorizing orders
 */

import { Order } from '@/types/order';
import { DashboardFilters } from '@/types/dashboard';
import { withinLastDays } from './dateHelpers';

/**
 * Check if order status is considered "paid"
 */
export const isPaidStatus = (status: Order['status']): boolean => {
  return ['to_ship', 'processing', 'completed', 'shipping'].includes(status);
};

/**
 * Check if order status is withdrawable (completed only)
 */
export const isWithdrawableStatus = (status: Order['status']): boolean => {
  return status === 'completed';
};

/**
 * Filter orders by seller dashboard filters
 */
export const filterOrders = (
  orders: Order[],
  filters: DashboardFilters
): Order[] => {
  const { dateRange, brand, subcategory, paymentType } = filters;

  return orders.filter(order => {
    // Date filter
    if (!withinLastDays(order.timestamp, dateRange)) return false;

    // Payment type filter
    if (paymentType !== 'all' && String(order.paymentType || '').trim() !== paymentType) {
      return false;
    }

    // Item filters (brand/subcategory)
    const items = order.items || [];
    const matchProduct = brand === 'all' || items.some(it => String(it.name || '') === brand);
    const matchSubcat = subcategory === 'all' || items.some(it => String(it.subcategory || '') === subcategory);
    
    if (!matchProduct || !matchSubcat) return false;

    return true;
  });
};

/**
 * Filter only paid orders
 */
export const filterPaidOrders = (orders: Order[]): Order[] => {
  return orders.filter(order => isPaidStatus(order.status));
};

/**
 * Filter only withdrawable orders
 */
export const filterWithdrawableOrders = (orders: Order[]): Order[] => {
  return orders.filter(order => isWithdrawableStatus(order.status));
};

/**
 * Get unique product names from orders
 */
export const getProductOptions = (orders: Order[]): string[] => {
  return Array.from(
    new Set(
      orders
        .flatMap(o => (o.items || []).map(it => (it.name || '').trim()).filter(Boolean))
    )
  ).sort((a, b) => a.localeCompare(b));
};

/**
 * Get unique subcategories from orders
 */
export const getSubcategoryOptions = (orders: Order[]): string[] => {
  return Array.from(
    new Set(
      orders
        .flatMap(o => (o.items || []).map(it => (it.subcategory || '').trim()).filter(Boolean))
    )
  ).sort((a, b) => a.localeCompare(b));
};

/**
 * Get unique payment types from orders
 */
export const getPaymentTypeOptions = (orders: Order[]): string[] => {
  return Array.from(
    new Set(
      orders
        .map(o => (o.paymentType || '').trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
};

/**
 * Get order amount (fallback to calculating from items)
 */
export const getOrderAmount = (order: Order): number => {
  return typeof order.total === 'number' 
    ? order.total 
    : (order.items || []).reduce((s, it) => s + ((it.price || 0) * (it.quantity || 0)), 0) || 0;
};
