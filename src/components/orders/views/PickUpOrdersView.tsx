import React from 'react';
import { Order } from '@/types/order';
import OrderRow from '../parts/OrderRow';

interface ViewProps {
  orders: Order[];
  onSelectOrder?: (o: Order) => void;
  onMarkAsCompleted?: (o: Order) => void;
}
const PickUpOrdersView: React.FC<ViewProps> = ({ orders, onSelectOrder, onMarkAsCompleted }) => (
  <div className="space-y-4">{orders.map(o => (
    <OrderRow
      key={o.id}
      order={o}
      onDetails={() => onSelectOrder?.(o)}
      onMarkAsCompleted={onMarkAsCompleted}
    />
  ))}</div>
);
export default PickUpOrdersView;
