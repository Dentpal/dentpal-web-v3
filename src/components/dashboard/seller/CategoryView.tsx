/**
 * Category View Component
 * Displays sales breakdown by category with export functionality
 */

import { CategoryMetrics } from '@/types/dashboard';
import { formatCurrency } from '@/utils/dashboard/formatters';
import { ExportMenu } from '../shared';
import { Download } from 'lucide-react';

interface CategoryViewProps {
  categoryMetrics: CategoryMetrics[];
  onExportCSV: () => void;
}

export const CategoryView = ({ categoryMetrics, onExportCSV }: CategoryViewProps) => {
  return (
    <div className="space-y-6">
      {/* Export Table - All Categories */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800 tracking-wide">SALES BY CATEGORY</h3>
          <button 
            onClick={onExportCSV}
            disabled={categoryMetrics.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr className="text-left text-xs font-semibold tracking-wide">
                <th className="px-6 py-3">Category</th>
                <th className="px-6 py-3 text-right">Items Sold</th>
                <th className="px-6 py-3 text-right">Items Refunded</th>
                <th className="px-6 py-3 text-right">Gross Sales</th>
                <th className="px-6 py-3 text-right">Refunds</th>
                <th className="px-6 py-3 text-right">Payment Fee</th>
                <th className="px-6 py-3 text-right">Shipping Fee</th>
                <th className="px-6 py-3 text-right">Platform Fee</th>
                <th className="px-6 py-3 text-right font-bold">Net Payout</th>
              </tr>
            </thead>
            <tbody>
              {categoryMetrics.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-16">
                    <div className="flex flex-col items-center justify-center text-center text-gray-500">
                      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                        <span className="text-xs font-semibold text-gray-400">⌀</span>
                      </div>
                      <div className="text-sm font-medium">No categories to display</div>
                      <div className="mt-1 text-xs text-gray-400">There are no sales in the selected time period</div>
                    </div>
                  </td>
                </tr>
              ) : (
                categoryMetrics.map((category, idx) => (
                  <tr key={idx} className="border-t hover:bg-gray-50">
                    <td className="px-6 py-4 text-gray-900 font-medium">{category.name}</td>
                    <td className="px-6 py-4 text-gray-700 text-right">{category.sold.toLocaleString()}</td>
                    <td className="px-6 py-4 text-red-600 text-right">{category.refunded.toLocaleString()}</td>
                    <td className="px-6 py-4 text-gray-900 text-right font-medium">{formatCurrency(category.grossSales)}</td>
                    <td className="px-6 py-4 text-red-600 text-right">{formatCurrency(category.refunds)}</td>
                    <td className="px-6 py-4 text-red-600 text-right">{formatCurrency(category.paymentFee)}</td>
                    <td className="px-6 py-4 text-orange-600 text-right">{formatCurrency(category.shippingFee)}</td>
                    <td className="px-6 py-4 text-red-600 text-right">{formatCurrency(category.platformFee)}</td>
                    <td className="px-6 py-4 text-green-600 text-right font-bold text-base">{formatCurrency(category.netPayout)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-100">
          <div className="flex items-center justify-between text-xs text-gray-600">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                Net Payout = Gross Sales - (Payment Fee + Shipping Fee + Platform Fee)
              </span>
            </div>
            <div className="text-gray-500">
              Based on {categoryMetrics.length} {categoryMetrics.length === 1 ? 'category' : 'categories'}
            </div>
          </div>
        </div>
      </div>

      {/* Category Insights */}
      {categoryMetrics.length > 0 && (
        <div className="bg-gradient-to-br from-teal-50 to-teal-100 rounded-2xl p-6 border border-teal-200">
          <h4 className="text-sm font-semibold text-teal-900 mb-3">📊 Category Insights</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg p-4">
              <div className="text-xs text-gray-600 mb-1">Top Category</div>
              <div className="text-lg font-bold text-gray-900">{categoryMetrics[0].name}</div>
              <div className="text-xs text-teal-600 mt-1">{formatCurrency(categoryMetrics[0].netPayout)}</div>
            </div>
            <div className="bg-white rounded-lg p-4">
              <div className="text-xs text-gray-600 mb-1">Total Categories</div>
              <div className="text-lg font-bold text-gray-900">{categoryMetrics.length}</div>
              <div className="text-xs text-gray-500 mt-1">With sales data</div>
            </div>
            <div className="bg-white rounded-lg p-4">
              <div className="text-xs text-gray-600 mb-1">Total Items Sold</div>
              <div className="text-lg font-bold text-gray-900">
                {categoryMetrics.reduce((sum, c) => sum + c.sold, 0).toLocaleString()}
              </div>
              <div className="text-xs text-gray-500 mt-1">Across all categories</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
