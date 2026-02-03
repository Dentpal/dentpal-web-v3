/**
 * Admin Category View Component
 * Platform-wide category sales analysis for administrators
 */

import { CategoryMetrics } from '@/types/dashboard';
import { formatCurrency } from '@/utils/dashboard/formatters';
import { ExportMenu } from '../shared';
import { FolderOpen } from 'lucide-react';

interface AdminCategoryViewProps {
  categoryMetrics: CategoryMetrics[];
  onExportCSV: () => void;
}

export const AdminCategoryView = ({ categoryMetrics, onExportCSV }: AdminCategoryViewProps) => {
  const totalRevenue = categoryMetrics.reduce((sum, cat) => sum + cat.netPayout, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Platform Categories</h3>
          <p className="text-xs text-gray-500 mt-0.5">{categoryMetrics.length} categories</p>
        </div>
        <ExportMenu onExportCSV={onExportCSV} showPDF={false} />
      </div>

      {/* Categories Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Category</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Items Sold</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Gross Revenue</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Platform Fee</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Net Payout</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">% of Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {categoryMetrics.map((category, index) => {
                const percentage = totalRevenue > 0 ? (category.netPayout / totalRevenue) * 100 : 0;
                return (
                  <tr key={index} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                          <FolderOpen className="w-5 h-5 text-purple-600" />
                        </div>
                        <div className="text-sm font-semibold text-gray-900">{category.name}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-semibold text-gray-900">{category.sold.toLocaleString()}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-bold text-green-600">{formatCurrency(category.grossSales)}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-semibold text-teal-600">{formatCurrency(category.platformFee)}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-bold text-gray-900">{formatCurrency(category.netPayout)}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-teal-600 h-2 rounded-full" 
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 w-12 text-right">
                          {percentage.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {categoryMetrics.length === 0 && (
          <div className="p-12 text-center text-gray-500">
            <FolderOpen className="w-12 h-12 mx-auto mb-3 text-gray-400" />
            <div className="text-sm font-medium">No categories found</div>
            <div className="text-xs mt-1">Categories will appear once orders are placed</div>
          </div>
        )}
      </div>
    </div>
  );
};
