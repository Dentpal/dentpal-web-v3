/**
 * Summary View Component
 * Displays financial summary table by date and revenue chart
 */

import { useMemo } from 'react';
import { Order } from '@/types/order';
import { formatCurrency, formatDateKey } from '@/utils/dashboard/formatters';
import RevenueChart from '@/components/dashboard/RevenueChart';
import { RevenueDataPoint } from '@/types/dashboard';

interface SummaryViewProps {
  paidOrders: Order[];
  revenueByDate: RevenueDataPoint[];
  dateRangeDisplay: string;
}

export const SummaryView = ({ paidOrders, revenueByDate, dateRangeDisplay }: SummaryViewProps) => {
  // Group orders by date and calculate metrics
  const financialByDate = useMemo(() => {
    const ordersByDate = new Map<string, Order[]>();

    paidOrders.forEach(order => {
      const orderDate = order.createdAt ? new Date(order.createdAt) : new Date();
      const dateKey = formatDateKey(orderDate);
      
      if (!ordersByDate.has(dateKey)) {
        ordersByDate.set(dateKey, []);
      }
      ordersByDate.get(dateKey)!.push(order);
    });

    // Sort dates in descending order
    const sortedDates = Array.from(ordersByDate.keys()).sort((a, b) => {
      const dateA = new Date(a);
      const dateB = new Date(b);
      return dateB.getTime() - dateA.getTime();
    });

    return sortedDates.map(dateKey => {
      const dayOrders = ordersByDate.get(dateKey)!;
      
      const totalGross = dayOrders.reduce((sum, o) => {
        return sum + (Number(o.summary?.subtotal) || 0);
      }, 0);

      const totalPaymentFee = dayOrders.reduce((sum, o) => {
        return sum + (Number(o.feesBreakdown?.paymentProcessingFee) || 0);
      }, 0);

      const totalShippingFee = dayOrders.reduce((sum, o) => {
        return sum + (Number(o.summary?.sellerShippingCharge) || 0);
      }, 0);

      const totalPlatformFee = dayOrders.reduce((sum, o) => {
        return sum + (Number(o.feesBreakdown?.platformFee) || 0);
      }, 0);

      const netPayout = totalGross - totalPaymentFee - totalShippingFee - totalPlatformFee;

      return {
        date: dateKey,
        totalGross,
        refunds: 0, // TODO: Implement refunds tracking
        totalPaymentFee,
        totalShippingFee,
        totalPlatformFee,
        netPayout,
      };
    });
  }, [paidOrders]);

  // Calculate grand totals
  const grandTotals = useMemo(() => {
    return financialByDate.reduce((acc, day) => ({
      totalGross: acc.totalGross + day.totalGross,
      refunds: acc.refunds + day.refunds,
      totalPaymentFee: acc.totalPaymentFee + day.totalPaymentFee,
      totalShippingFee: acc.totalShippingFee + day.totalShippingFee,
      totalPlatformFee: acc.totalPlatformFee + day.totalPlatformFee,
      netPayout: acc.netPayout + day.netPayout,
    }), {
      totalGross: 0,
      refunds: 0,
      totalPaymentFee: 0,
      totalShippingFee: 0,
      totalPlatformFee: 0,
      netPayout: 0,
    });
  }, [financialByDate]);

  return (
    <div className="space-y-6">
      {/* Revenue Chart */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-sm font-medium text-gray-700">Revenue</h4>
            <div className="mt-1 text-2xl font-bold text-gray-900">
              {formatCurrency(grandTotals.totalGross)}
            </div>
            <div className="text-xs text-gray-500">Sales</div>
          </div>
          <div className="hidden md:block text-xs text-gray-500">
            Date: {dateRangeDisplay}
          </div>
        </div>
        <RevenueChart data={revenueByDate} />
        <div className="mt-2 text-[11px] text-gray-500">(date)</div>
      </div>

      {/* Financial Summary Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-800 tracking-wide">
            FINANCIAL SUMMARY (PER DATE)
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr className="text-left text-xs font-semibold tracking-wide">
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3 text-right">Gross Sales</th>
                <th className="px-6 py-3 text-right">Refunds</th>
                <th className="px-6 py-3 text-right">Payment Fee</th>
                <th className="px-6 py-3 text-right">Shipping Fee</th>
                <th className="px-6 py-3 text-right">Platform Fee</th>
                <th className="px-6 py-3 text-right font-bold">Net Payout</th>
              </tr>
            </thead>
            <tbody>
              {financialByDate.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center">
                    <div className="text-gray-500">
                      <div className="text-sm font-medium">No data to display</div>
                      <div className="text-xs mt-1">There are no sales in the selected time period</div>
                    </div>
                  </td>
                </tr>
              ) : (
                <>
                  {financialByDate.map((day, idx) => (
                    <tr key={idx} className="border-t hover:bg-gray-50">
                      <td className="px-6 py-4 text-gray-700 font-medium text-xs">
                        {day.date}
                      </td>
                      <td className="px-6 py-4 text-gray-900 text-right font-medium">
                        {formatCurrency(day.totalGross)}
                      </td>
                      <td className="px-6 py-4 text-red-600 text-right font-medium">
                        {formatCurrency(day.refunds)}
                      </td>
                      <td className="px-6 py-4 text-red-600 text-right">
                        {formatCurrency(day.totalPaymentFee)}
                      </td>
                      <td className="px-6 py-4 text-orange-600 text-right">
                        {formatCurrency(day.totalShippingFee)}
                      </td>
                      <td className="px-6 py-4 text-red-600 text-right">
                        {formatCurrency(day.totalPlatformFee)}
                      </td>
                      <td className="px-6 py-4 text-green-600 text-right font-bold">
                        {formatCurrency(day.netPayout)}
                      </td>
                    </tr>
                  ))}
                  
                  {/* Total Row */}
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                    <td className="px-6 py-4 text-gray-900 text-xs">TOTAL</td>
                    <td className="px-6 py-4 text-gray-900 text-right">
                      {formatCurrency(grandTotals.totalGross)}
                    </td>
                    <td className="px-6 py-4 text-red-600 text-right">
                      {formatCurrency(grandTotals.refunds)}
                    </td>
                    <td className="px-6 py-4 text-red-600 text-right">
                      {formatCurrency(grandTotals.totalPaymentFee)}
                    </td>
                    <td className="px-6 py-4 text-orange-600 text-right">
                      {formatCurrency(grandTotals.totalShippingFee)}
                    </td>
                    <td className="px-6 py-4 text-red-600 text-right">
                      {formatCurrency(grandTotals.totalPlatformFee)}
                    </td>
                    <td className="px-6 py-4 text-green-600 text-right text-base">
                      {formatCurrency(grandTotals.netPayout)}
                    </td>
                  </tr>
                </>
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
              {dateRangeDisplay} • {paidOrders.length} paid {paidOrders.length === 1 ? 'order' : 'orders'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
