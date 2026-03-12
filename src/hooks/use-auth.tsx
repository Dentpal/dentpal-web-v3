import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { WebUserPermissions, WebUserRole, WebUserProfile } from '@/types/webUser';

/**
 * Permission map defining what each role can do by default
 * These align with the database permission names
 */
export const PERMISSIONS_BY_ROLE: Record<WebUserRole, WebUserPermissions> = {
  admin: {
    dashboard: true,
    profile: true,
    bookings: true,
    confirmation: true,
    withdrawal: true,
    access: true,
    images: true,
    users: true,
    inventory: true,
    'seller-orders': true,
    'add-product': true,
    'product-qc': true,
    reports: true,
    policies: true,
    // NEW: warranty tab default for admin
    warranty: true,
    // NEW: categories manager (admin only)
    categories: true,
    // NEW: chats enabled for admin
    chats: true,
    // NEW: notifications enabled for admin
    notifications: true,
  },
  seller: {
    dashboard: true,
    profile: true,
    bookings: true,
    confirmation: false,
    withdrawal: true,
    access: false,
    images: false,
    users: false,
    inventory: true,
    'seller-orders': true,
    'add-product': true,
    'product-qc': false,
    reports: true,
    policies: false,
    // NEW: warranty hidden for sellers
    warranty: false,
    // NEW: categories hidden for sellers
    categories: false,
    // NEW: chats enabled by default for sellers
    chats: true,
    // NEW: notifications enabled by default for sellers
    notifications: true,
  }
};

export type Permission = keyof WebUserPermissions;

interface UseAuthResult {
  role: WebUserRole | null;
  permissions: WebUserPermissions | null;
  uid: string | null;
  isAdmin: boolean;
  isSeller: boolean;
  isSubAccount: boolean;
  parentId?: string | null;
  hasPermission: (permission: Permission) => boolean;
  loading: boolean;
  error: string | null;
}

export function useAuth(): UseAuthResult {
  const [role, setRole] = useState<WebUserRole | null>(null);
  const [permissions, setPermissions] = useState<WebUserPermissions | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [isSubAccount, setIsSubAccount] = useState(false);
  const [parentId, setParentId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Helper: mask sub perms by parent perms to enforce a hard ceiling
  const maskPerms = (child: Partial<WebUserPermissions> | null | undefined, parent: Partial<WebUserPermissions> | null | undefined): WebUserPermissions => {
    const base = PERMISSIONS_BY_ROLE['seller'];
    const c = child || {};
    const p = parent || {};
    const out: any = {};
    (Object.keys(base) as Array<keyof WebUserPermissions>).forEach((k) => {
      out[k] = Boolean((c as any)[k] && (p as any)[k]);
    });
    return out as WebUserPermissions;
  };

  // Helper: normalize a permission map to full key set with default false
  const normalizePermsFalse = (src: Partial<WebUserPermissions> | null | undefined): WebUserPermissions => {
    const base = PERMISSIONS_BY_ROLE['seller'];
    const s: any = { ...(src || {}) };
    // Backward compat: map legacy 'chat' key to 'chats'
    if (s.chats === undefined && s.chat !== undefined) {
      s.chats = s.chat;
    }
    const out: any = {};
    (Object.keys(base) as Array<keyof WebUserPermissions>).forEach((k) => {
      out[k] = Boolean((s as any)[k]);
    });
    return out as WebUserPermissions;
  };

  // Helper: normalize parent permissions using role defaults for missing keys
  // This ensures newer permissions (like chats) that parents never explicitly saved
  // still get their role-default value instead of false
  const normalizeParentPerms = (src: Partial<WebUserPermissions> | null | undefined, role: WebUserRole = 'seller'): WebUserPermissions => {
    const defaults = PERMISSIONS_BY_ROLE[role];
    const s: any = { ...(src || {}) };
    // Backward compat: map legacy 'chat' key to 'chats'
    if (s.chats === undefined && s.chat !== undefined) {
      s.chats = s.chat;
    }
    const out: any = {};
    (Object.keys(defaults) as Array<keyof WebUserPermissions>).forEach((k) => {
      // If the key exists in stored permissions, use it; otherwise use the role default
      out[k] = (k in s) ? Boolean((s as any)[k]) : Boolean((defaults as any)[k]);
    });
    return out as WebUserPermissions;
  };

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      try {
        if (!user) {
          setRole(null);
          setPermissions(null);
          setUid(null);
          setIsSubAccount(false);
          setParentId(null);
          setLoading(false);
          return;
        }

        setUid(user.uid);

        // Prefer Seller collection; fallback to legacy web_users
        let userData: Partial<WebUserProfile> | null = null;
        let snap = await getDoc(doc(db, 'Seller', user.uid));
        if (snap.exists()) userData = snap.data() as any;
        if (!userData) {
          snap = await getDoc(doc(db, 'web_users', user.uid));
          if (snap.exists()) userData = snap.data() as any;
        }

        if (userData) {
          // If user is logging in and isActive is false, activate them automatically
          // This happens when they successfully log in after receiving their invite email
          if (userData.isActive === false) {
            try {
              // Update both Seller and legacy collections
              await updateDoc(doc(db, 'Seller', user.uid), { 
                isActive: true, 
                lastLogin: serverTimestamp() 
              });
              try {
                await updateDoc(doc(db, 'web_users', user.uid), { 
                  isActive: true, 
                  lastLogin: serverTimestamp() 
                });
              } catch {}
              userData.isActive = true;
            } catch (err) {
              console.error('Failed to activate user:', err);
            }
          }

          if (userData.isActive === false) {
            setRole(null);
            setPermissions(null);
            setError('Your account is pending activation. Please try logging in again.');
          } else {
            const roleVal = (userData.role as WebUserRole) || 'seller';
            setRole(roleVal);
            const isSub = !!userData.isSubAccount;
            const parent = (userData.parentId as string) || null;
            setIsSubAccount(isSub);
            setParentId(parent);

            let perms = (userData.permissions as WebUserPermissions) || null;
            if (isSub && parent) {
              try {
                const parentSnap = await getDoc(doc(db, 'Seller', parent));
                const parentPerms = (parentSnap.exists() ? (parentSnap.data() as any)?.permissions : null) as Partial<WebUserPermissions> | null;
                // Prefer members permissions by email
                let effectiveChild: Partial<WebUserPermissions> | null | undefined = perms || {};
                try {
                  const email = (userData as any)?.email;
                  if (email) {
                    const q = query(collection(db, 'Seller', parent, 'members'), where('email', '==', email));
                    const snap = await getDocs(q);
                    if (!snap.empty) {
                      const mPerms = (snap.docs[0].data() as any)?.permissions as Partial<WebUserPermissions> | null;
                      if (mPerms) effectiveChild = mPerms;
                    }
                  }
                } catch {}
                // Normalize child to explicit booleans, then apply ceiling
                // Parent uses role-defaults for missing keys so newer permissions (like chats)
                // don't get blocked just because the parent never explicitly saved them
                perms = maskPerms(normalizePermsFalse(effectiveChild), normalizeParentPerms(parentPerms, 'seller'));
              } catch {
                // If parent fetch fails, still normalize child to avoid default fallbacks
                perms = normalizePermsFalse(perms || {});
              }
            } else {
              // Primary accounts: merge role defaults with stored permissions
              // Role defaults provide the base; stored permissions override only if explicitly set
              // This ensures new permissions added to role defaults are available
              const roleDefaults = PERMISSIONS_BY_ROLE[roleVal];
              if (perms) {
                const merged: WebUserPermissions = { ...roleDefaults };
                // Only override with stored value if it exists in stored perms
                (Object.keys(roleDefaults) as Array<keyof WebUserPermissions>).forEach((key) => {
                  if (key in (perms as any)) {
                    (merged as any)[key] = (perms as any)[key];
                  }
                });
                perms = merged;
              } else {
                perms = roleDefaults;
              }
            }
            setPermissions(perms);
          }
        } else {
          console.warn(`No user document found for uid ${user.uid}`);
          setRole(null);
          setPermissions(null);
        }

        setLoading(false);
      } catch (err) {
        console.error('Error in auth hook:', err);
        setError('Failed to load user permissions');
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  /**
   * Checks if the current user has the specified permission
   */
  const hasPermission = (permission: Permission): boolean => {
    if (!role) return false;
    if (isSubAccount && (permission === 'access' || permission === 'users')) return false;
    
    // For sub-accounts, check permissions object explicitly
    if (isSubAccount) {
      if (!permissions) return false;
      // Use bracket notation to access the permission
      return Boolean((permissions as any)[permission]);
    }
    
    // For regular users, check permissions first, then fallback to role defaults
    if (permissions && permission in permissions) {
      return Boolean((permissions as any)[permission]);
    }
    
    return PERMISSIONS_BY_ROLE[role][permission] || false;
  };

  return {
    role,
    permissions,
    uid,
    isAdmin: role === 'admin',
    isSeller: role === 'seller',
    isSubAccount,
    parentId,
    hasPermission,
    loading,
    error
  };
}
