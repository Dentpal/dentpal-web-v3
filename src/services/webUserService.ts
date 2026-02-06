import { 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc,
  query, 
  where, 
  orderBy, 
  serverTimestamp,
  Timestamp,
  DocumentReference
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import type { WebUserProfile, WebUserPermissions, WebUserRole } from '@/types/webUser';
import { createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';

// Collections
const SELLER_COLLECTION = 'Seller';
const WEB_USERS_COLLECTION = 'web_users'; // legacy

async function safeUpdateBoth(uid: string, data: Record<string, any>) {
  // Always update Seller
  await updateDoc(doc(db, SELLER_COLLECTION, uid), data).catch(() => {});
  // Mirror to legacy if exists
  try {
    const legacyRef = doc(db, WEB_USERS_COLLECTION, uid);
    const legacy = await getDoc(legacyRef);
    if (legacy.exists()) await updateDoc(legacyRef, data).catch(() => {});
  } catch {}
}

/**
 * Fetch users (prefer Seller, fallback to legacy web_users)
 */
export async function getWebUsers(roles?: WebUserRole[]): Promise<WebUserProfile[]> {
  try {
    const sellerSnap = await getDocs(collection(db, SELLER_COLLECTION));
    const sourceSnap = !sellerSnap.empty ? sellerSnap : await getDocs(collection(db, WEB_USERS_COLLECTION));

    const users: WebUserProfile[] = [];
    sourceSnap.forEach((d) => {
      const userData = d.data() as Omit<WebUserProfile, 'uid'>;
      const user = { uid: d.id, ...userData } as WebUserProfile;
      if (!roles || roles.length === 0 || roles.includes(user.role)) users.push(user);
    });

    return users.sort((a, b) => (Number(b.createdAt || 0) - Number(a.createdAt || 0)));
  } catch (error) {
    console.error('Error fetching users:', error);
    throw new Error('Failed to fetch users');
  }
}

export async function getWebUser(uid: string): Promise<WebUserProfile | null> {
  try {
    const sellerDoc = await getDoc(doc(db, SELLER_COLLECTION, uid));
    if (sellerDoc.exists()) return { uid: sellerDoc.id, ...(sellerDoc.data() as any) };
    const legacyDoc = await getDoc(doc(db, WEB_USERS_COLLECTION, uid));
    return legacyDoc.exists() ? ({ uid: legacyDoc.id, ...(legacyDoc.data() as any) }) : null;
  } catch (error) {
    console.error('Error fetching user:', error);
    throw new Error('Failed to fetch user');
  }
}

/**
 * Create auth user + profile (now writes to Seller; mirrors to legacy for compatibility)
 */
export async function createWebUser(email: string, name: string, role: WebUserRole, permissions: WebUserPermissions): Promise<WebUserProfile> {
  try {
    const tempPassword = `Temp${Math.random().toString(36).slice(-8)}#${Math.floor(Math.random() * 100)}`;
    const userCredential = await createUserWithEmailAndPassword(auth, email, tempPassword);
    const { user } = userCredential;

    const userData: Omit<WebUserProfile, 'uid'> = {
      email,
      name,
      role,
      permissions,
      isActive: true,
      createdAt: Date.now(),
    } as any;

    // Primary write to Seller
    await setDoc(doc(db, SELLER_COLLECTION, user.uid), userData);
    // Mirror to legacy for now
    try { await setDoc(doc(db, WEB_USERS_COLLECTION, user.uid), userData); } catch {}

    try {
      await sendPasswordResetEmail(auth, email, { url: `${window.location.origin}/auth`, handleCodeInApp: true });
    } catch (emailError) {
      console.warn('Failed to send invite email:', emailError);
    }

    return { uid: user.uid, ...userData } as WebUserProfile;
  } catch (error) {
    console.error('Error creating user:', error);
    throw error;
  }
}

export async function createSellerSubAccount(parentSellerId: string, email: string, name: string, permissions: WebUserPermissions): Promise<WebUserProfile> {
  try {
    const tempPassword = `Temp${Math.random().toString(36).slice(-8)}#${Math.floor(Math.random() * 100)}`;
    const cred = await createUserWithEmailAndPassword(auth, email, tempPassword);
    const { user } = cred;

    const profile: Omit<WebUserProfile, 'uid'> = {
      email,
      name,
      role: 'seller',
      permissions,
      isActive: true,
      createdAt: Date.now(),
      isSubAccount: true,
      parentId: parentSellerId,
    } as any;

    await setDoc(doc(db, SELLER_COLLECTION, user.uid), profile);
    try { await setDoc(doc(db, WEB_USERS_COLLECTION, user.uid), profile); } catch {}

    // Link to members collection (if an invite exists), set uid and activate
    try {
      const membersCol = collection(db, SELLER_COLLECTION, parentSellerId, 'members');
      // Prefer exact match by email
      const q1 = query(membersCol, where('email', '==', email));
      const snap = await getDocs(q1);
      const target = !snap.empty ? snap.docs[0] : null;
      if (target) {
        await updateDoc(target.ref, { uid: user.uid, status: 'active', acceptedAt: serverTimestamp() });
      }
    } catch {}

    try {
      await sendPasswordResetEmail(auth, email, { url: `${window.location.origin}/auth`, handleCodeInApp: true });
    } catch (emailError) {
      console.warn('Failed to send invite email:', emailError);
    }

    return { uid: user.uid, ...profile } as WebUserProfile;
  } catch (error) {
    console.error('Error creating sub-account:', error);
    throw error;
  }
}

export async function updateWebUserAccess(uid: string, role: WebUserRole, permissions: WebUserPermissions): Promise<boolean> {
  try {
    await safeUpdateBoth(uid, { role, permissions });
    return true;
  } catch (error) {
    console.error('Error updating access:', error);
    throw new Error('Failed to update user access');
  }
}

export async function setWebUserStatus(uid: string, isActive: boolean): Promise<boolean> {
  try {
    await safeUpdateBoth(uid, { isActive });
    return true;
  } catch (error) {
    console.error('Error updating status:', error);
    throw new Error('Failed to update user status');
  }
}

export async function updateWebUserProfile(
  uid: string,
  profileData: Partial<Omit<WebUserProfile, 'uid' | 'email' | 'role' | 'permissions' | 'isActive' | 'createdAt'>>
): Promise<boolean> {
  try {
    await safeUpdateBoth(uid, profileData);
    return true;
  } catch (error) {
    console.error('Error updating profile:', error);
    throw new Error('Failed to update user profile');
  }
}

export async function resendUserInvite(email: string): Promise<boolean> {
  try {
    await sendPasswordResetEmail(auth, email, { url: `${window.location.origin}/auth`, handleCodeInApp: true });
    return true;
  } catch (error) {
    console.error('Error resending invite:', error);
    throw new Error('Failed to resend invitation');
  }
}

export async function deleteWebUser(uid: string): Promise<boolean> {
  try {
    // Delete from both collections to handle legacy data
    const sellerDoc = doc(db, SELLER_COLLECTION, uid);
    await deleteDoc(sellerDoc);
    
    try {
      const webUserDoc = doc(db, WEB_USERS_COLLECTION, uid);
      await deleteDoc(webUserDoc);
    } catch (legacyError) {
      console.warn('Legacy collection delete failed (may not exist):', legacyError);
    }
    
    return true;
  } catch (error) {
    console.error('Error deleting user:', error);
    throw new Error('Failed to delete user');
  }
}
