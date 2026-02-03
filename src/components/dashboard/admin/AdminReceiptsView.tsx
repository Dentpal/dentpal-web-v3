/**
 * Admin Receipts View Component
 * All platform receipts with seller information
 */

import { useState } from 'react';
import { Order } from '@/types/order';
import { formatCurrency, formatDateTime } from '@/utils/dashboard/formatters';
import { ExportMenu, StatusBadge, EmployeeName } from '../shared';
import { Receipt, Search, ChevronDown, ChevronUp } from 'lucide-react';

interface AdminReceiptsViewProps {
  paidOrders: Order[];
  sellerUidToName: Record<string, string>;
  onExportCSV: () => void;
}

export const AdminReceiptsView = ({
  paidOrders,
  sellerUidToName,
  onExportCSV,
}: AdminReceiptsViewProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  // Filter receipts
  const filteredReceipts = paidOrders.filter(order => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const sellerId = order.sellerIds?.[0] || '';
    const sellerName = sellerUidToName[sellerId] || '';
    return (
      order.id?.toLowerCase().includes(query) ||
      order.customer?.name?.toLowerCase().includes(query) ||
      sellerName.toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900">All Platform Receipts</h3>
          <p className="text-xs text-gray-500 mt-0.5">{filteredReceipts.length} receipts</p>
        </div>
        <ExportMenu onExportCSV={onExportCSV} showPDF={false} />
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by order ID, buyer, or seller..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Receipts Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Order ID</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Date/Time</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Seller</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Buyer</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Platform Fee</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Status</th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-700 uppercase">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredReceipts.map((order) => {
                const isExpanded = expandedOrderId === order.id;
                const platformFee = (order.total || 0) * 0.05;
                
                return (
                  <>  
                    <tr key={order.id} className="hover:bg-gray-50 transition">
                      <td className="px-6 py-4">
                        <div className="text-sm font-mono text-gray-900">
                          #{order.id?.substring(0, 8) || 'N/A'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-700">{formatDateTime(order.timestamp)}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900">
                          {sellerUidToName[order.sellerIds?.[0] || ''] || 'Unknown Seller'}
                        </div>
                      </td>
                      <td className="px-6 py-4">\n                        <div className="text-sm text-gray-900">{order.customer?.name || 'N/A'}</div>
                        <div className="text-xs text-gray-500">{order.customer?.contact || ''}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-green-600">
                          {formatCurrency(order.total || 0)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-semibold text-teal-600">
                          {formatCurrency(platformFee)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={order.status} size="sm" />
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                          className="text-teal-600 hover:text-teal-700"
                        >
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                    </tr>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="px-6 py-4 bg-gray-50">
                          <div className="space-y-3">
                            <div className="text-xs font-semibold text-gray-700 uppercase">Order Items</div>
                            <div className="bg-white rounded-lg p-4 border border-gray-200">
                              {order.items?.map((item, idx) => (
                                <div key={idx} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                                  <div className="flex-1">
                                    <div className="text-sm font-medium text-gray-900">{item.name}</div>
                                    <div className="text-xs text-gray-500">Qty: {item.quantity}</div>
                                  </div>
                                  <div className="text-sm font-semibold text-gray-900">
                                    {formatCurrency((item.price || 0) * item.quantity)}
                                  </div>
                                </div>
                              ))}
                            </div>
                            
                            {order.paymentType && (
                              <div className="text-xs">
                                <span className="text-gray-600">Payment Method: </span>
                                <span className="font-semibold text-gray-900">{order.paymentType}</span>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredReceipts.length === 0 && (
          <div className="p-12 text-center text-gray-500">
            <Receipt className="w-12 h-12 mx-auto mb-3 text-gray-400" />
            <div className="text-sm font-medium">No receipts found</div>
            <div className="text-xs mt-1">Try adjusting your search</div>
          </div>
        )}
      </div>
    </div>
  );
};
