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
  onCancelShipment?: (order: Order) => void; // Cancel JRS shipping and roll back to arrangement
  shippingLoading?: string | null; // Order ID currently being processed for shipping
  cancelLoading?: string | null; // Order ID currently being processed for cancellation
  selectedOrderIds?: Set<string>; // IDs of selected orders in To Hand Over tab
  onToggleOrderSelection?: (order: Order) => void; // Callback to toggle order selection
  selectedArrangementOrderIds?: Set<string>; // IDs of selected orders in To Arrangement tab
  onToggleArrangementOrderSelection?: (order: Order) => void; // Callback to toggle arrangement order selection
  selectedPackOrderIds?: Set<string>; // IDs of selected orders in To Pack tab
  onTogglePackOrderSelection?: (order: Order) => void; // Callback to toggle pack order selection
}

const ToShipOrdersView: React.FC<ViewProps> = ({
  orders,
  onSelectOrder,
  onMoveToArrangement,
  onMoveToHandOver,
  onConfirmHandover,
  onMoveToPack,
  onMoveToShipping,
  onCancelShipment,
  shippingLoading,
  cancelLoading,
  selectedOrderIds,
  onToggleOrderSelection,
  selectedArrangementOrderIds,
  onToggleArrangementOrderSelection,
  selectedPackOrderIds,
  onTogglePackOrderSelection
}) => (
  <div className="space-y-4">
    {orders.map(o => {
      // Enable selection for To Pack, To Arrangement, or To Hand Over stages
      const isHandOverSelectable = o.fulfillmentStage === 'to-hand-over';
      const isArrangementSelectable = o.fulfillmentStage === 'to-arrangement';
      const isPackSelectable = !o.fulfillmentStage || o.fulfillmentStage === 'to-pack';
      const isSelected = isHandOverSelectable
        ? (selectedOrderIds?.has(o.id) ?? false)
        : isArrangementSelectable
        ? (selectedArrangementOrderIds?.has(o.id) ?? false)
        : isPackSelectable
        ? (selectedPackOrderIds?.has(o.id) ?? false)
        : false;
      const onToggle = isHandOverSelectable
        ? onToggleOrderSelection
        : isArrangementSelectable
        ? onToggleArrangementOrderSelection
        : isPackSelectable
        ? onTogglePackOrderSelection
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
          onCancelShipment={onCancelShipment}
          isShippingLoading={shippingLoading === o.id}
          isCancelLoading={cancelLoading === o.id}
          isSelectable={isHandOverSelectable || isArrangementSelectable || isPackSelectable}
          isSelected={isSelected}
          onToggleSelect={onToggle}
        />
      );
    })}
  </div>
);

export default ToShipOrdersView;
