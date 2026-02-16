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
import { createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, getAuth } from 'firebase/auth';
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// Create a secondary Firebase app instance for user creation
// This prevents logging out the current admin when creating new users
let secondaryApp: any = null;
let secondaryAuth: any = null;

function getSecondaryAuth() {
  if (!secondaryAuth) {
    try {
      // Initialize secondary app with same config
      secondaryApp = initializeApp({
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: import.meta.env.VITE_FIREBASE_APP_ID,
      }, 'Secondary');
      secondaryAuth = getAuth(secondaryApp);
    } catch (error) {
      console.error('Failed to initialize secondary auth:', error);
      // Fallback to primary auth if secondary fails
      secondaryAuth = auth;
    }
  }
  return secondaryAuth;
}

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
    // Use secondary auth to prevent logging out the current admin
    const secondaryAuth = getSecondaryAuth();
    const tempPassword = `Temp${Math.random().toString(36).slice(-8)}#${Math.floor(Math.random() * 100)}`;
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, tempPassword);
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
      // Send password reset email so user can set their own password
      await sendPasswordResetEmail(auth, email, { 
        url: `${window.location.origin}/auth`, 
        handleCodeInApp: true 
      });
    } catch (emailError) {
      console.warn('Failed to send password reset email:', emailError);
    }

    // Sign out the newly created user from secondary auth
    try {
      await secondaryAuth.signOut();
    } catch (signOutError) {
      console.warn('Failed to sign out secondary user:', signOutError);
    }

    return { uid: user.uid, ...userData } as WebUserProfile;
  } catch (error) {
    console.error('Error creating user:', error);
    throw error;
  }
}

export async function createSellerSubAccount(parentSellerId: string, email: string, name: string, permissions: WebUserPermissions): Promise<WebUserProfile> {
  try {
    // Use secondary auth to prevent logging out the current user
    const secondaryAuth = getSecondaryAuth();
    const tempPassword = `Temp${Math.random().toString(36).slice(-8)}#${Math.floor(Math.random() * 100)}`;
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, tempPassword);
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
      // Send password reset email so user can set their own password
      await sendPasswordResetEmail(auth, email, { 
        url: `${window.location.origin}/auth`, 
        handleCodeInApp: true 
      });
    } catch (emailError) {
      console.warn('Failed to send password reset email:', emailError);
    }

    // Sign out the newly created user from secondary auth
    try {
      const secondaryAuth = getSecondaryAuth();
      await secondaryAuth.signOut();
    } catch (signOutError) {
      console.warn('Failed to sign out secondary user:', signOutError);
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
    // Send both email verification and password reset
    // Email verification confirms email ownership
    // Password reset allows them to set their password
    await sendPasswordResetEmail(auth, email, { 
      url: `${window.location.origin}/auth`, 
      handleCodeInApp: true 
    });
    return true;
  } catch (error) {
    console.error('Error resending invite:', error);
    throw new Error('Failed to resend invitation');
  }
}

export async function deleteWebUser(uid: string): Promise<boolean> {
  try {
    // Get user data before deleting to check remembered email
    let userEmail: string | null = null;
    try {
      const sellerDoc = await getDoc(doc(db, SELLER_COLLECTION, uid));
      if (sellerDoc.exists()) {
        userEmail = sellerDoc.data()?.email || null;
      } else {
        const legacyDoc = await getDoc(doc(db, WEB_USERS_COLLECTION, uid));
        if (legacyDoc.exists()) {
          userEmail = legacyDoc.data()?.email || null;
        }
      }
    } catch (error) {
      console.warn('Could not fetch user email before deletion:', error);
    }
    
    // Delete from both Firestore collections first
    const sellerDoc = doc(db, SELLER_COLLECTION, uid);
    await deleteDoc(sellerDoc);
    
    try {
      const webUserDoc = doc(db, WEB_USERS_COLLECTION, uid);
      await deleteDoc(webUserDoc);
    } catch (legacyError) {
      console.warn('Legacy collection delete failed (may not exist):', legacyError);
    }
    
    // Clear from localStorage if this was the remembered email
    if (userEmail) {
      const rememberedEmail = localStorage.getItem('dentpal_remember_email');
      if (rememberedEmail === userEmail) {
        localStorage.removeItem('dentpal_remember_email');
        console.log('Cleared remembered email for deleted user');
      }
    }
    
    // Now delete from Firebase Authentication via Cloud Function
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('No authenticated user');
      }
      
      const idToken = await currentUser.getIdToken();
      const functionUrl = import.meta.env.VITE_FIREBASE_FUNCTION_URL || 
                         `https://asia-southeast1-${import.meta.env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net`;
      
      const response = await fetch(`${functionUrl}/deleteUserAccount`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ uid }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to delete user from Authentication:', errorData);
        // Don't throw here - Firestore data is already deleted
        // This prevents the UI from showing an error when auth deletion fails
      }
    } catch (authError) {
      console.error('Error deleting user from Authentication:', authError);
      // Don't throw - Firestore data is already deleted
    }
    
    return true;
  } catch (error) {
    console.error('Error deleting user:', error);
    throw new Error('Failed to delete user');
  }
}
