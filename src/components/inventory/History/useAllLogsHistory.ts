import { useEffect, useState } from 'react';
import { collection, getDocs, query, orderBy, collectionGroup } from 'firebase/firestore';
import SellersService, { SellerProfile } from '@/services/sellers';
import { getFirestore } from 'firebase/firestore';
import firebaseApp from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';

const db = getFirestore(firebaseApp);

export interface LogHistoryRow {
  timestamp: string; // locale string for display
  timestampRaw: string | number; // ISO string or epoch ms for stable filtering
  action: string;
  adjustment: number;
  afterStock: number;
  beforeStock: number;
  variationId: string;
  variationName: string;
  productId: string;
  productName: string;
  reason: string;
  userId: string;
  userName: string;
  detail: string;
  modifiedByName?: string;
  batchId?: string; // Add batch ID for grouping
  isBatch?: boolean; // Flag to indicate if this is a batch record
  batchItems?: any[]; // Array of items in the batch
  totalItemsAdjusted?: number; // Total items in batch
}

export function useAllLogsHistory() {
  const [logs, setLogs] = useState<LogHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { uid, parentId, isSubAccount } = useAuth();

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        setLoading(true);
        
        // Don't fetch if no user is authenticated
        if (!uid) {
          console.log('No authenticated user, skipping fetch');
          setLogs([]);
          setLoading(false);
          return;
        }
        
        // Use parent ID if this is a sub-account, otherwise use current user's ID
        const accountId = isSubAccount && parentId ? parentId : uid;
        console.log('=== Fetching batch adjustments from Firebase ===');
        console.log('Will filter by account ID:', accountId);
        
        // Query inventory_adjustments collection for all batch adjustments
        const adjustmentsRef = collection(db, 'inventory_adjustments');
        console.log('Collection reference created:', adjustmentsRef.path);
        
        const q = query(adjustmentsRef, orderBy('createdAt', 'desc'));
        console.log('Query created with orderBy createdAt desc');
        
        const snapshot = await getDocs(q);
        console.log('Snapshot received, size:', snapshot.size);
        console.log('Snapshot empty?:', snapshot.empty);
        
        if (snapshot.empty) {
          console.warn('No batch adjustments found in Firebase');
          setLogs([]);
          setLoading(false);
          return;
        }
        
        const docsData = snapshot.docs.map(doc => {
          console.log('Document ID:', doc.id);
          console.log('Document data:', doc.data());
          return doc.data();
        });
        
        console.log('Total documents processed:', docsData.length);
        console.log('First doc sample:', JSON.stringify(docsData[0], null, 2));
        
        // Filter data by accountId (current user or parent account)
        // Check both sellerId and userId for backwards compatibility
        const filteredData = docsData.filter(d => d.sellerId === accountId || d.userId === accountId);
        console.log(`Filtered to ${filteredData.length} adjustments for account ${accountId}`);
        
        // Fetch seller names for all unique userIds
        const userIds = Array.from(new Set(filteredData.map(d => d.userId).filter(Boolean)));
        console.log('Fetching seller profiles for userIds:', userIds);
        
        const userProfiles: Record<string, any> = {};
        const profileResults = await Promise.allSettled(userIds.map(uid => SellersService.get(uid)));
        userIds.forEach((uid, idx) => {
          const result = profileResults[idx];
          if (result.status === 'fulfilled') {
            userProfiles[uid] = result.value;
            console.log(`Seller profile for ${uid}:`, result.value?.name);
          } else {
            userProfiles[uid] = null;
            console.log(`Failed to fetch seller profile for ${uid}`);
          }
        });
        
        // Process all batch adjustments
        const batchRows: LogHistoryRow[] = filteredData.map(d => {
          let dateObj: Date | null = null;
          let timestampRaw: string | number = '';
          
          if (d.createdAt?.toDate) {
            dateObj = d.createdAt.toDate();
            timestampRaw = dateObj.toISOString();
          } else if (d.createdAt?._seconds) {
            dateObj = new Date(d.createdAt._seconds * 1000);
            timestampRaw = d.createdAt._seconds * 1000;
          } else if (d.at) {
            dateObj = new Date(d.at);
            timestampRaw = d.at;
          }
          
          // Get seller name from userProfiles
          const sellerName = d.userId && userProfiles[d.userId]?.name 
            ? userProfiles[d.userId].name 
            : d.adjustmentBy || d.userName || d.userId || '';
          
          return {
            timestamp: dateObj ? dateObj.toLocaleString() : '',
            timestampRaw,
            action: d.action || '',
            adjustment: 0,
            afterStock: 0,
            beforeStock: 0,
            variationId: '',
            variationName: '',
            productId: '',
            productName: `Batch Adjustment (${d.totalItemsAdjusted || d.items?.length || 0} items)`,
            reason: d.notes || '',
            userId: d.userId || '',
            userName: d.userName || '',
            detail: d.adjustmentNo || '',
            modifiedByName: sellerName,
            batchId: d.adjustmentNo,
            isBatch: true,
            batchItems: d.items || [],
            totalItemsAdjusted: d.totalItemsAdjusted || d.items?.length || 0
          };
        });
        
        // Sort by timestamp (newest first)
        const allRows = batchRows.sort((a, b) => {
          const timeA = typeof a.timestampRaw === 'number' ? a.timestampRaw : new Date(a.timestampRaw).getTime();
          const timeB = typeof b.timestampRaw === 'number' ? b.timestampRaw : new Date(b.timestampRaw).getTime();
          return timeB - timeA;
        });
        
        console.log('Displaying only batch adjustments:', allRows.length);
        console.log('All rows data:', JSON.stringify(allRows, null, 2));
        setLogs(allRows);
      } catch (error) {
        console.error('Error fetching logs:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        setLogs([]);
      } finally {
        setLoading(false);
      }
    };
    
    fetchLogs();
  }, [uid, parentId, isSubAccount]);

  return { logs, loading };
}
