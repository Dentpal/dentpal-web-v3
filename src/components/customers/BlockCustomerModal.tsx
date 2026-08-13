/**
 * BlockCustomerModal
 * Confirmation modal used by the seller Customers tab and the order-detail
 * quick-action. Lets the seller (or an authorized sub-account) block a buyer
 * with an optional reason. Unblock confirmation reuses the same component.
 */

import { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import type { SellerCustomer } from '@/hooks/useSellerCustomers';
import maskName from '@/utils/maskName';

interface BlockCustomerModalProps {
  customer: SellerCustomer;
  mode: 'block' | 'unblock';
  onConfirm: (reason: string) => Promise<void> | void;
  onClose: () => void;
}

export const BlockCustomerModal = ({ customer, mode, onConfirm, onClose }: BlockCustomerModalProps) => {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e) {
      console.error('BlockCustomerModal action failed:', e);
      setSubmitting(false);
    }
  };

  const isBlock = mode === 'block';

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
          <div className={`px-6 py-4 flex items-center justify-between ${isBlock ? 'bg-rose-50 border-b border-rose-100' : 'bg-emerald-50 border-b border-emerald-100'}`}>
            <div className="flex items-center gap-2">
              <AlertTriangle className={`w-5 h-5 ${isBlock ? 'text-rose-600' : 'text-emerald-600'}`} />
              <h3 className="text-base font-semibold text-gray-900">
                {isBlock ? 'Ban this buyer?' : 'Unban this buyer?'}
              </h3>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-6 py-4 space-y-4">
            <div className="bg-gray-50 rounded-lg px-3 py-2.5 text-sm">
              <div className="font-semibold text-gray-900">{maskName(customer.name) || '—'}</div>
              {customer.email && <div className="text-xs text-gray-500">{customer.email}</div>}
              <div className="text-xs text-gray-600 mt-1.5">
                {customer.totalOrders} order{customer.totalOrders === 1 ? '' : 's'} ·{' '}
                <span className="text-rose-600">{customer.cancelled} cancelled</span> ·{' '}
                cancel rate {(customer.cancellationRate * 100).toFixed(0)}%
              </div>
            </div>

            {isBlock ? (
              <>
                <p className="text-sm text-gray-700">
                  Once banned, this buyer will be prevented from placing new orders with your store. Existing orders are not affected. You can unban at any time.
                </p>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Reason <span className="text-gray-400">(optional, only you can see this)</span>
                  </label>
                  <textarea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    rows={3}
                    placeholder="e.g. repeated cancellations, fake address…"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none"
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-700">
                This buyer will be able to place orders with your store again.
              </p>
            )}
          </div>

          <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-gray-700 rounded-md border border-gray-200 hover:bg-white"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md text-white transition disabled:opacity-50 ${
                isBlock ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {submitting ? '…' : isBlock ? 'Ban Buyer' : 'Unban Buyer'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default BlockCustomerModal;
