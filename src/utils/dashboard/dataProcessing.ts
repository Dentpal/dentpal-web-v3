/**
 * Data Processing Utilities
 * Export and aggregation functions for dashboard data
 */

import { Order } from '@/types/order';

export interface DashboardFilters {
  dateRange: {
    start: Date | null;
    end: Date | null;
  };
  status: string;
}

export interface DashboardMetrics {
  totalOrders: number;
  totalRevenue: number;
  avgOrderValue: number;
  totalItemsSold: number;
  ordersByStatus: Record<string, number>;
  revenueGrowth?: number;
}

export interface OrderRecord {
  id: string;
  sellerId?: string;
  buyerName?: string;
  buyerEmail?: string;
  status: string;
  orderDate: Date;
  totalAmount: number;
  items?: Array<{
    productId: string;
    productName: string;
    quantity: number;
    price: number;
  }>;
}

/**
 * Apply date range filter to orders
 */
export const applyDateRange = (
  orders: OrderRecord[],
  start: Date | null,
  end: Date | null
): OrderRecord[] => {
  if (!start || !end) return orders;

  return orders.filter(order => {
    const orderDate = new Date(order.orderDate);
    orderDate.setHours(0, 0, 0, 0);
    const startDate = new Date(start);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999);

    return orderDate >= startDate && orderDate <= endDate;
  });
};

/**
 * Aggregate metrics from orders
 */
export const aggregateMetrics = (orders: OrderRecord[]): DashboardMetrics => {
  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((sum, order) => sum + order.totalAmount, 0);
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const totalItemsSold = orders.reduce((sum, order) => {
    return sum + (order.items?.reduce((itemSum, item) => itemSum + item.quantity, 0) || 0);
  }, 0);

  const ordersByStatus = orders.reduce((acc, order) => {
    acc[order.status] = (acc[order.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return {
    totalOrders,
    totalRevenue,
    avgOrderValue,
    totalItemsSold,
    ordersByStatus,
  };
};

/**
 * Generate CSV from orders
 */
export const generateCSV = (orders: Order[], type: 'seller' | 'admin'): string => {
  if (orders.length === 0) return '';

  // CSV Header
  const headers = [
    'Order ID',
    'Date',
    'Customer',
    'Email',
    'Status',
    'Total Amount',
    'Items Count',
    'Payment Method',
  ];

  // CSV Rows
  const rows = orders.map(order => [
    order.id || '',
    new Date(order.orderDate).toLocaleDateString(),
    order.buyerName || '',
    order.buyerEmail || '',
    order.status || '',
    order.totalAmount?.toString() || '0',
    order.items?.length?.toString() || '0',
    order.paymentMethod || '',
  ]);

  // Combine
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
  ].join('\n');

  return csvContent;
};

/**
 * Generate PDF report (placeholder)
 */
export const generatePDF = (
  orders: OrderRecord[],
  metrics: DashboardMetrics,
  type: 'seller' | 'admin'
): void => {
  // This is a placeholder for PDF generation
  // In a real implementation, you would use a library like jsPDF or pdfmake
  console.log('PDF generation not yet implemented');
  console.log('Orders:', orders.length);
  console.log('Metrics:', metrics);
};
