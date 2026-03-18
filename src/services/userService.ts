import {collection, getDocs, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc, where} from 'firebase/firestore';
import {db } from '@/lib/firebase';
import { auth } from '@/lib/firebase';
import type {User } from '@/components/users/types';

const USERS_COLLECTION ='User';

function computeSellerApproval(raw: any): User['sellerApprovalStatus'] {
  const explicit = raw?.sellerApprovalStatus;
  if (explicit === 'pending' || explicit === 'approved' || explicit === 'not_requested' || explicit === 'rejected') return explicit;
  // Heuristics based on common fields
  if (raw?.role === 'seller' || raw?.isSeller === true || raw?.sellerApproved === true) return 'approved';
  if (raw?.sellerRequestStatus === 'rejected' || raw?.sellerRejected === true) return 'rejected';
  if (
    raw?.requestedRole === 'seller' ||
    raw?.sellerRequest === true ||
    raw?.sellerApprovalPending === true ||
    raw?.sellerRequestStatus === 'pending'
  ) return 'pending';
  return 'not_requested';
}

interface UserAddressData {
  city?: string;
  cityName?: string;
  state?: string;
  province?: string;
  provinceCode?: string;
  isDefault?: boolean;
  addressLine1?: string;
  addressLine2?: string;
  country?: string;
  postalCode?: string;
}

async function fetchUserAddresses(userId: string): Promise<UserAddressData[]> {
  try {
    const addrCol = collection(doc(db, USERS_COLLECTION, userId), 'Address');
    const snap = await getDocs(addrCol);
    console.log(`[fetchUserAddresses] User ${userId}: Found ${snap.docs.length} addresses`);
    
    const addresses = snap.docs.map(d => {
      const data = d.data() as any;
      console.log(`[fetchUserAddresses] Address data for ${userId}:`, {
        city: data?.city,
        state: data?.state,
        province: data?.province,
        provinceCode: data?.provinceCode,
        isDefault: data?.isDefault
      });
      return {
        city: data?.city || data?.cityName,
        state: data?.state, // "Metro Manila", etc.
        province: data?.province,
        provinceCode: data?.provinceCode,
        isDefault: data?.isDefault === true,
        addressLine1: data?.addressLine1,
        addressLine2: data?.addressLine2,
        country: data?.country,
        postalCode: data?.postalCode
      };
    });
    return addresses;
  } catch (e) {
    console.warn('Failed to fetch Address subcollection for user', userId, e);
    return [];
  }
}

// NEW: Count actual orders from Firebase Order collection for a user
async function countUserOrders(userId: string): Promise<number> {
  try {
    const ordersCol = collection(db, 'Order');
    // Query by userId (primary) or customerId (fallback) - try both
    const qUserId = query(ordersCol, where('userId', '==', userId));
    const qCustomerId = query(ordersCol, where('customerId', '==', userId));
    
    const [snapUserId, snapCustomerId] = await Promise.all([
      getDocs(qUserId),
      getDocs(qCustomerId)
    ]);
    
    // Combine unique order IDs from both queries to avoid duplicates
    const orderIds = new Set([
      ...snapUserId.docs.map(d => d.id),
      ...snapCustomerId.docs.map(d => d.id)
    ]);
    
    return orderIds.size;
  } catch (e) {
    console.warn('Failed to count orders for user', userId, e);
    return 0;
  }
}

// NEW: Batch count orders for all users at once (more efficient)
async function countAllUsersOrders(userIds: string[]): Promise<Map<string, number>> {
  const orderCounts = new Map<string, number>();
  
  try {
    // Initialize all users with 0 orders
    userIds.forEach(id => orderCounts.set(id, 0));
    
    // Fetch all orders at once
    const ordersCol = collection(db, 'Order');
    const snap = await getDocs(ordersCol);
    
    // Count orders per userId (primary field) or customerId (fallback)
    let userIdCount = 0;
    let customerIdCount = 0;
    snap.docs.forEach(doc => {
      const data = doc.data();
      const userId = data.userId || data.customerId; // Check both fields
      
      if (data.userId) userIdCount++;
      if (data.customerId) customerIdCount++;
      
      if (userId && orderCounts.has(userId)) {
        orderCounts.set(userId, (orderCounts.get(userId) || 0) + 1);
      }
    });
    
    console.log('[countAllUsersOrders] Counted orders for', userIds.length, 'users. Total orders:', snap.size);
    console.log('[countAllUsersOrders] Field usage - userId:', userIdCount, 'customerId:', customerIdCount);
  } catch (e) {
    console.error('Failed to count orders for users', e);
  }
  
  return orderCounts;
}

export async function fetchUsers(): Promise<User []> {
  // Use createdAt based on Firestore screenshot; fallback to unsorted if field missing at runtime.
  const q = query(collection(db, USERS_COLLECTION), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  const base = snap.docs.map(d=> ({ id: d.id, ...(d.data() as any) }));
  
  console.log('[fetchUsers] Sample raw user data with specialty field (array from Firebase):', 
    base.slice(0, 3).map(u => ({ 
      id: u.id, 
      email: u.email, 
      specialty: u.specialty,
      specialtyType: Array.isArray(u.specialty) ? 'array' : typeof u.specialty,
      specialtyLength: Array.isArray(u.specialty) ? u.specialty.length : 'N/A'
    }))
  );
  
  console.log('[fetchUsers] Loading addresses and counting orders for', base.length, 'users...');
  
  // Batch count orders for all users at once (more efficient than per-user queries)
  const orderCounts = await countAllUsersOrders(base.map(u => u.id));
  
  const withAddresses = await Promise.all(
    base.map(async (raw: any) => {
      const shippingAddresses = await fetchUserAddresses(raw.id);
      
      // Get order count from batch result
      const orderCount = orderCounts.get(raw.id) || 0;
      
      // Parse specialty field - it's an array in Firebase
      let specialtyArray: string[] = [];
      if (Array.isArray(raw.specialty)) {
        specialtyArray = raw.specialty.filter((s: any) => typeof s === 'string' && s.trim() !== '');
      } else if (typeof raw.specialty === 'string' && raw.specialty.trim() !== '') {
        // Fallback: if it's a string, convert to array
        specialtyArray = [raw.specialty.trim()];
      }
      
      const user: User = {
        id: raw.id,
        accountId: raw.accountId ?? raw.uid ?? raw.id,
        firstName: raw.firstName ?? '',
        middleName: raw.middleName,
        lastName: raw.lastName ?? '',
        email: raw.email ?? '',
        contactNumber: raw.contactNumber ?? '',
        shippingAddresses,
        specialty: specialtyArray,
        totalTransactions: orderCount, // Use actual order count from Firebase
        totalSpent: Number(raw.totalSpent ?? 0),
        registrationDate: (raw.registrationDate ?? raw.createdAt ?? '').toString(),
        lastActivity: (raw.lastActivity ?? raw.updatedAt ?? '').toString(),
        status: (raw.status ?? 'active') as User['status'],
        rewardPoints: Number(raw.rewardPoints ?? 0),
        membershipLevel: (raw.membershipLevel ?? 'bronze') as User['membershipLevel'],
        profileComplete: Boolean(raw.profileComplete ?? false),
        sellerApprovalStatus: computeSellerApproval(raw),
      };
      return user;
    })
  );
  
  console.log('[fetchUsers] Completed loading users with order counts. Sample:', 
    withAddresses.slice(0, 3).map(u => ({ 
      id: u.id, 
      email: u.email, 
      totalTransactions: u.totalTransactions 
    }))
  );
  
  return withAddresses;
}

export function listenUsers(onChange: (users: User[]) => void) {
  const q = query(collection(db,USERS_COLLECTION), orderBy('createdAt', 'desc'));
  const unsub = onSnapshot(
    q,
    async snap => {
      const base = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      
      // Batch count orders for all users
      const orderCounts = await countAllUsersOrders(base.map(u => u.id));
      
      const users = await Promise.all(
        base.map(async (raw: any) => {
          const shippingAddresses = await fetchUserAddresses(raw.id);
          
          // Get order count from batch result
          const orderCount = orderCounts.get(raw.id) || 0;
          
          // Parse specialty field - it's an array in Firebase
          let specialtyArray: string[] = [];
          if (Array.isArray(raw.specialty)) {
            specialtyArray = raw.specialty.filter((s: any) => typeof s === 'string' && s.trim() !== '');
          } else if (typeof raw.specialty === 'string' && raw.specialty.trim() !== '') {
            // Fallback: if it's a string, convert to array
            specialtyArray = [raw.specialty.trim()];
          }
          
          const user: User = {
            id: raw.id,
            accountId: raw.accountId ?? raw.uid ?? raw.id,
            firstName: raw.firstName ?? '',
            middleName: raw.middleName,
            lastName: raw.lastName ?? '',
            email: raw.email ?? '',
            contactNumber: raw.contactNumber ?? '',
            shippingAddresses,
            specialty: specialtyArray,
            totalTransactions: orderCount, // Use actual order count from Firebase
            totalSpent: Number(raw.totalSpent ?? 0),
            registrationDate: (raw.registrationDate ?? raw.createdAt ?? '').toString(),
            lastActivity: (raw.lastActivity ?? raw.updatedAt ?? '').toString(),
            status: (raw.status ?? 'active') as User['status'],
            rewardPoints: Number(raw.rewardPoints ?? 0),
            membershipLevel: (raw.membershipLevel ?? 'bronze') as User['membershipLevel'],
            profileComplete: Boolean(raw.profileComplete ?? false),
            sellerApprovalStatus: computeSellerApproval(raw),
          };
          return user;
        })
      );
      onChange(users);
    },
    err => console.error('Failed to listen to users', err)
  );
  return unsub;
}

export async function updateUserRewardPoints(userId: string, points: number) {
  const ref =doc(db, USERS_COLLECTION, userId);
  await updateDoc(ref, { rewardPoints: points });
}

/**
 * Update user status in Firestore and optionally disable/enable their Firebase Auth account
 * @param userId - The user's Firestore document ID (which should match their Firebase Auth UID)
 * @param status - The new status ('active' or 'inactive')
 * @param updateAuth - Whether to also update the Firebase Auth disabled status (default: true)
 */
export async function updateUserStatus(userId: string, status: User['status'], updateAuth: boolean = true) {
  // Update Firestore status
  const ref = doc(db, USERS_COLLECTION, userId);
  await updateDoc(ref, { status });
  
  // Also update Firebase Auth disabled status if requested
  if (updateAuth && (status === 'active' || status === 'inactive')) {
    try {
      await setUserAuthDisabled(userId, status === 'inactive');
    } catch (error) {
      console.error('Failed to update Firebase Auth status, but Firestore status was updated:', error);
      // Re-throw to let the caller handle it
      throw error;
    }
  }
}

/**
 * Enable or disable a user's Firebase Authentication account
 * This calls the Firebase Cloud Function that uses Admin SDK
 * @param uid - The user's Firebase Auth UID
 * @param disabled - Whether to disable (true) or enable (false) the account
 */
export async function setUserAuthDisabled(uid: string, disabled: boolean): Promise<{ success: boolean }> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('No authenticated user. Please log in.');
  }

  const idToken = await currentUser.getIdToken();
  
  // Get the Firebase Functions URL from environment or use default
  const functionsBaseUrl = import.meta.env.VITE_FIREBASE_FUNCTIONS_URL || 
    `https://asia-southeast1-${import.meta.env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net`;
  
  const response = await fetch(`${functionsBaseUrl}/setUserAccountStatus`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify({ uid, disabled }),
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || `Failed to ${disabled ? 'disable' : 'enable'} user account`);
  }
  
  return data;
}

export async function updateUserSellerApproval(userId: string, status: User['sellerApprovalStatus']) {
  const ref = doc(db, USERS_COLLECTION, userId);
  await updateDoc(ref, { sellerApprovalStatus: status });
}

export async function deleteUser(userId: string) {
  const ref = doc(db, USERS_COLLECTION, userId);
  await deleteDoc(ref);
}