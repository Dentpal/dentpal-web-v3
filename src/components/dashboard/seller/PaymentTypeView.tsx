/**
 * Payment Type View Component
 * Displays sales breakdown by payment type with export functionality
 */

import { PaymentTypeMetrics } from '@/types/dashboard';
import { formatCurrency } from '@/utils/dashboard/formatters';
import { ExportMenu } from '../shared';
import { Download, CreditCard } from 'lucide-react';

interface PaymentTypeViewProps {
  paymentTypeMetrics: PaymentTypeMetrics[];
  onExportCSV: () => void;
}

export const PaymentTypeView = ({ paymentTypeMetrics, onExportCSV }: PaymentTypeViewProps) => {
  // Calculate total for percentage calculations
  const totalGrossSales = paymentTypeMetrics.reduce((sum, pt) => sum + pt.grossSales, 0);

  return (
    <div className="space-y-6">
      {/* Export Table - All Payment Types */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800 tracking-wide">SALES BY PAYMENT TYPE</h3>
          <button 
            onClick={onExportCSV}
            disabled={paymentTypeMetrics.length === 0}
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
                <th className="px-6 py-3">Payment Type</th>
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
              {paymentTypeMetrics.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-16">
                    <div className="flex flex-col items-center justify-center text-center text-gray-500">
                      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                        <CreditCard className="w-8 h-8 text-gray-400" />
                      </div>
                      <div className="text-sm font-medium">No payment types to display</div>
                      <div className="mt-1 text-xs text-gray-400">There are no sales in the selected time period</div>
                    </div>
                  </td>
                </tr>
              ) : (
                paymentTypeMetrics.map((paymentType, idx) => (
                  <tr key={idx} className="border-t hover:bg-gray-50">
                    <td className="px-6 py-4 text-gray-900 font-medium">
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-teal-600" />
                        {paymentType.name}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-700 text-right">{paymentType.sold.toLocaleString()}</td>
                    <td className="px-6 py-4 text-red-600 text-right">{paymentType.refunded.toLocaleString()}</td>
                    <td className="px-6 py-4 text-gray-900 text-right font-medium">{formatCurrency(paymentType.grossSales)}</td>
                    <td className="px-6 py-4 text-red-600 text-right">{formatCurrency(paymentType.refunds)}</td>
                    <td className="px-6 py-4 text-red-600 text-right">{formatCurrency(paymentType.paymentFee)}</td>
                    <td className="px-6 py-4 text-orange-600 text-right">{formatCurrency(paymentType.shippingFee)}</td>
                    <td className="px-6 py-4 text-red-600 text-right">{formatCurrency(paymentType.platformFee)}</td>
                    <td className="px-6 py-4 text-green-600 text-right font-bold text-base">{formatCurrency(Math.abs(paymentType.netPayout))}</td>
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
              Based on {paymentTypeMetrics.length} payment {paymentTypeMetrics.length === 1 ? 'type' : 'types'}
            </div>
          </div>
        </div>
      </div>

      {/* Payment Method Distribution */}
      {paymentTypeMetrics.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-800 tracking-wide">PAYMENT METHOD DISTRIBUTION</h3>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {paymentTypeMetrics.map((paymentType, idx) => {
                const percentage = totalGrossSales > 0 
                  ? (paymentType.grossSales / totalGrossSales) * 100 
                  : 0;
                
                return (
                  <div key={idx} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-teal-600" />
                        <span className="font-medium text-gray-900">{paymentType.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-700">{formatCurrency(paymentType.grossSales)}</span>
                        <span className="text-xs text-gray-500 font-medium">{percentage.toFixed(1)}%</span>
                      </div>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-teal-500 to-teal-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Payment Insights */}
      {paymentTypeMetrics.length > 0 && (
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl p-6 border border-blue-200">
          <h4 className="text-sm font-semibold text-blue-900 mb-3">💳 Payment Insights</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg p-4">
              <div className="text-xs text-gray-600 mb-1">Most Used Method</div>
              <div className="text-lg font-bold text-gray-900">{paymentTypeMetrics[0].name}</div>
              <div className="text-xs text-blue-600 mt-1">
                {totalGrossSales > 0 
                  ? `${((paymentTypeMetrics[0].grossSales / totalGrossSales) * 100).toFixed(1)}%` 
                  : '0%'} of sales
              </div>
            </div>
            <div className="bg-white rounded-lg p-4">
              <div className="text-xs text-gray-600 mb-1">Payment Methods</div>
              <div className="text-lg font-bold text-gray-900">{paymentTypeMetrics.length}</div>
              <div className="text-xs text-gray-500 mt-1">Available options</div>
            </div>
            <div className="bg-white rounded-lg p-4">
              <div className="text-xs text-gray-600 mb-1">Total Payment Fees</div>
              <div className="text-lg font-bold text-red-600">
                {formatCurrency(paymentTypeMetrics.reduce((sum, pt) => sum + pt.paymentFee, 0))}
              </div>
              <div className="text-xs text-gray-500 mt-1">Across all methods</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
