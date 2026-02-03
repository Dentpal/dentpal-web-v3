/**
 * Admin Sellers View Component
 * Displays seller performance metrics and comparisons
 */

import { useState, useMemo } from 'react';
import { Order } from '@/types/order';
import { formatCurrency } from '@/utils/dashboard/formatters';
import { ExportMenu, StatusBadge } from '../shared';
import { Store, TrendingUp, TrendingDown, Search } from 'lucide-react';

interface AdminSellersViewProps {
  paidOrders: Order[];
  sellerUidToName: Record<string, string>;
  onExportCSV: () => void;
}

interface SellerMetrics {
  sellerId: string;
  sellerName: string;
  totalRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
  totalItems: number;
  platformFee: number;
}

export const AdminSellersView = ({
  paidOrders,
  sellerUidToName,
  onExportCSV,
}: AdminSellersViewProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'revenue' | 'orders' | 'avgOrder'>('revenue');

  // Calculate seller metrics
  const sellerMetrics = useMemo(() => {
    const metricsMap = new Map<string, SellerMetrics>();

    paidOrders.forEach(order => {
      const sellerId = order.sellerIds?.[0] || 'unknown';
      const sellerName = sellerUidToName[sellerId] || 'Unknown Seller';

      if (!metricsMap.has(sellerId)) {
        metricsMap.set(sellerId, {
          sellerId,
          sellerName,
          totalRevenue: 0,
          totalOrders: 0,
          avgOrderValue: 0,
          totalItems: 0,
          platformFee: 0,
        });
      }

      const metrics = metricsMap.get(sellerId)!;
      metrics.totalRevenue += order.total || 0;
      metrics.totalOrders += 1;
      metrics.totalItems += order.items?.reduce((sum, item) => sum + item.quantity, 0) || 0;
      metrics.platformFee += (order.total || 0) * 0.05;
    });

    // Calculate average order value
    metricsMap.forEach(metrics => {
      metrics.avgOrderValue = metrics.totalOrders > 0 ? metrics.totalRevenue / metrics.totalOrders : 0;
    });

    return Array.from(metricsMap.values());
  }, [paidOrders, sellerUidToName]);

  // Filter and sort sellers
  const filteredSellers = useMemo(() => {
    let filtered = sellerMetrics;

    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(seller =>
        seller.sellerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        seller.sellerId.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'revenue':
          return b.totalRevenue - a.totalRevenue;
        case 'orders':
          return b.totalOrders - a.totalOrders;
        case 'avgOrder':
          return b.avgOrderValue - a.avgOrderValue;
        default:
          return 0;
      }
    });

    return filtered;
  }, [sellerMetrics, searchQuery, sortBy]);

  // Calculate totals
  const totals = useMemo(() => ({
    revenue: sellerMetrics.reduce((sum, s) => sum + s.totalRevenue, 0),
    orders: sellerMetrics.reduce((sum, s) => sum + s.totalOrders, 0),
    items: sellerMetrics.reduce((sum, s) => sum + s.totalItems, 0),
    fees: sellerMetrics.reduce((sum, s) => sum + s.platformFee, 0),
  }), [sellerMetrics]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Seller Performance</h3>
          <p className="text-xs text-gray-500 mt-0.5">{filteredSellers.length} sellers</p>
        </div>
        <ExportMenu onExportCSV={onExportCSV} showPDF={false} />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
        <div className="flex flex-col md:flex-row gap-3">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search sellers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          >
            <option value="revenue">Sort by Revenue</option>
            <option value="orders">Sort by Orders</option>
            <option value="avgOrder">Sort by Avg Order</option>
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="text-xs text-gray-600 mb-1">Total Sellers</div>
          <div className="text-2xl font-bold text-gray-900">{sellerMetrics.length}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="text-xs text-gray-600 mb-1">Total Revenue</div>
          <div className="text-2xl font-bold text-green-600">{formatCurrency(totals.revenue)}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="text-xs text-gray-600 mb-1">Total Orders</div>
          <div className="text-2xl font-bold text-blue-600">{totals.orders.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="text-xs text-gray-600 mb-1">Platform Fees</div>
          <div className="text-2xl font-bold text-teal-600">{formatCurrency(totals.fees)}</div>
        </div>
      </div>

      {/* Sellers Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Rank</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Seller</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Revenue</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Orders</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Avg Order</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Items</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Platform Fee</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredSellers.map((seller, index) => (
                <tr key={seller.sellerId} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white ${
                        index === 0 ? 'bg-yellow-500' :
                        index === 1 ? 'bg-gray-400' :
                        index === 2 ? 'bg-orange-600' :
                        'bg-gray-300'
                      }`}>
                        #{index + 1}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-teal-100 rounded-lg flex items-center justify-center">
                        <Store className="w-5 h-5 text-teal-600" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-gray-900">{seller.sellerName}</div>
                        <div className="text-xs text-gray-500">{seller.sellerId.substring(0, 8)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-green-600">{formatCurrency(seller.totalRevenue)}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-semibold text-gray-900">{seller.totalOrders.toLocaleString()}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-700">{formatCurrency(seller.avgOrderValue)}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-700">{seller.totalItems.toLocaleString()}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-semibold text-teal-600">{formatCurrency(seller.platformFee)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredSellers.length === 0 && (
          <div className="p-12 text-center text-gray-500">
            <Store className="w-12 h-12 mx-auto mb-3 text-gray-400" />
            <div className="text-sm font-medium">No sellers found</div>
            <div className="text-xs mt-1">Try adjusting your search</div>
          </div>
        )}
      </div>
    </div>
  );
};
