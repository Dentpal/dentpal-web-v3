import React from 'react';
import { Order } from '@/types/order';
import OrderRow from '../parts/OrderRow';
import { isPickupOrder, isSameDayOrder } from '../config';

interface ViewProps {
  orders: Order[];
  onSelectOrder?: (o: Order) => void;
  onConfirmDelivery?: (o: Order) => void;   // in-transit → move to Delivered
  onMarkAsCompleted?: (o: Order) => void;   // pickup → Completed
  onBookSameDay?: (o: Order) => void;       // same-day → book a Lalamove rider
  shippingLoading?: string | null;          // order id currently booking
}

/**
 * "Shipping" stage (in-transit + pickup + same-day; Delivered is its own tab).
 * OrderRow's menu actions are gated only by which handlers are passed, so we
 * pass them PER-ORDER based on the order's status/method — reproducing what the
 * old per-tab views did, now that they share one stage with method sub-tabs.
 */
const InDeliveryOrdersView: React.FC<ViewProps> = ({
  orders,
  onSelectOrder,
  onConfirmDelivery,
  onMarkAsCompleted,
  onBookSameDay,
  shippingLoading,
}) => (
  <div className="space-y-4">
    {orders.map(o => {
      const sameDay = isSameDayOrder(o);
      const pickup = !sameDay && isPickupOrder(o);
      const inTransit = !sameDay && !pickup && (o.status === 'shipping' || o.status === 'processing');
      return (
        <OrderRow
          key={o.id}
          order={o}
          onDetails={() => onSelectOrder?.(o)}
          onBookSameDay={sameDay ? onBookSameDay : undefined}
          isShippingLoading={shippingLoading === o.id}
          onConfirmDelivery={inTransit ? onConfirmDelivery : undefined}
          onMarkAsCompleted={pickup ? onMarkAsCompleted : undefined}
        />
      );
    })}
  </div>
);

export default InDeliveryOrdersView;
