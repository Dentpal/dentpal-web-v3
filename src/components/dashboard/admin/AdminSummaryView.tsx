/**
 * Admin Summary View Component
 * Platform-wide summary with charts and key metrics
 */

import { Order } from '@/types/order';
import { formatCurrency } from '@/utils/dashboard/formatters';
import { ExportMenu } from '../shared';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, DollarSign, Package, Users } from 'lucide-react';

interface AdminSummaryViewProps {
  paidOrders: Order[];
  revenueByDate: Array<{ date: string; revenue: number }>;
  dateRangeDisplay: string;
  platformFees: number;
  uniqueSellers: number;
  uniqueBuyers: number;
  onExportCSV: () => void;
}

export const AdminSummaryView = ({
  paidOrders,
  revenueByDate,
  dateRangeDisplay,
  platformFees,
  uniqueSellers,
  uniqueBuyers,
  onExportCSV,
}: AdminSummaryViewProps) => {
  const totalRevenue = paidOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  const totalOrders = paidOrders.length;
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const totalItems = paidOrders.reduce((sum, o) => sum + (o.items?.length || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header with Export */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Platform Overview</h3>
          <p className="text-xs text-gray-500 mt-0.5">{dateRangeDisplay}</p>
        </div>
        <ExportMenu onExportCSV={onExportCSV} showPDF={false} />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-5 border border-green-200">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-white" />
            </div>
            <TrendingUp className="w-4 h-4 text-green-600" />
          </div>
          <div className="text-2xl font-bold text-green-900">{formatCurrency(totalRevenue)}</div>
          <div className="text-xs text-green-700 mt-1">Total Platform Revenue</div>
        </div>

        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-5 border border-blue-200">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
          </div>
          <div className="text-2xl font-bold text-blue-900">{formatCurrency(platformFees)}</div>
          <div className="text-xs text-blue-700 mt-1">Platform Fees (5%)</div>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-5 border border-purple-200">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center">
              <Users className="w-5 h-5 text-white" />
            </div>
          </div>
          <div className="text-2xl font-bold text-purple-900">{uniqueSellers}</div>
          <div className="text-xs text-purple-700 mt-1">Active Sellers</div>
        </div>

        <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-5 border border-orange-200">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-orange-600 rounded-lg flex items-center justify-center">
              <Package className="w-5 h-5 text-white" />
            </div>
          </div>
          <div className="text-2xl font-bold text-orange-900">{totalItems}</div>
          <div className="text-xs text-orange-700 mt-1">Total Items Sold</div>
        </div>
      </div>

      {/* Revenue Chart */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
        <h4 className="text-sm font-bold text-gray-900 mb-4">Revenue Trend</h4>
        {revenueByDate.length > 0 ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueByDate}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(val) => `₱${(val / 1000).toFixed(0)}k`} />
                <Tooltip 
                  formatter={(value: number) => [formatCurrency(value), 'Revenue']}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Line 
                  type="monotone" 
                  dataKey="revenue" 
                  stroke="#14b8a6" 
                  strokeWidth={2}
                  dot={{ fill: '#14b8a6', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-72 flex items-center justify-center text-gray-500 border border-gray-200 rounded-lg">
            <div className="text-center">
              <div className="text-sm">No revenue data</div>
              <div className="text-xs mt-1">Data will appear once orders are placed</div>
            </div>
          </div>
        )}
      </div>

      {/* Quick Stats Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h4 className="text-sm font-bold text-gray-900">Key Metrics</h4>
        </div>
        <div className="divide-y divide-gray-100">
          <div className="p-4 flex items-center justify-between hover:bg-gray-50">
            <span className="text-sm text-gray-700">Total Orders</span>
            <span className="text-sm font-bold text-gray-900">{totalOrders.toLocaleString()}</span>
          </div>
          <div className="p-4 flex items-center justify-between hover:bg-gray-50">
            <span className="text-sm text-gray-700">Average Order Value</span>
            <span className="text-sm font-bold text-gray-900">{formatCurrency(avgOrderValue)}</span>
          </div>
          <div className="p-4 flex items-center justify-between hover:bg-gray-50">
            <span className="text-sm text-gray-700">Unique Buyers</span>
            <span className="text-sm font-bold text-gray-900">{uniqueBuyers.toLocaleString()}</span>
          </div>
          <div className="p-4 flex items-center justify-between hover:bg-gray-50">
            <span className="text-sm text-gray-700">Platform Fee Rate</span>
            <span className="text-sm font-bold text-teal-600">5.0%</span>
          </div>
        </div>
      </div>
    </div>
  );
};
