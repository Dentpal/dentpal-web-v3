import { collection, addDoc, getFirestore, Timestamp } from 'firebase/firestore';
import firebaseApp from '@/lib/firebase';

const db = getFirestore(firebaseApp);

export async function logStockAdjustment({
  productId,
  productName,
  sellerId,
  userId,
  userName,
  variationId,
  variationName,
  beforeStock,
  afterStock,
  action,
  reason,
  adjustment
}: {
  productId: string;
  productName: string;
  sellerId: string;
  userId: string;
  userName: string;
  variationId: string;
  variationName: string;
  beforeStock: number;
  afterStock: number;
  action: string;
  reason: string;
  adjustment: number;
}) {
  const logsRef = collection(db, 'Product', productId, 'Logs');
  await addDoc(logsRef, {
    action: action || '', // selected reason
    productId: productId || '',
    productName: productName || '',
    sellerId: sellerId || '',
    userId: userId || '',
    userName: userName || '',
    variationId: variationId || '', // selected variation id
    variationName: variationName || '', // selected variation name
    before: {
      stock: beforeStock ?? 0, // in stock
      variationId: variationId || '',
      variationName: variationName || ''
    },
    after: {
      stock: afterStock ?? 0, // add stock
      variationId: variationId || '',
      variationName: variationName || ''
    },
    detail: `Stock adjusted by ${adjustment > 0 ? '+' : ''}${adjustment} for variation "${variationName || ''}"`,
    reason: reason || '', // notes
    adjustment: adjustment ?? 0,
    at: Date.now(),
    createdAt: Timestamp.now()
  });
}

// New function for logging batch stock adjustments
// Stores ONE log entry in inventory_adjustments collection with Items array
export async function logBatchStockAdjustment({
  batchId,
  items,
  reason,
  notes,
  userId,
  userName,
  sellerId
}: {
  batchId: string;
  items: Array<{
    productId: string;
    productName: string;
    variationId: string;
    variationName: string;
    beforeStock: number;
    newStock: number;
    imageUrl?: string;
  }>;
  reason: string;
  notes: string;
  userId: string;
  userName: string;
  sellerId: string;
}) {
  if (!items || items.length === 0) {
    throw new Error('No items in batch adjustment');
  }
  
  // Save to top-level inventory_adjustments collection
  const adjustmentsRef = collection(db, 'inventory_adjustments');
  
  // Create Items array with all product variations
  const itemsArray = items.map(item => ({
    variationId: item.variationId,
    variationName: item.variationName,
    productId: item.productId,
    productName: item.productName,
    stockBefore: item.beforeStock,
    stockAfter: item.newStock,
    adjustment: item.newStock - item.beforeStock,
    imageUrl: item.imageUrl || '',
    detail: `Stock adjusted by ${item.newStock - item.beforeStock > 0 ? '+' : ''}${item.newStock - item.beforeStock}`
  }));
  
  // Store single batch log entry with Items array
  await addDoc(adjustmentsRef, {
    adjustmentNo: batchId, // Batch adjustment number
    action: reason || '', // e.g., "Receive Items", "Loss/Damage"
    adjustmentBy: userName || userId,
    sellerId: sellerId || '',
    userId: userId || '',
    userName: userName || '',
    items: itemsArray, // Array of all products/variations adjusted
    totalItemsAdjusted: items.length,
    notes: notes || '',
    isBatch: true, // Flag to identify batch adjustments
    at: Date.now(),
    createdAt: Timestamp.now()
  });
}

