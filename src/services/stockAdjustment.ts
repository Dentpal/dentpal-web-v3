import { doc, updateDoc, writeBatch, getFirestore, collection, addDoc, Timestamp } from 'firebase/firestore';
import firebaseApp from '../lib/firebase';

const db = getFirestore(firebaseApp);

// Generate unique batch ID for tracking multiple product adjustments
export function generateBatchId(): string {
  return `BATCH-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export async function adjustVariationStock(productId: string, variationId: string, newStock: number) {
  const variationRef = doc(db, 'Product', productId, 'Variation', variationId);
  await updateDoc(variationRef, { stock: newStock });
}

export async function batchAdjustVariationStock(productId: string, adjustments: { variationId: string; newStock: number }[]) {
  const batch = writeBatch(db);
  adjustments.forEach(({ variationId, newStock }) => {
    const variationRef = doc(db, 'Product', productId, 'Variation', variationId);
    batch.update(variationRef, { stock: newStock });
  });
  await batch.commit();
}

// New function for multi-product batch adjustment
export interface BatchAdjustmentItem {
  productId: string;
  productName: string;
  variationId: string;
  variationName: string;
  newStock: number;
  beforeStock: number;
  imageUrl?: string;
}

export async function batchAdjustMultipleProducts(
  items: BatchAdjustmentItem[],
  metadata: {
    batchId: string;
    reason: string;
    notes: string;
    userId: string;
    userName: string;
    sellerId: string;
  }
) {
  const batch = writeBatch(db);
  
  // Update stock for all items
  items.forEach(({ productId, variationId, newStock }) => {
    const variationRef = doc(db, 'Product', productId, 'Variation', variationId);
    batch.update(variationRef, { stock: newStock });
  });
  
  await batch.commit();
}

