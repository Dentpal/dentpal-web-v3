import React from 'react';


import StockAdjustment from './StockAdjustment';
import History from './History';

interface InventoryTabProps {
	activeView: 'all' | 'history' | 'stock-adjustment';
}

const InventoryTab: React.FC<InventoryTabProps> = ({ activeView }) => {
	if (activeView === 'stock-adjustment') return <StockAdjustment />;
	if (activeView === 'history' || activeView === 'all') return <History />;
	return <div>Invalid inventory section</div>;
};

export default InventoryTab;
