/**
 * Order Summary Modal Component
 * Displays detailed order information for a specific seller
 */

import { useState } from 'react';
import { Order } from '@/types/order';
import { formatCurrency, formatDateTime } from '@/utils/dashboard/formatters';
import { X, ChevronDown, ChevronUp, Package, DollarSign, Calendar } from 'lucide-react';

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

interface OrderSummaryModalProps {
  seller: SellerMetric;
  onClose: () => void;
}

export const OrderSummaryModal = ({ seller, onClose }: OrderSummaryModalProps) => {
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  const toggleOrderExpansion = (orderId: string) => {
    setExpandedOrderId(expandedOrderId === orderId ? null : orderId);
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
      'cancelled': { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Cancelled' }
    };
    return config[status] || config['pending'];
  };

  // Sort orders by date descending
  const sortedOrders = [...seller.orders].sort((a, b) => {
    const dateA = new Date(a.createdAt || a.timestamp || '').getTime();
    const dateB = new Date(b.createdAt || b.timestamp || '').getTime();
    return dateB - dateA;
  });

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="bg-gradient-to-r from-teal-600 to-teal-700 text-white px-6 py-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold">Order Summary</h3>
                <p className="text-sm text-teal-100 mt-1">
                  {seller.sellerName} • {seller.province}, {seller.city}
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-4 mt-4">
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Package className="w-4 h-4 text-teal-100" />
                  <span className="text-xs text-teal-100">Total Orders</span>
                </div>
                <div className="text-2xl font-bold">{seller.totalOrders.toLocaleString()}</div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-4 h-4 text-teal-100" />
                  <span className="text-xs text-teal-100">Total Revenue</span>
                </div>
                <div className="text-2xl font-bold">{formatCurrency(seller.totalRevenue)}</div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-4 h-4 text-teal-100" />
                  <span className="text-xs text-teal-100">Net Payout</span>
                </div>
                <div className="text-2xl font-bold">{formatCurrency(seller.netPayout)}</div>
              </div>
            </div>
          </div>

          {/* Orders List */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-3">
              {sortedOrders.map(order => {
                const isExpanded = expandedOrderId === order.id;
                const revenue = Number(order.summary?.subtotal) || 0;
                const paymentFee = Number(order.feesBreakdown?.paymentProcessingFee) || 0;
                const shippingFee = Number(order.summary?.sellerShippingCharge) || 0;
                const platformFee = Number(order.feesBreakdown?.platformFee) || 0;
                const netPayout = revenue - paymentFee - shippingFee - platformFee;
                const statusStyle = getStatusStyle(order.status);

                return (
                  <div key={order.id} className="border border-gray-200 rounded-xl overflow-hidden">
                    {/* Order Header */}
                    <div 
                      className="bg-gray-50 px-4 py-3 cursor-pointer hover:bg-gray-100 transition"
                      onClick={() => toggleOrderExpansion(order.id!)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <button className="text-gray-600">
                            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                          </button>
                          <div>
                            <div className="font-semibold text-gray-900 text-sm">Order #{order.id}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <Calendar className="w-3 h-3 text-gray-500" />
                              <span className="text-xs text-gray-600">
                                {formatDateTime(order.createdAt || order.timestamp || '')}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="text-sm font-bold text-gray-900">{formatCurrency(revenue)}</div>
                            <div className="text-xs text-green-600 font-medium">Net: {formatCurrency(netPayout)}</div>
                          </div>
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${statusStyle.bg} ${statusStyle.text} border border-current border-opacity-20`}>
                            {statusStyle.label}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Order Details (Expanded) */}
                    {isExpanded && (
                      <div className="p-4 space-y-4">
                        {/* Financial Breakdown */}
                        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4">
                          <h4 className="text-sm font-semibold text-blue-900 mb-3">Financial Breakdown</h4>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="bg-white rounded-lg p-3">
                              <div className="text-xs text-gray-600 mb-1">Gross Revenue</div>
                              <div className="text-lg font-bold text-gray-900">{formatCurrency(revenue)}</div>
                            </div>
                            <div className="bg-white rounded-lg p-3">
                              <div className="text-xs text-gray-600 mb-1">Payment Fee</div>
                              <div className="text-lg font-bold text-red-600">{formatCurrency(paymentFee)}</div>
                            </div>
                            <div className="bg-white rounded-lg p-3">
                              <div className="text-xs text-gray-600 mb-1">Shipping Fee</div>
                              <div className="text-lg font-bold text-orange-600">{formatCurrency(shippingFee)}</div>
                            </div>
                            <div className="bg-white rounded-lg p-3">
                              <div className="text-xs text-gray-600 mb-1">Platform Fee</div>
                              <div className="text-lg font-bold text-red-600">{formatCurrency(platformFee)}</div>
                            </div>
                          </div>
                          <div className="mt-3 pt-3 border-t border-blue-200">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold text-blue-900">Net Payout</span>
                              <span className="text-xl font-bold text-green-600">{formatCurrency(netPayout)}</span>
                            </div>
                          </div>
                        </div>

                        {/* Order Items */}
                        {order.items && order.items.length > 0 && (
                          <div>
                            <h4 className="text-sm font-semibold text-gray-900 mb-2">Order Items ({order.items.length})</h4>
                            <div className="space-y-2">
                              {order.items.map((item: any, idx: number) => (
                                <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                  <div className="flex-1">
                                    <div className="text-sm font-medium text-gray-900">{item.name || 'Unknown Item'}</div>
                                    {item.category && (
                                      <div className="text-xs text-gray-500 mt-0.5">Category: {item.category}</div>
                                    )}
                                  </div>
                                  <div className="text-right">
                                    <div className="text-sm font-semibold text-gray-900">
                                      {formatCurrency(Number(item.price) || 0)}
                                    </div>
                                    <div className="text-xs text-gray-600">Qty: {item.quantity || 1}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Payment Info */}
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div className="bg-gray-50 rounded-lg p-3">
                            <div className="text-gray-600 mb-1">Payment Method</div>
                            <div className="font-semibold text-gray-900">
                              {order.feesBreakdown?.paymentMethod || 'N/A'}
                            </div>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-3">
                            <div className="text-gray-600 mb-1">Order Status</div>
                            <div className="font-semibold text-gray-900 capitalize">
                              {order.status.replace('_', ' ')}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-gray-200 px-6 py-4 bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Showing {sortedOrders.length} {sortedOrders.length === 1 ? 'order' : 'orders'}
              </div>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
