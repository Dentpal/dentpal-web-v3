export interface InventoryItem {
  id: string;
  itemName: string;
  sku: string;
  stockCount: number;
  suggestedThreshold: number;
  currentStock: number;
  stockAfter?: number;
  status: 'active' | 'low_stock' | 'stockout' | 'inactive';
  category: string;
  supplier: string;
  unitPrice: number;
  totalValue: number;
  lastUpdated: string;
  createdAt: string;
  updatedBy: string;
  description?: string;
  location?: string;
}

export interface StockAdjustmentItem {
  productId: string;
  productName: string;
  variationId: string;
  variationName: string;
  stockBefore: number;
  stockAfter: number;
  adjustmentQty: number;
  imageUrl?: string;
}

export interface StockAdjustment {
  id: string;
  batchId: string; // Unique identifier for the batch adjustment
  adjustmentNo: string;
  date: string;
  reason: string;
  adjustmentType: 'add' | 'remove' | 'adjust';
  userEditor: string;
  userId: string;
  timestamp: string;
  notes?: string;
  items: StockAdjustmentItem[]; // Multiple products/variations
  sellerId: string;
  totalItemsAdjusted: number;
}

export interface InventoryFilters {
  dateRange?: { start: string; end: string };
  category?: string;
  supplier?: string;
  status?: string;
  reason?: string;
}

export interface InventoryStats {
  totalItems: number;
  activeItems: number;
  lowStockItems: number;
  stockoutItems: number;
  totalValue: number;
}

export interface InventoryTabProps {
  loading?: boolean;
  error?: string | null;
  setError?: (error: string | null) => void;
  onTabChange?: (tab: string) => void;
}
