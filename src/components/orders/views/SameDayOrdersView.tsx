import React from 'react';
import { Order } from '@/types/order';
import OrderRow from '../parts/OrderRow';

interface ViewProps {
  orders: Order[];
  onSelectOrder?: (o: Order) => void;
  onBookSameDay?: (o: Order) => void;
  shippingLoading?: string | null; // Order ID currently being booked
}

/** Same Day Delivery (Lalamove) orders — book a rider and track status. */
const SameDayOrdersView: React.FC<ViewProps> = ({ orders, onSelectOrder, onBookSameDay, shippingLoading }) => (
  <div className="space-y-4">{orders.map(o => (
    <OrderRow
      key={o.id}
      order={o}
      onDetails={() => onSelectOrder?.(o)}
      onBookSameDay={onBookSameDay}
      isShippingLoading={shippingLoading === o.id}
    />
  ))}</div>
);
export default SameDayOrdersView;
