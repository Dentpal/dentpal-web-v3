import React from 'react';
import { Order } from '@/types/order';
import OrderRow from '../parts/OrderRow';

interface ViewProps {
  orders: Order[];
  onSelectOrder?: (o: Order) => void;
  onInitiateReturn?: (o: Order) => void;
  onMarkAsCompleted?: (o: Order) => void;
}
const DeliveredOrdersView: React.FC<ViewProps> = ({ orders, onSelectOrder, onInitiateReturn, onMarkAsCompleted }) => (
  <div className="space-y-4">{orders.map(o => (
    <OrderRow
      key={o.id}
      order={o}
      onDetails={() => onSelectOrder?.(o)}
      onInitiateReturn={onInitiateReturn}
      onMarkAsCompleted={onMarkAsCompleted}
    />
  ))}</div>
);
export default DeliveredOrdersView;
