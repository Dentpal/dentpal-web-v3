/**
 * Status Badge Component
 * Reusable badge for displaying order status
 */

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md' | 'lg';
}

export const StatusBadge = ({ status, size = 'md' }: StatusBadgeProps) => {
  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5',
    md: 'text-xs px-3 py-1',
    lg: 'text-sm px-4 py-1.5',
  };

  const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
    'completed': { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Completed' },
    'confirmed': { bg: 'bg-green-100', text: 'text-green-700', label: 'Confirmed' },
    'processing': { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Processing' },
    'to_ship': { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'To Ship' },
    'shipped': { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Shipped' },
    'shipping': { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Shipping' },
    'pending': { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Pending' },
    'refunded': { bg: 'bg-rose-100', text: 'text-rose-700', label: 'Refunded' },
    'returned': { bg: 'bg-rose-100', text: 'text-rose-700', label: 'Returned' },
    'return_refund': { bg: 'bg-rose-100', text: 'text-rose-700', label: 'Return/Refund' },
    'return_requested': { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Return Requested' },
    'return_approved': { bg: 'bg-lime-100', text: 'text-lime-700', label: 'Return Approved' },
    'return_rejected': { bg: 'bg-red-100', text: 'text-red-700', label: 'Return Rejected' },
    'cancelled': { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Cancelled' },
    'failed-delivery': { bg: 'bg-red-100', text: 'text-red-700', label: 'Failed Delivery' },
  };

  const config = statusConfig[status] || statusConfig['pending'];

  return (
    <span
      className={`inline-flex items-center ${sizeClasses[size]} rounded-full font-semibold ${config.bg} ${config.text} border border-current border-opacity-20`}
    >
      {config.label}
    </span>
  );
};
