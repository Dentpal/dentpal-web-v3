/**
 * Admin Dashboard Container
 * Main container for admin dashboard with seller metrics and filtering
 */

import { useState, useMemo } from 'react';
import { Order } from '@/types/order';
import { AdminFilters as AdminFiltersType } from '@/types/dashboard';
import { formatCurrency } from '@/utils/dashboard/formatters';
import { AdminFilters } from './AdminFilters';
import { SellerMetricsTable } from './SellerMetricsTable';
import { TrendingUp, Users, DollarSign, Package } from 'lucide-react';

interface AdminDashboardProps {
  orders: Order[];
  sellers: Array<{ uid: string; name: string; email: string; province?: string; city?: string }>;
  loading?: boolean;
}

export const AdminDashboard = ({ orders, sellers, loading = false }: AdminDashboardProps) => {
  const [filters, setFilters] = useState<AdminFiltersType>({
    dateRange: 'last-30',
    provinces: [],
    cities: [],
    searchQuery: '',
  });

  // Filter orders based on admin filters
  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      // Province filter
      if (filters.provinces.length > 0) {
        const sellerId = order.sellerIds?.[0];
        const sellerProvince = sellers.find(s => s.uid === sellerId)?.province;
        if (!sellerProvince || !filters.provinces.includes(sellerProvince)) {
          return false;
        }
      }

      // City filter
      if (filters.cities.length > 0) {
        const sellerId = order.sellerIds?.[0];
        const sellerCity = sellers.find(s => s.uid === sellerId)?.city;
        if (!sellerCity || !filters.cities.includes(sellerCity)) {
          return false;
        }
      }

      // Search query (seller name or order ID)
      if (filters.searchQuery) {
        const sellerId = order.sellerIds?.[0];
        const seller = sellers.find(s => s.uid === sellerId);
        const matchesName = seller?.name.toLowerCase().includes(filters.searchQuery.toLowerCase());
        const matchesOrderId = order.id?.toLowerCase().includes(filters.searchQuery.toLowerCase());
        if (!matchesName && !matchesOrderId) {
          return false;
        }
      }

      return true;
    });
  }, [orders, filters, sellers]);

  // Calculate seller metrics
  const sellerMetrics = useMemo(() => {
    const metricsMap = new Map<string, {
      sellerId: string;
      sellerName: string;
      province: string;
      city: string;
      totalOrders: number;
      totalRevenue: number;
      totalFees: number;
      netPayout: number;
      avgOrderValue: number;
      orders: Order[];
    }>();

    filteredOrders.forEach(order => {
      const sellerId = order.sellerIds?.[0];
      if (!sellerId) return;
      
      const seller = sellers.find(s => s.uid === sellerId);
      if (!seller) return;
      if (!metricsMap.has(sellerId)) {
        metricsMap.set(sellerId, {
          sellerId,
          sellerName: seller.name,
          province: seller.province || 'N/A',
          city: seller.city || 'N/A',
          totalOrders: 0,
          totalRevenue: 0,
          totalFees: 0,
          netPayout: 0,
          avgOrderValue: 0,
          orders: [],
        });
      }

      const metrics = metricsMap.get(sellerId)!;
      const revenue = Number(order.summary?.subtotal) || 0;
      const paymentFee = Number(order.feesBreakdown?.paymentProcessingFee) || 0;
      const shippingFee = Number(order.summary?.sellerShippingCharge) || 0;
      const platformFee = Number(order.feesBreakdown?.platformFee) || 0;
      const totalFees = paymentFee + shippingFee + platformFee;

      metrics.totalOrders += 1;
      metrics.totalRevenue += revenue;
      metrics.totalFees += totalFees;
      metrics.netPayout += (revenue - totalFees);
      metrics.orders.push(order);
    });

    // Calculate averages
    metricsMap.forEach(metrics => {
      metrics.avgOrderValue = metrics.totalOrders > 0 
        ? metrics.totalRevenue / metrics.totalOrders 
        : 0;
    });

    // Sort by total revenue descending
    return Array.from(metricsMap.values()).sort((a, b) => b.totalRevenue - a.totalRevenue);
  }, [filteredOrders, sellers]);

  // Calculate platform-wide metrics
  const platformMetrics = useMemo(() => {
    const totalRevenue = sellerMetrics.reduce((sum, s) => sum + s.totalRevenue, 0);
    const totalFees = sellerMetrics.reduce((sum, s) => sum + s.totalFees, 0);
    const totalOrders = sellerMetrics.reduce((sum, s) => sum + s.totalOrders, 0);
    const activeSellers = sellerMetrics.length;

    return {
      totalRevenue,
      totalFees,
      totalOrders,
      activeSellers,
      avgRevenuePerSeller: activeSellers > 0 ? totalRevenue / activeSellers : 0,
      avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
    };
  }, [sellerMetrics]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading admin dashboard...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Admin Dashboard</h2>
          <p className="text-sm text-gray-500 mt-1">Platform-wide seller performance metrics</p>
        </div>
      </div>

      {/* Filters */}
      <AdminFilters 
        filters={filters}
        setFilters={setFilters}
        sellers={sellers}
        orders={filteredOrders}
      />

      {/* Platform Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl p-6 shadow-sm border border-blue-200">
          <div className="flex items-center justify-between mb-3">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg">
              <DollarSign className="w-6 h-6 text-white" />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-blue-700 uppercase tracking-wide">Total Revenue</p>
            <p className="text-3xl font-bold text-blue-900">{formatCurrency(platformMetrics.totalRevenue)}</p>
            <p className="text-xs text-blue-600">From {platformMetrics.totalOrders.toLocaleString()} orders</p>
          </div>
        </div>

        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-2xl p-6 shadow-sm border border-emerald-200">
          <div className="flex items-center justify-between mb-3">
            <div className="w-12 h-12 bg-emerald-600 rounded-xl flex items-center justify-center shadow-lg">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-emerald-700 uppercase tracking-wide">Platform Fees</p>
            <p className="text-3xl font-bold text-emerald-900">{formatCurrency(platformMetrics.totalFees)}</p>
            <p className="text-xs text-emerald-600">Total fees collected</p>
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-2xl p-6 shadow-sm border border-purple-200">
          <div className="flex items-center justify-between mb-3">
            <div className="w-12 h-12 bg-purple-600 rounded-xl flex items-center justify-center shadow-lg">
              <Users className="w-6 h-6 text-white" />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-purple-700 uppercase tracking-wide">Active Sellers</p>
            <p className="text-3xl font-bold text-purple-900">{platformMetrics.activeSellers.toLocaleString()}</p>
            <p className="text-xs text-purple-600">With sales in period</p>
          </div>
        </div>

        <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-2xl p-6 shadow-sm border border-orange-200">
          <div className="flex items-center justify-between mb-3">
            <div className="w-12 h-12 bg-orange-600 rounded-xl flex items-center justify-center shadow-lg">
              <Package className="w-6 h-6 text-white" />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-orange-700 uppercase tracking-wide">Avg Order Value</p>
            <p className="text-3xl font-bold text-orange-900">{formatCurrency(platformMetrics.avgOrderValue)}</p>
            <p className="text-xs text-orange-600">Per transaction</p>
          </div>
        </div>
      </div>

      {/* Seller Metrics Table */}
      <SellerMetricsTable 
        sellerMetrics={sellerMetrics}
        sellers={sellers}
      />

      {/* Summary Footer */}
      <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-600">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="font-semibold text-gray-900">Platform Summary</div>
            <div className="flex items-center gap-4">
              <span>✅ {platformMetrics.activeSellers} sellers</span>
              <span>✅ {platformMetrics.totalOrders.toLocaleString()} orders</span>
              <span>✅ {formatCurrency(platformMetrics.avgRevenuePerSeller)} avg per seller</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500">Last updated</div>
            <div className="text-sm font-semibold text-gray-900">
              {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
