/**
 * Items View Component
 * Displays top items, sales chart, and export table for all items
 */

import { useState } from 'react';
import { ItemMetrics, ChartType } from '@/types/dashboard';
import { formatCurrency } from '@/utils/dashboard/formatters';
import { ExportMenu } from '../shared';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Download } from 'lucide-react';

interface ItemsViewProps {
  itemMetrics: ItemMetrics[];
  onExportCSV: () => void;
}

const CHART_COLORS = ['#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

export const ItemsView = ({ itemMetrics, onExportCSV }: ItemsViewProps) => {
  const [chartType, setChartType] = useState<ChartType>('bar');

  // Top 5 items by net payout
  const topItems = itemMetrics.slice(0, 5);

  // Top 5 items by quantity sold for chart
  const topItemsByQuantity = [...itemMetrics]
    .sort((a, b) => b.sold - a.sold)
    .slice(0, 5)
    .map(item => ({ name: item.name, quantity: item.sold }));

  const renderChart = () => {
    if (topItemsByQuantity.length === 0) {
      return (
        <div className="h-64 flex items-center justify-center text-gray-500 border border-gray-200 rounded-lg">
          <div className="text-center">
            <div className="text-sm">No data to display</div>
            <div className="text-xs mt-1">There are no sales in the selected time period</div>
          </div>
        </div>
      );
    }

    switch (chartType) {
      case 'line':
        return (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={topItemsByQuantity} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis 
                  dataKey="name" 
                  stroke="#9ca3af"
                  fontSize={11}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  interval={0}
                />
                <YAxis stroke="#9ca3af" fontSize={11} />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: "white",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  formatter={(value: any) => [value.toLocaleString() + ' units', 'Quantity Sold']}
                />
                <Line 
                  type="monotone" 
                  dataKey="quantity" 
                  stroke="#14b8a6" 
                  strokeWidth={2}
                  dot={{ fill: '#14b8a6', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        );

      case 'pie':
        return (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={topItemsByQuantity}
                  dataKey="quantity"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                >
                  {topItemsByQuantity.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{
                    backgroundColor: "white",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    fontSize: "12px",
                    padding: "8px 12px",
                  }}
                  formatter={(value: any) => [value.toLocaleString() + ' units', 'Quantity Sold']}
                />
                <Legend 
                  verticalAlign="bottom" 
                  height={36}
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        );

      default: // bar
        return (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topItemsByQuantity} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 100 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" stroke="#9ca3af" fontSize={11} />
                <YAxis 
                  type="category"
                  dataKey="name" 
                  stroke="#9ca3af"
                  fontSize={11}
                  width={90}
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: "white",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  formatter={(value: any) => [value.toLocaleString() + ' units', 'Quantity Sold']}
                />
                <Bar dataKey="quantity" fill="#14b8a6" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top 5 Items + Chart */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-800 tracking-wide">
            TOP 5 ITEMS & SALES BY ITEM
          </h3>
        </div>
        
        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Top 5 Items List */}
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-4">Top 5 Items by Net Payout</h4>
              {topItems.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <div className="text-sm">No items to display</div>
                  <div className="text-xs mt-1">There are no sales in the selected time period</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {topItems.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:border-teal-300 transition">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center font-bold text-sm">
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{item.name}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          Net Payout: <span className="font-semibold text-green-600">{formatCurrency(Math.abs(item.netPayout))}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right: Sales Chart */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-medium text-gray-700">TOP 5 ITEMS BY QUANTITY SOLD</h4>
                <select 
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  value={chartType}
                  onChange={(e) => setChartType(e.target.value as ChartType)}
                >
                  <option value="line">Line Chart</option>
                  <option value="bar">Bar Chart</option>
                  <option value="pie">Pie Chart</option>
                </select>
              </div>
              {renderChart()}
            </div>
          </div>
        </div>
      </div>

      {/* Export Table - All Items */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800 tracking-wide">EXPORT - ALL ITEMS</h3>
          <button 
            onClick={onExportCSV}
            disabled={itemMetrics.length === 0}
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
                <th className="px-6 py-3">Item Name</th>
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
              {itemMetrics.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-16">
                    <div className="flex flex-col items-center justify-center text-center text-gray-500">
                      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                        <span className="text-xs font-semibold text-gray-400">⌀</span>
                      </div>
                      <div className="text-sm font-medium">No items to display</div>
                      <div className="mt-1 text-xs text-gray-400">There are no sales in the selected time period</div>
                    </div>
                  </td>
                </tr>
              ) : (
                itemMetrics.map((item, idx) => (
                  <tr key={idx} className="border-t hover:bg-gray-50">
                    <td className="px-6 py-4 text-gray-900 font-medium">{item.name}</td>
                    <td className="px-6 py-4 text-gray-700 text-right">{item.sold.toLocaleString()}</td>
                    <td className="px-6 py-4 text-red-600 text-right">{item.refunded.toLocaleString()}</td>
                    <td className="px-6 py-4 text-gray-900 text-right font-medium">{formatCurrency(item.grossSales)}</td>
                    <td className="px-6 py-4 text-red-600 text-right">{formatCurrency(item.refunds)}</td>
                    <td className="px-6 py-4 text-red-600 text-right">{formatCurrency(item.paymentFee)}</td>
                    <td className="px-6 py-4 text-orange-600 text-right">{formatCurrency(item.shippingFee)}</td>
                    <td className="px-6 py-4 text-red-600 text-right">{formatCurrency(item.platformFee)}</td>
                    <td className="px-6 py-4 text-green-600 text-right font-bold text-base">{formatCurrency(Math.abs(item.netPayout))}</td>
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
              Based on {itemMetrics.length} {itemMetrics.length === 1 ? 'item' : 'items'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
