export type WebUserRole = 'admin' | 'seller';

export type WebUserPermissions = {
  dashboard: boolean;
  profile: boolean; // New: Allow access to Profile tab
  bookings: boolean;
  confirmation: boolean;
  withdrawal: boolean;
  access: boolean;
  images: boolean;
  users: boolean;
  inventory: boolean;
  'seller-orders': boolean;
  'add-product': boolean; // New: Allow access to Add Product/Manage Product
  'product-qc': boolean; // New: Admin Pending QC tab
  reports: boolean; // New: Reports visibility
  policies: boolean; // NEW: Terms & Policies tab
  warranty: boolean; // NEW: Admin Warranty tab
  categories?: boolean; // NEW: Admin Categories tab (optional, admin-only)
  chats: boolean; // NEW: Chat/messaging feature
  notifications: boolean; // NEW: Notifications feature
  vouchers: boolean; // NEW: Vouchers tab
};

export interface WebUserProfile {
  uid: string;
  email: string;
  name: string; // display name / username
  role: WebUserRole;
  permissions: WebUserPermissions;
  isActive: boolean;
  createdAt: number; // epoch millis
  lastLogin?: number; // epoch millis
  // NEW: seller sub-account flags
  isSubAccount?: boolean;
  parentId?: string; // uid of owning seller (only if isSubAccount)
}
