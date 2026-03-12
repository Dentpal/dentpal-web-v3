import { useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, getCountFromServer } from 'firebase/firestore';

export default function useProductSearch(uid: string | undefined) {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const searchProducts = async (search: string) => {
    if (!uid) {
      setResults([]);
      setLoading(false);
      setError('User not authenticated');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const productsRef = collection(db, 'Product');
      let q = query(productsRef, where('sellerID', '==', uid));
      let snapshot = await getDocs(q);
      if (snapshot.empty) {
        q = query(productsRef, where('sellerId', '==', uid));
        snapshot = await getDocs(q);
      }
      if (snapshot.empty) {
        q = query(productsRef, where('userId', '==', uid));
        snapshot = await getDocs(q);
      }
      if (snapshot.empty) {
        q = query(productsRef, where('uid', '==', uid));
        snapshot = await getDocs(q);
      }
      if (snapshot.empty) {
        setResults([]);
        setError('No products found for your account. Please check if you have added products.');
        setLoading(false);
        return;
      }
      const filtered = [];
      for (const doc of snapshot.docs) {
        const data = doc.data();
        
        // Filter: Only include active and approved products
        const status = data.status || (data.isActive ? 'active' : 'inactive');
        const isApproved = data.isApproved ?? data.IsApproved ?? false; // Default to false for safety
        
        // Skip if not active or not approved
        if (status !== 'active' || !isApproved) {
          continue;
        }
        
        const productName = data.name || '';
        if (search.trim() && !productName.toLowerCase().includes(search.toLowerCase().trim())) {
          continue;
        }
        let totalStock = 0;
        const variationsRef = collection(db, `Product/${doc.id}/Variation`);
        const variationsSnap = await getDocs(variationsRef);
        variationsSnap.forEach(variationDoc => {
          const v = variationDoc.data();
          totalStock += typeof v.stock === 'number' ? v.stock : 0;
        });
        const logsRef = collection(db, `Product/${doc.id}/Logs`);
        const logsSnap = await getCountFromServer(logsRef);
        const logCount = logsSnap.data().count || 0;
        // Try to get sellerId and userName/sellerName from product data
        const sellerId = data.sellerId || data.sellerID || data.userId || data.uid || '';
        const sellerName = data.sellerName || data.userName || data.displayName || '';
        filtered.push({
          id: doc.id,
          product: productName,
          stock: totalStock,
          adjustNo: logCount,
          imageUrl: data.imageURL || data.imageUrl || undefined,
          sellerId,
          sellerName,
        });
      }
      setResults(filtered);
      if (filtered.length === 0 && search.trim()) {
        setError(`No products found matching "${search}"`);
      }
    } catch (err) {
      setError('Failed to search products. Please try again.');
      setResults([]);
    }
    setLoading(false);
  };

  return { results, loading, error, searchProducts };
}
