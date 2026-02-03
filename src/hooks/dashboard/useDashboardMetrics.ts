/**
 * Dashboard Metrics Hook
 * Calculates all dashboard metrics with memoization
 */

import { useMemo } from 'react';
import { Order } from '@/types/order';
import { DashboardFilters, KPIMetrics, FinancialMetrics } from '@/types/dashboard';
import { filterOrders, filterPaidOrders } from '@/utils/dashboard/filterHelpers';
import { 
  calculateKPIMetrics, 
  calculateFinancialMetrics,
  calculateItemMetrics,
  calculateCategoryMetrics,
  calculatePaymentTypeMetrics
} from '@/utils/dashboard/calculations';

interface UseDashboardMetricsProps {
  orders: Order[];
  filters: DashboardFilters;
}

export const useDashboardMetrics = ({ orders, filters }: UseDashboardMetricsProps) => {
  // Filter orders based on current filters
  const filteredOrders = useMemo(() => {
    return filterOrders(orders, filters);
  }, [orders, filters]);

  // Get only paid orders
  const paidOrders = useMemo(() => {
    return filterPaidOrders(filteredOrders);
  }, [filteredOrders]);

  // Calculate KPI metrics
  const kpiMetrics = useMemo<KPIMetrics>(() => {
    return calculateKPIMetrics(paidOrders);
  }, [paidOrders]);

  // Calculate financial metrics (completed orders only)
  const financialMetrics = useMemo<FinancialMetrics>(() => {
    return calculateFinancialMetrics(orders);
  }, [orders]);

  // Calculate item metrics
  const itemMetrics = useMemo(() => {
    return calculateItemMetrics(paidOrders);
  }, [paidOrders]);

  // Calculate category metrics
  const categoryMetrics = useMemo(() => {
    return calculateCategoryMetrics(paidOrders);
  }, [paidOrders]);

  // Calculate payment type metrics
  const paymentTypeMetrics = useMemo(() => {
    return calculatePaymentTypeMetrics(paidOrders);
  }, [paidOrders]);

  // Calculate revenue by date for chart
  const revenueByDate = useMemo(() => {
    const byDate = new Map<string, { amount: number; count: number }>();
    
    paidOrders.forEach(o => {
      const key = o.timestamp?.slice(0, 10); // YYYY-MM-DD
      if (!key) return;
      
      const prev = byDate.get(key) || { amount: 0, count: 0 };
      byDate.set(key, { 
        amount: prev.amount + (Number(o.summary?.subtotal) || 0), 
        count: prev.count + 1 
      });
    });
    
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => {
        const [, month, day] = date.split('-');
        const label = `${month}/${day}`;
        return { name: label, revenue: v.amount, count: v.count };
      });
      });
  }, [paidOrders]);

  return {
    filteredOrders,
    paidOrders,
    kpiMetrics,
    financialMetrics,
    itemMetrics,
    categoryMetrics,
    paymentTypeMetrics,
    revenueByDate,
  };
};
