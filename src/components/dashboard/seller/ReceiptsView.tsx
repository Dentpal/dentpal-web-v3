/**
 * Receipts View Component
 * Displays individual receipt transactions with detail panel
 */

import { useState } from 'react';
import { Order } from '@/types/order';
import { formatCurrency, formatDateTime } from '@/utils/dashboard/formatters';
import { ClipboardList, TrendingUp, Download, CreditCard, ShoppingCart } from 'lucide-react';
import { EmployeeName } from '../shared/EmployeeName';
import { ExportMenu } from '../shared';

interface ReceiptsViewProps {
  paidOrders: Order[];
  sellerUidToName: Record<string, string>;
  onExportCSV: () => void;
}

export const ReceiptsView = ({ paidOrders, sellerUidToName, onExportCSV }: ReceiptsViewProps) => {
  const [selectedReceipt, setSelectedReceipt] = useState<Order | null>(null);
  const [receiptDetailOpen, setReceiptDetailOpen] = useState(false);

  // Calculate metrics
  const totalSales = paidOrders.reduce((sum, o) => sum + (Number(o.summary?.subtotal) || 0), 0);
  const refundedOrders = paidOrders.filter(o => 
    o.status === 'refunded' || o.status === 'returned' || o.status === 'return_refund'
  );
  const refundAmount = refundedOrders.reduce((sum, o) => sum + (Number(o.summary?.subtotal) || 0), 0);

  // Sort orders by date descending
  const sortedOrders = [...paidOrders].sort((a, b) => {
    const dateA = new Date(a.createdAt || a.timestamp || '').getTime();
    const dateB = new Date(b.createdAt || b.timestamp || '').getTime();
    return dateB - dateA;
  });

  const handleReceiptClick = (receipt: Order) => {
    setSelectedReceipt(receipt);
    setReceiptDetailOpen(true);
  };

  const getStatusStyle = (status: string) => {
    const config: Record<string, { bg: string; text: string; label: string }> = {
      'completed': { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Completed' },
      'confirmed': { bg: 'bg-green-100', text: 'text-green-700', label: 'Confirmed' },
      'processing': { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Processing' },
      'to_ship': { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'To Ship' },
      'pending': { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Pending' },
      'refunded': { bg: 'bg-rose-100', text: 'text-rose-700', label: 'Refunded' },
      'returned': { bg: 'bg-rose-100', text: 'text-rose-700', label: 'Returned' },
      'return_refund': { bg: 'bg-rose-100', text: 'text-rose-700', label: 'Return/Refund' },
      'cancelled': { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Cancelled' }
    };
    return config[status] || config['pending'];
  };

  return (
    <div className="space-y-6">
      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl p-6 shadow-sm border border-blue-200">
          <div className="flex items-center justify-between mb-3">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg">
              <ClipboardList className="w-6 h-6 text-white" />
            </div>
            <div className="text-xs font-semibold text-blue-600 bg-blue-200 px-2 py-1 rounded-full">
              Total
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-blue-700 uppercase tracking-wide">All Receipts</p>
            <p className="text-3xl font-bold text-blue-900">{paidOrders.length.toLocaleString()}</p>
            <p className="text-xs text-blue-600">Total transactions recorded</p>
          </div>
        </div>

        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-2xl p-6 shadow-sm border border-emerald-200">
          <div className="flex items-center justify-between mb-3">
            <div className="w-12 h-12 bg-emerald-600 rounded-xl flex items-center justify-center shadow-lg">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <div className="text-xs font-semibold text-emerald-600 bg-emerald-200 px-2 py-1 rounded-full">
              Active
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-emerald-700 uppercase tracking-wide">Total Sales</p>
            <p className="text-3xl font-bold text-emerald-900">{formatCurrency(totalSales)}</p>
            <p className="text-xs text-emerald-600">Revenue from {paidOrders.length} transactions</p>
          </div>
        </div>

        <div className="bg-gradient-to-br from-rose-50 to-rose-100 rounded-2xl p-6 shadow-sm border border-rose-200">
          <div className="flex items-center justify-between mb-3">
            <div className="w-12 h-12 bg-rose-600 rounded-xl flex items-center justify-center shadow-lg">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 15v-1a4 4 0 00-4-4H8m0 0l3 3m-3-3l3-3m9 14V5a2 2 0 00-2-2H6a2 2 0 00-2 2v16l4-2 4 2 4-2 4 2z" />
              </svg>
            </div>
            <div className="text-xs font-semibold text-rose-600 bg-rose-200 px-2 py-1 rounded-full">
              {refundedOrders.length}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-rose-700 uppercase tracking-wide">Total Refunds</p>
            <p className="text-3xl font-bold text-rose-900">{formatCurrency(refundAmount)}</p>
            <p className="text-xs text-rose-600">From {refundedOrders.length} refunded orders</p>
          </div>
        </div>
      </div>

      {/* Export Button */}
      <div className="flex justify-end">
        <button 
          onClick={onExportCSV}
          disabled={paidOrders.length === 0}
          className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-teal-600 to-teal-700 rounded-xl hover:from-teal-700 hover:to-teal-800 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          Export Receipts
        </button>
      </div>

      {/* Receipts Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900">Receipt Transactions</h3>
          <p className="text-sm text-gray-500 mt-1">Detailed list of all individual receipt transactions</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
              <tr className="text-left text-xs font-bold tracking-wider uppercase">
                <th className="px-6 py-4 text-gray-700">Receipt No</th>
                <th className="px-6 py-4 text-gray-700">Date</th>
                <th className="px-6 py-4 text-gray-700">Employee</th>
                <th className="px-6 py-4 text-gray-700">Receipt Type</th>
                <th className="px-6 py-4 text-right text-gray-700">Amount</th>
                <th className="px-6 py-4 text-center text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16">
                    <div className="flex flex-col items-center justify-center text-center">
                      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center mb-4 shadow-inner">
                        <ClipboardList className="w-10 h-10 text-gray-400" />
                      </div>
                      <div className="text-lg font-semibold text-gray-900 mb-2">No receipts found</div>
                      <div className="text-sm text-gray-500">There are no receipt transactions in the selected time period</div>
                    </div>
                  </td>
                </tr>
              ) : (
                sortedOrders.map((order, idx) => {
                  const date = formatDateTime(order.createdAt || order.timestamp || '');
                  
                  // Find employee name from status history
                  let employeeCell: React.ReactNode = 'N/A';
                  if (Array.isArray(order.statusHistory)) {
                    const relevant = order.statusHistory
                      .filter((e: any) => e.handledBy)
                      .sort((a: any, b: any) => {
                        const ta = new Date(a.timestamp as any).getTime();
                        const tb = new Date(b.timestamp as any).getTime();
                        return tb - ta;
                      });
                    if (relevant.length > 0) {
                      const handledBy = (relevant[0] as any).handledBy;
                      let handledById = '';
                      if (typeof handledBy === 'string') {
                        handledById = handledBy;
                      } else if (handledBy && typeof handledBy === 'object' && (handledBy as any).id) {
                        handledById = (handledBy as any).id;
                      }
                      if (handledById) {
                        employeeCell = <EmployeeName handledBy={handledById} sellerUidToName={sellerUidToName} />;
                      }
                    }
                  }

                  const refundStatuses = ['refunded', 'returned', 'return_refund'];
                  const receiptType = refundStatuses.includes(order.status) ? 'Refund' : 'Sales';
                  const amount = Number(order.summary?.subtotal) || 0;
                  const statusStyle = getStatusStyle(order.status);

                  return (
                    <tr 
                      key={order.id || idx} 
                      onClick={() => handleReceiptClick(order)}
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      <td className="px-6 py-4 font-semibold text-gray-900">{order.id}</td>
                      <td className="px-6 py-4 text-gray-900 font-medium">{date}</td>
                      <td className="px-6 py-4 font-medium text-gray-900">{employeeCell}</td>
                      <td className="px-6 py-4 text-blue-700 font-semibold">{receiptType}</td>
                      <td className="px-6 py-4 text-right text-gray-900 font-bold">{formatCurrency(amount)}</td>
                      <td className="px-6 py-4 text-center">
                        <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold ${statusStyle.bg} ${statusStyle.text} border border-current border-opacity-20`}>
                          {statusStyle.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-4 bg-gradient-to-r from-gray-50 to-gray-100 border-t border-gray-200">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-3 text-gray-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-teal-500 rounded-full shadow-sm"></span>
                <span className="font-medium">Total Receipts:</span>
                <span className="font-bold text-gray-900">{paidOrders.length}</span>
              </span>
              <span className="text-gray-300">|</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full shadow-sm"></span>
                <span className="font-medium">Total Revenue:</span>
                <span className="font-bold text-gray-900">{formatCurrency(totalSales)}</span>
              </span>
            </div>
            <div className="text-xs text-gray-500">
              Last updated: {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        </div>
      </div>

      {/* Receipt Detail Side Panel */}
      {receiptDetailOpen && selectedReceipt && (
        <>
          <div 
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity"
            onClick={() => setReceiptDetailOpen(false)}
          />
          
          <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-gradient-to-r from-teal-600 to-teal-700 text-white px-6 py-5 shadow-lg z-10">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold">Receipt Details</h3>
                  <p className="text-sm text-teal-100 mt-1">Order #{selectedReceipt.id}</p>
                </div>
                <button
                  onClick={() => setReceiptDetailOpen(false)}
                  className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-2xl p-6 border border-emerald-200 shadow-sm">
                <div className="text-sm font-medium text-emerald-700 mb-2">Total Amount</div>
                <div className="text-4xl font-bold text-emerald-900">
                  {formatCurrency(Number(selectedReceipt.summary?.subtotal) || 0)}
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-emerald-700">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                  <span>Paid via {selectedReceipt.feesBreakdown?.paymentMethod || 'N/A'}</span>
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-600">Order ID</span>
                  <span className="text-sm font-bold text-gray-900">{selectedReceipt.id}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-600">Status</span>
                  <span className={`text-xs font-semibold px-3 py-1 rounded-full ${getStatusStyle(selectedReceipt.status).bg} ${getStatusStyle(selectedReceipt.status).text}`}>
                    {getStatusStyle(selectedReceipt.status).label}
                  </span>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => window.print()}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-teal-600 to-teal-700 text-white rounded-xl font-semibold hover:from-teal-700 hover:to-teal-800 transition shadow-md hover:shadow-lg"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  Print Receipt
                </button>
                <button
                  onClick={() => setReceiptDetailOpen(false)}
                  className="px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
