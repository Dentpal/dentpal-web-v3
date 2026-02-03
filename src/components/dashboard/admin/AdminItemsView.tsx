/**
 * Admin Items View Component
 * Platform-wide item sales analysis for administrators
 */

import { ItemMetrics } from '@/types/dashboard';
import { formatCurrency } from '@/utils/dashboard/formatters';
import { ExportMenu } from '../shared';
import { Package } from 'lucide-react';

interface AdminItemsViewProps {
  itemMetrics: ItemMetrics[];
  onExportCSV: () => void;
}

export const AdminItemsView = ({ itemMetrics, onExportCSV }: AdminItemsViewProps) => {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Platform Items</h3>
          <p className="text-xs text-gray-500 mt-0.5">{itemMetrics.length} unique items</p>
        </div>
        <ExportMenu onExportCSV={onExportCSV} showPDF={false} />
      </div>

      {/* Items Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Rank</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Item Name</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Sold</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Gross</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Platform Fee</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Net Payout</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {itemMetrics.map((item, index) => (
                <tr key={index} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-4">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white ${
                      index < 3 ? 'bg-teal-600' : 'bg-gray-300'
                    }`}>
                      #{index + 1}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <Package className="w-5 h-5 text-blue-600" />
                      </div>
                      <div className="text-sm font-semibold text-gray-900">{item.name}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-semibold text-gray-900">{item.sold.toLocaleString()}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-green-600">{formatCurrency(item.netPayout)}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-semibold text-teal-600">{formatCurrency(item.netPayout * 0.05)}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-gray-900">{formatCurrency(item.netPayout)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {itemMetrics.length === 0 && (
          <div className="p-12 text-center text-gray-500">
            <Package className="w-12 h-12 mx-auto mb-3 text-gray-400" />
            <div className="text-sm font-medium">No items found</div>
            <div className="text-xs mt-1">Items will appear once orders are placed</div>
          </div>
        )}
      </div>
    </div>
  );
};
