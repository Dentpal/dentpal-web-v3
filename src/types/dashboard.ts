import { Order } from './order';

/**
 * Dashboard Filter State
 */
export interface DashboardFilters {
  dateRange: string;
  brand: string;
  subcategory: string;
  location: string;
  paymentType: string;
  viewType: 'summary' | 'item' | 'category' | 'paymentType' | 'receipts';
  viewExpanded: boolean;
}

/**
 * Admin Dashboard Filters
 */
export interface AdminFilters {
  dateRange: string;
  provinces: string[];
  cities: string[];
  searchQuery: string;
}

/**
 * Date Range State
 */
export interface DateRange {
  start: Date | null;
  end: Date | null;
}

/**
 * KPI Metrics for Seller Dashboard
 */
export interface KPIMetrics {
  receipts: number;
  totalRevenue: number;
  avgSalePerTxn: number;
  logisticsDue: number;
  avgPackMins: number;
  avgHandoverMins: number;
}

/**
 * Financial Metrics for Seller Dashboard
 */
export interface FinancialMetrics {
  totalPaymentProcessingFee: number;
  totalPlatformFee: number;
  totalShippingCharge: number;
  totalNetPayout: number;
  totalGross: number;
}

/**
 * Item Metrics
 */
export interface ItemMetrics {
  name: string;
  sold: number;
  refunded: number;
  grossSales: number;
  refunds: number;
  paymentFee: number;
  shippingFee: number;
  platformFee: number;
  netPayout: number;
}

/**
 * Category Metrics
 */
export interface CategoryMetrics {
  name: string;
  sold: number;
  refunded: number;
  grossSales: number;
  refunds: number;
  paymentFee: number;
  shippingFee: number;
  platformFee: number;
  netPayout: number;
}

/**
 * Payment Type Metrics
 */
export interface PaymentTypeMetrics {
  name: string;
  sold: number;
  refunded: number;
  grossSales: number;
  refunds: number;
  paymentFee: number;
  shippingFee: number;
  platformFee: number;
  netPayout: number;
}

/**
 * Seller Information
 */
export interface SellerInfo {
  uid: string;
  name?: string;
  shopName?: string;
  storeName?: string;
  province?: string;
  city?: string;
  zipCode?: string;
  address?: any;
  role?: string;
}

/**
 * Admin Metrics
 */
export interface AdminMetrics {
  totalOrders: number;
  deliveredOrders: number;
  shippedOrders: number;
}

/**
 * Export Column Visibility
 */
export interface ExportColumnVisibility {
  seller: boolean;
  gross: boolean;
  avg: boolean;
  tx: boolean;
  logistic: boolean;
  payment: boolean;
  inquiry: boolean;
  orderSummary: boolean;
}

/**
 * Province/City Data
 */
export interface ProvinceData {
  code: string;
  name: string;
}

export interface CityData {
  code: string;
  name: string;
  provinceCode: string;
}

/**
 * Chart Types
 */
export type ChartType = 'line' | 'bar' | 'pie';

/**
 * View Types
 */
export type ViewType = 'summary' | 'item' | 'category' | 'paymentType' | 'receipts';

/**
 * Revenue Chart Data Point
 */
export interface RevenueDataPoint {
  name: string;
  revenue: number;
  count: number;
}
