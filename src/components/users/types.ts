export interface UserAddress {
  city?: string;
  cityName?: string;
  addressLine1?: string;
  addressLine2?: string;
  state?: string; // "Metro Manila", etc. - this is the province field in Firebase
  province?: string;
  provinceCode?: string;
  country?: string;
  postalCode?: string;
  isDefault?: boolean;
  [key: string]: any;
}

export interface User {
  id: string;
  accountId: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  email: string;
  contactNumber: string;
  shippingAddresses: UserAddress[]; // Loaded from Firebase User > Address subcollection
  addresses?: UserAddress[]; // Alternative field name for addresses
  specialty: string[]; // Array of specialties from Firebase User > specialty
  totalTransactions: number;
  totalSpent: number;
  registrationDate: string;
  lastActivity: string;
  createdAt?: any; // Firestore Timestamp from Firebase User > createdAt
  status: 'active' | 'inactive' | 'pending' | 'suspended';
  rewardPoints: number;
  membershipLevel: 'bronze' | 'silver' | 'gold' | 'platinum';
  profileComplete: boolean;
  // Seller request/approval workflow separate from account status
  sellerApprovalStatus: 'pending' | 'approved' | 'not_requested' | 'rejected';
}

export type Filters = { search: string; province: string; specialty: string; status: string };