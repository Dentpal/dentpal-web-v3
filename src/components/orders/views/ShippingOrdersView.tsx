import React from 'react';
import { Order } from '@/types/order';
import OrderRow from '../parts/OrderRow';

interface ViewProps {
  orders: Order[];
  onSelectOrder?: (o: Order) => void;
  onConfirmDelivery?: (o: Order) => void;
}
const ShippingOrdersView: React.FC<ViewProps> = ({ orders, onSelectOrder, onConfirmDelivery }) => (
  <div className="space-y-4">{orders.map(o => (
    <OrderRow
      key={o.id}
      order={o}
      onDetails={() => onSelectOrder?.(o)}
      onConfirmDelivery={onConfirmDelivery}
    />
  ))}</div>
);
export default ShippingOrdersView;
