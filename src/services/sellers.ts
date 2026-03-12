import { getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, serverTimestamp, orderBy } from 'firebase/firestore';
import app, { storage, auth } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const db = getFirestore(app);
const SELLER_COL = 'Seller';
const LEGACY_COL = 'web_users';

export interface SellerProfile {
  id: string;
  email?: string;
  name?: string;
  role?: 'admin' | 'seller';
  isActive?: boolean;
  permissions?: Record<string, boolean>;
  createdAt?: number | string;
  Platform_fee_percentage?: number; // Platform fee percentage (default 8.88%)
  // Optional vendor profile fields
  vendor?: {
    tin?: string;
    bir?: { url: string; path: string } | null;
    company?: {
      name?: string;
      address?: { line1?: string; line2?: string; city?: string; province?: string; zip?: string };
    };
    contacts?: { name?: string; email?: string; phone?: string };
    requirements?: { birSubmitted?: boolean; profileCompleted?: boolean };
    // Allow additional keys saved from enrollment
    [key: string]: any;
  };
}

const mapDoc = (d: any): SellerProfile => ({ id: d.id, ...d.data() });

const SellersService = {
  async list(): Promise<SellerProfile[]> {
    const dstSnap = await getDocs(collection(db, SELLER_COL));
    if (!dstSnap.empty) return dstSnap.docs.map(mapDoc);
    const legacySnap = await getDocs(collection(db, LEGACY_COL));
    return legacySnap.docs.map(mapDoc);
  },
  async get(id: string): Promise<SellerProfile | null> {
    const d = await getDoc(doc(db, SELLER_COL, id));
    if (d.exists()) return mapDoc(d);
    const legacy = await getDoc(doc(db, LEGACY_COL, id));
    return legacy.exists() ? mapDoc(legacy) : null;
  },
  async create(id: string, data: Omit<SellerProfile, 'id'>): Promise<void> {
    await setDoc(doc(db, SELLER_COL, id), { ...data });
  },
  async update(id: string, data: Partial<SellerProfile>): Promise<void> {
    await updateDoc(doc(db, SELLER_COL, id), { ...data } as any);
  },
  async remove(id: string): Promise<void> {
    await deleteDoc(doc(db, SELLER_COL, id));
  },
  async findByEmail(email: string): Promise<SellerProfile[]> {
    const q1 = query(collection(db, SELLER_COL), where('email', '==', email));
    const s1 = await getDocs(q1);
    if (!s1.empty) return s1.docs.map(mapDoc);
    const q2 = query(collection(db, LEGACY_COL), where('email', '==', email));
    const s2 = await getDocs(q2);
    return s2.docs.map(mapDoc);
  },
  // Upload a seller image to Firebase Storage under SellerImages/<sellerId>/
  async uploadImage(sellerId: string, file: File, folder = 'SellerImages'): Promise<{ url: string; path: string }> {
    const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const path = `${folder}/${sellerId}/${Date.now()}_${safeName}`;
    const r = ref(storage, path);
    await uploadBytes(r, file);
    const url = await getDownloadURL(r);
    return { url, path };
  },
  // Save or update vendor profile details (accepts full vendor payload)
  async saveVendorProfile(sellerId: string, payload: Record<string, any>): Promise<void> {
    const refDoc = doc(db, SELLER_COL, sellerId);
    // Merge vendor fields to avoid wiping unrelated data
    await setDoc(refDoc, { vendor: payload } as any, { merge: true });
  },
  // Create a sub-account invite under Seller/<sellerId>/members with masked permissions
  async createSubAccountInvite(parentSellerId: string, name: string, email: string, permissions: Record<string, boolean>, createdBy?: string) {
    const membersCol = collection(db, SELLER_COL, parentSellerId, 'members');
    const memberRef = doc(membersCol);
    const payload = {
      inviteId: memberRef.id,
      name,
      email,
      permissions,
      status: 'pending',
      isSubAccount: true,
      parentId: parentSellerId,
      invitedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      createdBy: createdBy || parentSellerId,
    } as any;
    await setDoc(memberRef, payload, { merge: true });
    return { id: memberRef.id, ...payload };
  },
  // NEW: List sub-accounts (members) under a seller, newest first
  async listSubAccounts(parentSellerId: string) {
    const membersCol = collection(db, SELLER_COL, parentSellerId, 'members');
    const q1 = query(membersCol, orderBy('createdAt', 'desc'));
    const snap = await getDocs(q1);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  // NEW: Update a sub-account/member doc
  async updateSubAccount(parentSellerId: string, memberId: string, data: Partial<{ name: string; email: string; permissions: Record<string, boolean>; status: string }>) {
    const refDoc = doc(db, SELLER_COL, parentSellerId, 'members', memberId);
    await updateDoc(refDoc, { ...data } as any);
  },
  // NEW: Delete a sub-account/member doc
  async deleteSubAccount(parentSellerId: string, memberId: string) {
    // First, get the member data to retrieve the uid
    const memberRef = doc(db, SELLER_COL, parentSellerId, 'members', memberId);
    const memberSnap = await getDoc(memberRef);
    
    if (!memberSnap.exists()) {
      throw new Error('Sub-account not found');
    }
    
    const memberData = memberSnap.data();
    const memberUid = memberData?.uid;
    
    // Delete the member document from the subcollection
    await deleteDoc(memberRef);
    
    // If the member has a uid (was activated), delete from Seller collection and Firebase Auth
    if (memberUid) {
      try {
        // Delete from Seller collection
        const sellerDoc = doc(db, SELLER_COL, memberUid);
        await deleteDoc(sellerDoc);
        
        // Try to delete from legacy web_users collection too
        try {
          const legacyDoc = doc(db, LEGACY_COL, memberUid);
          await deleteDoc(legacyDoc);
        } catch (legacyError) {
          console.warn('Legacy collection delete failed (may not exist):', legacyError);
        }
        
        // Delete from Firebase Authentication via Cloud Function
        try {
          const currentUser = auth.currentUser;
          if (currentUser) {
            const idToken = await currentUser.getIdToken();
            const functionUrl = import.meta.env.VITE_FIREBASE_FUNCTION_URL || 
                               `https://asia-southeast1-${import.meta.env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net`;
            
            const response = await fetch(`${functionUrl}/deleteUserAccount`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`,
              },
              body: JSON.stringify({ uid: memberUid }),
            });
            
            if (!response.ok) {
              console.error('Failed to delete user from Authentication:', {
                status: response.status,
                statusText: response.statusText
              });
            }
          } else {
            console.warn('No authenticated user to call delete function - skipping Auth deletion');
          }
        } catch (authError) {
          console.error('Error deleting user from Authentication:', authError);
          // Don't throw - allow the operation to complete
        }
      } catch (error) {
        console.error('Error deleting sub-account user data:', error);
        // Don't throw - member document is already deleted
      }
    }
  },
  // Update platform fee percentage for a seller
  async updatePlatformFee(sellerId: string, platformFeePercentage: number): Promise<void> {
    const refDoc = doc(db, SELLER_COL, sellerId);
    await updateDoc(refDoc, { Platform_fee_percentage: platformFeePercentage });
  }
};

export default SellersService;
