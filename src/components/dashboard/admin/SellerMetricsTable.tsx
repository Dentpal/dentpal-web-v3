/**
 * Seller Metrics Table Component
 * Displays seller performance metrics with column filtering and export
 */

import { useState } from 'react';
import { Order } from '@/types/order';
import { formatCurrency } from '@/utils/dashboard/formatters';
import { Download, Eye, ChevronDown, ChevronUp, Settings } from 'lucide-react';
import { OrderSummaryModal } from './OrderSummaryModal';

interface SellerMetric {
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
}

interface SellerMetricsTableProps {
  sellerMetrics: SellerMetric[];
  sellers: Array<{ uid: string; name: string; email: string; province?: string; city?: string }>;
}

type SortColumn = 'name' | 'province' | 'city' | 'orders' | 'revenue' | 'fees' | 'payout' | 'avg';
type SortDirection = 'asc' | 'desc';

interface ColumnVisibility {
  name: boolean;
  province: boolean;
  city: boolean;
  orders: boolean;
  revenue: boolean;
  fees: boolean;
  payout: boolean;
  avg: boolean;
}

export const SellerMetricsTable = ({ sellerMetrics, sellers }: SellerMetricsTableProps) => {
  const [sortColumn, setSortColumn] = useState<SortColumn>('revenue');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showColumnFilter, setShowColumnFilter] = useState(false);
  const [selectedSeller, setSelectedSeller] = useState<SellerMetric | null>(null);
  const [showOrderModal, setShowOrderModal] = useState(false);

  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>({
    name: true,
    province: true,
    city: true,
    orders: true,
    revenue: true,
    fees: true,
    payout: true,
    avg: true,
  });

  const toggleColumn = (column: keyof ColumnVisibility) => {
    setColumnVisibility(prev => ({ ...prev, [column]: !prev[column] }));
  };

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const sortedMetrics = [...sellerMetrics].sort((a, b) => {
    let comparison = 0;
    
    switch (sortColumn) {
      case 'name':
        comparison = a.sellerName.localeCompare(b.sellerName);
        break;
      case 'province':
        comparison = a.province.localeCompare(b.province);
        break;
      case 'city':
        comparison = a.city.localeCompare(b.city);
        break;
      case 'orders':
        comparison = a.totalOrders - b.totalOrders;
        break;
      case 'revenue':
        comparison = a.totalRevenue - b.totalRevenue;
        break;
      case 'fees':
        comparison = a.totalFees - b.totalFees;
        break;
      case 'payout':
        comparison = a.netPayout - b.netPayout;
        break;
      case 'avg':
        comparison = a.avgOrderValue - b.avgOrderValue;
        break;
    }

    return sortDirection === 'asc' ? comparison : -comparison;
  });

  const handleExportCSV = () => {
    // TODO: Implement CSV export
    console.log('Exporting seller metrics CSV...');
  };

  const handleViewOrders = (seller: SellerMetric) => {
    setSelectedSeller(seller);
    setShowOrderModal(true);
  };

  const SortIcon = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) return null;
    return sortDirection === 'asc' 
      ? <ChevronUp className="w-4 h-4" />
      : <ChevronDown className="w-4 h-4" />;
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Seller Performance Metrics</h3>
          <p className="text-sm text-gray-500 mt-1">
            Showing {sortedMetrics.length} {sortedMetrics.length === 1 ? 'seller' : 'sellers'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Column Filter */}
          <div className="relative">
            <button
              onClick={() => setShowColumnFilter(!showColumnFilter)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 border border-gray-200 rounded-lg hover:bg-gray-200 transition"
            >
              <Settings className="w-3.5 h-3.5" />
              Columns
            </button>
            
            {showColumnFilter && (
              <>
                <div 
                  className="fixed inset-0 z-20"
                  onClick={() => setShowColumnFilter(false)}
                />
                <div className="absolute right-0 mt-2 z-30 w-48 bg-white border border-gray-200 rounded-lg shadow-xl p-2">
                  <div className="text-xs font-semibold text-gray-700 px-2 py-1 mb-1">Toggle Columns</div>
                  {(Object.keys(columnVisibility) as Array<keyof ColumnVisibility>).map(column => (
                    <label
                      key={column}
                      className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={columnVisibility[column]}
                        onChange={() => toggleColumn(column)}
                        className="w-4 h-4 text-teal-600 rounded focus:ring-2 focus:ring-teal-500"
                      />
                      <span className="text-xs text-gray-700 capitalize">{column}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Export Button */}
          <button
            onClick={handleExportCSV}
            disabled={sellerMetrics.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
            <tr className="text-left text-xs font-bold tracking-wider uppercase">
              {columnVisibility.name && (
                <th 
                  className="px-6 py-4 text-gray-700 cursor-pointer hover:bg-gray-200 transition"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center gap-1">
                    Seller Name
                    <SortIcon column="name" />
                  </div>
                </th>
              )}
              {columnVisibility.province && (
                <th 
                  className="px-6 py-4 text-gray-700 cursor-pointer hover:bg-gray-200 transition"
                  onClick={() => handleSort('province')}
                >
                  <div className="flex items-center gap-1">
                    Province
                    <SortIcon column="province" />
                  </div>
                </th>
              )}
              {columnVisibility.city && (
                <th 
                  className="px-6 py-4 text-gray-700 cursor-pointer hover:bg-gray-200 transition"
                  onClick={() => handleSort('city')}
                >
                  <div className="flex items-center gap-1">
                    City
                    <SortIcon column="city" />
                  </div>
                </th>
              )}
              {columnVisibility.orders && (
                <th 
                  className="px-6 py-4 text-gray-700 text-right cursor-pointer hover:bg-gray-200 transition"
                  onClick={() => handleSort('orders')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Total Orders
                    <SortIcon column="orders" />
                  </div>
                </th>
              )}
              {columnVisibility.revenue && (
                <th 
                  className="px-6 py-4 text-gray-700 text-right cursor-pointer hover:bg-gray-200 transition"
                  onClick={() => handleSort('revenue')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Total Revenue
                    <SortIcon column="revenue" />
                  </div>
                </th>
              )}
              {columnVisibility.fees && (
                <th 
                  className="px-6 py-4 text-gray-700 text-right cursor-pointer hover:bg-gray-200 transition"
                  onClick={() => handleSort('fees')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Total Fees
                    <SortIcon column="fees" />
                  </div>
                </th>
              )}
              {columnVisibility.payout && (
                <th 
                  className="px-6 py-4 text-gray-700 text-right cursor-pointer hover:bg-gray-200 transition"
                  onClick={() => handleSort('payout')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Net Payout
                    <SortIcon column="payout" />
                  </div>
                </th>
              )}
              {columnVisibility.avg && (
                <th 
                  className="px-6 py-4 text-gray-700 text-right cursor-pointer hover:bg-gray-200 transition"
                  onClick={() => handleSort('avg')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Avg Order
                    <SortIcon column="avg" />
                  </div>
                </th>
              )}
              <th className="px-6 py-4 text-gray-700 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortedMetrics.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-16">
                  <div className="flex flex-col items-center justify-center text-center">
                    <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                      <span className="text-2xl">📊</span>
                    </div>
                    <div className="text-lg font-semibold text-gray-900 mb-2">No sellers found</div>
                    <div className="text-sm text-gray-500">Try adjusting your filters</div>
                  </div>
                </td>
              </tr>
            ) : (
              sortedMetrics.map((seller, idx) => (
                <tr key={seller.sellerId} className="hover:bg-gray-50 transition-colors">
                  {columnVisibility.name && (
                    <td className="px-6 py-4 font-semibold text-gray-900">{seller.sellerName}</td>
                  )}
                  {columnVisibility.province && (
                    <td className="px-6 py-4 text-gray-700">{seller.province}</td>
                  )}
                  {columnVisibility.city && (
                    <td className="px-6 py-4 text-gray-700">{seller.city}</td>
                  )}
                  {columnVisibility.orders && (
                    <td className="px-6 py-4 text-gray-900 text-right font-medium">{seller.totalOrders.toLocaleString()}</td>
                  )}
                  {columnVisibility.revenue && (
                    <td className="px-6 py-4 text-gray-900 text-right font-bold">{formatCurrency(seller.totalRevenue)}</td>
                  )}
                  {columnVisibility.fees && (
                    <td className="px-6 py-4 text-red-600 text-right font-medium">{formatCurrency(seller.totalFees)}</td>
                  )}
                  {columnVisibility.payout && (
                    <td className="px-6 py-4 text-green-600 text-right font-bold">{formatCurrency(seller.netPayout)}</td>
                  )}
                  {columnVisibility.avg && (
                    <td className="px-6 py-4 text-gray-900 text-right">{formatCurrency(seller.avgOrderValue)}</td>
                  )}
                  <td className="px-6 py-4 text-center">
                    <button
                      onClick={() => handleViewOrders(seller)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 transition"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View Orders
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 bg-gradient-to-r from-gray-50 to-gray-100 border-t border-gray-200">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-3 text-gray-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-teal-500 rounded-full"></span>
              <span className="font-medium">Total Sellers:</span>
              <span className="font-bold text-gray-900">{sortedMetrics.length}</span>
            </span>
          </div>
          <div className="text-xs text-gray-500">
            Sorted by {sortColumn} ({sortDirection})
          </div>
        </div>
      </div>

      {/* Order Summary Modal */}
      {showOrderModal && selectedSeller && (
        <OrderSummaryModal
          seller={selectedSeller}
          onClose={() => setShowOrderModal(false)}
        />
      )}
    </div>
  );
};
