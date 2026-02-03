import React from 'react';
import { Order } from '@/types/order';
import OrderRow from '../parts/OrderRow';

interface ViewProps { 
  orders: Order[]; 
  onSelectOrder?: (o: Order) => void; 
  onMoveToArrangement?: (order: Order) => void; 
  onMoveToHandOver?: (order: Order) => void; 
  onConfirmHandover?: (order: Order) => void; 
  onMoveToPack?: (order: Order) => void; // Move back from arrangement to pack
  onMoveToShipping?: (order: Order) => void; // Move from hand-over to shipping
  shippingLoading?: string | null; // Order ID currently being processed for shipping
  selectedOrderIds?: Set<string>; // IDs of selected orders in To Hand Over tab
  onToggleOrderSelection?: (order: Order) => void; // Callback to toggle order selection
  selectedArrangementOrderIds?: Set<string>; // IDs of selected orders in To Arrangement tab
  onToggleArrangementOrderSelection?: (order: Order) => void; // Callback to toggle arrangement order selection
}

const ToShipOrdersView: React.FC<ViewProps> = ({ 
  orders, 
  onSelectOrder, 
  onMoveToArrangement, 
  onMoveToHandOver, 
  onConfirmHandover, 
  onMoveToPack, 
  onMoveToShipping, 
  shippingLoading,
  selectedOrderIds,
  onToggleOrderSelection,
  selectedArrangementOrderIds,
  onToggleArrangementOrderSelection
}) => (
  <div className="space-y-4">
    {orders.map(o => {
      // Enable selection for To Hand Over stage or To Arrangement stage
      const isHandOverSelectable = o.fulfillmentStage === 'to-hand-over';
      const isArrangementSelectable = o.fulfillmentStage === 'to-arrangement';
      const isSelected = isHandOverSelectable 
        ? (selectedOrderIds?.has(o.id) ?? false)
        : isArrangementSelectable
        ? (selectedArrangementOrderIds?.has(o.id) ?? false)
        : false;
      const onToggle = isHandOverSelectable 
        ? onToggleOrderSelection 
        : isArrangementSelectable 
        ? onToggleArrangementOrderSelection 
        : undefined;

      return (
        <OrderRow 
          key={o.id} 
          order={o} 
          onDetails={() => onSelectOrder?.(o)} 
          isToShip={true} 
          onMoveToArrangement={onMoveToArrangement}
          onMoveToHandOver={onMoveToHandOver}
          onConfirmHandover={onConfirmHandover}
          onMoveToPack={onMoveToPack}
          onMoveToShipping={onMoveToShipping}
          isShippingLoading={shippingLoading === o.id}
          isSelectable={isHandOverSelectable || isArrangementSelectable}
          isSelected={isSelected}
          onToggleSelect={onToggle}
        />
      );
    })}
  </div>
);

export default ToShipOrdersView;
