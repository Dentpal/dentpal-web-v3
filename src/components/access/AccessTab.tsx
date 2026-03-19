import { useState, useEffect } from "react";
import { 
  Users, 
  UserPlus, 
  Settings, 
  Search, 
  Filter, 
  Download, 
  Edit3, 
  Trash2, 
  Shield, 
  Key, 
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Lock,
  Unlock,
  FileText,
  FileSpreadsheet,
  File,
  ChevronDown,
  ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
// Add dropdown UI for export actions
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/dialog';
// Replace backend partner provisioning with direct web user service (Firestore + password email)
import { createWebUser, updateWebUserAccess, setWebUserStatus, getWebUsers, resendUserInvite, createSellerSubAccount, deleteWebUser } from '@/services/webUserService';
import SellersService from '@/services/sellers';
import type { WebUserProfile } from '@/types/webUser';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
// NEW: missing imports for export utilities and assets
import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx';
import dentpalLogo from '@/assets/dentpal_logo.png';

// Helper to normalize Firestore Timestamp/number/string to epoch millis
function normalizeTimestamp(value: any): number | null {
  try {
    if (!value) return null;
    if (typeof value === 'number') {
      // if seconds, convert to ms
      return value < 1e12 ? value * 1000 : value;
    }
    if (typeof value === 'string') {
      const ms = Date.parse(value);
      return isNaN(ms) ? null : ms;
    }
    if (value instanceof Date) {
      return value.getTime();
    }
    if (typeof value.toDate === 'function') {
      // Firestore Timestamp
      return value.toDate().getTime();
    }
    if (typeof value.seconds === 'number') {
      return value.seconds * 1000;
    }
  } catch {}
  return null;
}

// Default permissions fallback by role
  const defaultPermissionsByRole = (role: 'admin' | 'seller') => ({
    dashboard: true,
    profile: true,
    bookings: true,
    confirmation: role === 'admin',
    withdrawal: role === 'admin',
    access: true, // CHANGED: sellers also have access (sub-account creation)
    images: role === 'admin',
    users: role === 'admin',
    inventory: true,
    'seller-orders': true,
    'add-product': true,
    'product-qc': role === 'admin',
    categories: role === 'admin',
    policies: role === 'admin',
    chats: role === 'admin' || role === 'seller',
  });

  // Normalize any loaded permissions to include all keys for the role
  const ensurePermissions = (role: 'admin' | 'seller', perms: Partial<User['permissions']> | undefined | null): User['permissions'] => {
    return { ...defaultPermissionsByRole(role), ...(perms || {}) } as User['permissions'];
  };

  // Helper to get display label for permissions
  const getPermissionLabel = (key: string): string => {
    const labelMap: Record<string, string> = {
      'dashboard': 'Sales',
      'profile': 'Profile',
      'bookings': 'Booking',
      'confirmation': 'Confirmation',
      'withdrawal': 'Withdrawal',
      'access': 'Access',
      'images': 'Images',
      'users': 'Users',
      'inventory': 'Inventory',
      'seller-orders': 'Orders',
      'add-product': 'Items',
      'policies': 'Policies',
      'chats': 'Chat'
    };
    return labelMap[key] || key.replace('-', ' ');
  };

interface User {
  id: string;
  username: string;
  email: string;
  password?: string;
  role: 'admin' | 'seller';
  status: 'active' | 'inactive' | 'pending';
  permissions: {
    dashboard: boolean;
    profile: boolean;
    bookings: boolean;
    confirmation: boolean;
    withdrawal: boolean;
    access: boolean;
    images: boolean;
    users: boolean;
    inventory: boolean;
    'seller-orders': boolean;
    'add-product': boolean;
    policies: boolean;
    chats: boolean;
  };
  Platform_fee_percentage?: number; // Platform fee percentage (default 8.88%)
  lastLogin?: string;
  createdAt: string;
  isSubAccount?: boolean; // Whether this is a sub-account
  parentId?: string; // Parent account ID for sub-accounts
}

interface AccessTabProps {
  loading?: boolean;
  error?: string | null;
  setError?: (error: string | null) => void;
  onTabChange?: (tab: string) => void;
  onEditUser?: (user: User) => void; // optional callback when clicking Edit
}

const AccessTab = ({ loading = false, error, setError, onTabChange, onEditUser }: AccessTabProps) => {
  const [activeSection, setActiveSection] = useState<'add' | 'admin' | 'seller'>('add');
  const [users, setUsers] = useState<User[]>([
    {
      id: "1",
      username: "admin001",
      email: "admin@dentpal.com",
      role: "admin",
      status: "active",
      permissions: {
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
        policies: true,
        chats: true,
      },
      lastLogin: "2024-09-09T10:30:00Z",
      createdAt: "2024-01-15T00:00:00Z"
    },
    {
      id: "2",
      username: "seller001",
      email: "seller1@dentpal.com",
      role: "seller",
      status: "active",
      permissions: {
        dashboard: true,
        profile: true,
        bookings: true,
        confirmation: false,
        withdrawal: false,
        access: false,
        images: true,
        users: false,
        inventory: false,
        'seller-orders': true,
        'add-product': true,
        policies: false,
        chats: true,
      },
      lastLogin: "2024-09-09T09:15:00Z",
      createdAt: "2024-02-20T00:00:00Z"
    },
    {
      id: "3",
      username: "seller002",
      email: "seller2@dentpal.com",
      role: "seller",
      status: "pending",
      permissions: {
        dashboard: true,
        profile: true,
        bookings: true,
        confirmation: false,
        withdrawal: false,
        access: false,
        images: false,
        users: false,
        inventory: false,
        'seller-orders': true,
        'add-product': true,
        policies: false,
        chats: true,
      },
      createdAt: "2024-09-08T00:00:00Z"
    }
  ]);

  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<{id: string; username: string} | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const [successUserData, setSuccessUserData] = useState<{username: string; email: string} | null>(null);
  const [addUserLoading, setAddUserLoading] = useState(false);
  
  // Form states
  const [newUser, setNewUser] = useState<Partial<User>>({
    username: "",
    email: "",
    role: "seller",
    status: "pending",
    permissions: defaultPermissionsByRole('seller')
  });

  const { toast } = useToast();

  // Vendor Enrollment wizard state (re-added)
  const [vendorWizardOpen, setVendorWizardOpen] = useState(false);
  const [vendorSellerId, setVendorSellerId] = useState<string | null>(null);
  const [vendorStep, setVendorStep] = useState<'upload' | 'company'>('upload');
  const [vendorForm, setVendorForm] = useState({
    tin: '',
    birFile: null as File | null,
    bir: null as null | { url: string; path: string },
    company: { name: '', address: { line1: '', line2: '', city: '', province: '', zip: '' } },
    contacts: { name: '', email: '', phone: '' },
    requirements: { birSubmitted: false, profileCompleted: false },
  });

  const submitBirAndNext = async () => {
    try {
      if (!vendorSellerId) return;
      let bir = vendorForm.bir;
      if (vendorForm.birFile) {
        const res = await SellersService.uploadImage(vendorSellerId, vendorForm.birFile, 'SellerImages');
        bir = res as any;
      }
      await SellersService.saveVendorProfile(vendorSellerId, {
        tin: vendorForm.tin,
        bir: bir || null,
        requirements: { ...vendorForm.requirements, birSubmitted: !!bir }
      } as any);
      setVendorForm(prev => ({ ...prev, bir: bir || null, requirements: { ...prev.requirements, birSubmitted: !!bir } }));
      setVendorStep('company');
      toast({ title: 'BIR uploaded', description: 'Vendor TIN and BIR saved.' });
    } catch (e: any) {
      setError?.(e.message || 'Failed to upload BIR');
    }
  };

  const submitCompanyAndFinish = async () => {
    try {
      if (!vendorSellerId) return;
      await SellersService.saveVendorProfile(vendorSellerId, {
        tin: vendorForm.tin,
        bir: vendorForm.bir || null,
        company: vendorForm.company,
        contacts: vendorForm.contacts,
        requirements: { ...vendorForm.requirements, profileCompleted: true },
      } as any);
      setVendorWizardOpen(false);
      setVendorSellerId(null);
      toast({ title: 'Vendor profile saved', description: 'Company and contact details stored.' });
      try { window.dispatchEvent(new CustomEvent('dentpal:refresh-profile')); } catch {}
    } catch (e: any) {
      setError?.(e.message || 'Failed to save vendor profile');
    }
  };

  // Auth context
  const { isAdmin, isSeller, isSubAccount, uid, permissions: sellerPermsRaw } = useAuth();
  const sellerPerms = ensurePermissions('seller', (sellerPermsRaw as any));

  // --- Seller Sub-accounts state and helpers (declare BEFORE any early returns) ---
  // Preset bundles (will be masked by seller's own permissions)
  const roleBundles: Record<'finance' | 'ops' | 'custom', User['permissions']> = {
    finance: {
      dashboard: true,
      profile: true,
      bookings: false,
      confirmation: false,
      withdrawal: true,
      access: false,
      images: false,
      users: false,
      inventory: false,
      'seller-orders': false,
      'add-product': false,
      policies: false,
      chats: false,
    },
    ops: {
      dashboard: true,
      profile: true,
      bookings: false,
      confirmation: false,
      withdrawal: false,
      access: false,
      images: false,
      users: false,
      inventory: true,
      'seller-orders': true,
      'add-product': true,
      policies: false,
      chats: false,
    },
    custom: {
      dashboard: true,
      profile: true,
      bookings: false,
      confirmation: false,
      withdrawal: false,
      access: false,
      images: false,
      users: false,
      inventory: false,
      'seller-orders': false,
      'add-product': false,
      policies: false,
      chats: false,
    }
  };

  // Mask a permission set by the seller's own permissions (never exceed parent)
  // Also excludes 'profile' as sub-accounts should never have profile access
  const maskPerms = (perms: User['permissions'], owner: User['permissions']): User['permissions'] => {
    const out: any = {};
    (Object.keys(perms) as Array<keyof User['permissions']>).forEach((k) => {
      // Sub-accounts should never have profile access
      if (k === 'profile') {
        out[k] = false;
      } else {
        out[k] = Boolean(perms[k] && owner[k]);
      }
    });
    return out as User['permissions'];
  };

  // Sub-account creation UI state
  const [subOpen, setSubOpen] = useState(false);
  const [subName, setSubName] = useState('');
  const [subEmail, setSubEmail] = useState('');
  const [subBundle, setSubBundle] = useState<'finance' | 'ops' | 'custom'>('ops');
  const [subPerms, setSubPerms] = useState<User['permissions']>(maskPerms(roleBundles[subBundle], sellerPerms));
  useEffect(() => { setSubPerms(maskPerms(roleBundles[subBundle], sellerPerms)); }, [subBundle, sellerPermsRaw]);
  const [subLoading, setSubLoading] = useState(false);
  
  // Success dialog state for sub-account creation
  const [subSuccessOpen, setSubSuccessOpen] = useState(false);
  const [invitedSubName, setInvitedSubName] = useState('');
  const [invitedSubEmail, setInvitedSubEmail] = useState('');

  // Allow seller (not admin/sub) to create sub-accounts
  const canCreateSub = isSeller && !isAdmin && !isSubAccount;

  // Create sub-account invite and optionally auth user
  const handleCreateSub = async () => {
    if (!canCreateSub) return;
    if (!subName || !subEmail) { setError?.('Name and email are required'); return; }
    
    // Validate email with TLD check
    const emailValidation = validateEmail(subEmail);
    if (!emailValidation.isValid) {
      setError?.(emailValidation.error || "Invalid email address");
      toast({ 
        title: 'Invalid Email', 
        description: emailValidation.error || "Please enter a valid email address",
        variant: 'destructive'
      });
      return;
    }
    
    try {
      setSubLoading(true);
      const finalPerms = maskPerms(subPerms, sellerPerms);
      // Save invite in Seller/<uid>/members
      await SellersService.createSubAccountInvite(uid!, subName, subEmail, finalPerms as any, uid!);
      // Try to create Auth user and link invite
      try {
        const created = await createSellerSubAccount(uid!, subEmail, subName, finalPerms as any);
        setUsers((prev: any) => (Array.isArray(prev) ? [...prev, {
          id: created.uid,
          username: created.name,
          email: created.email,
          role: 'seller',
          status: 'active',
          permissions: created.permissions as any,
          createdAt: new Date().toISOString(),
        }] : prev));
      } catch (authErr) {
        console.warn('Auth creation failed; invite record saved only:', authErr);
      }
      setSubOpen(false);
      
      // Store invited user details and show success dialog
      setInvitedSubName(subName);
      setInvitedSubEmail(subEmail);
      setSubSuccessOpen(true);
      
      // Reset form
      setSubName(''); setSubEmail(''); setSubBundle('ops');
    } catch (e: any) {
      setError?.(e.message || 'Failed to create sub-account');
      toast({ 
        title: 'Error', 
        description: e.message || 'Failed to create sub-account',
        variant: 'destructive'
      });
    } finally { setSubLoading(false); }
  };

  // NEW: sub-accounts list UI state
  const [manageOpen, setManageOpen] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [subAccountToDelete, setSubAccountToDelete] = useState<any | null>(null);
  const [sendingInvite, setSendingInvite] = useState(false);

  // Platform fee edit state
  const [platformFeeModalOpen, setPlatformFeeModalOpen] = useState(false);
  const [editingPlatformFee, setEditingPlatformFee] = useState<{ id: string; username: string; currentFee: number } | null>(null);
  const [platformFeeValue, setPlatformFeeValue] = useState<string>('8.88');
  const [platformFeeSaving, setPlatformFeeSaving] = useState(false);

  // Admin (grouped seller/sub-accounts) hooks declared before any early return to keep hooks order stable
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  type SellerWithSubs = User & { subAccounts?: Array<{ id: string; name?: string; email: string; permissions?: any; status?: string }> };
  const [sellerWithSubs, setSellerWithSubs] = useState<Record<string, SellerWithSubs>>({});

  const fetchSellerSubs = async (sellerUser: User): Promise<SellerWithSubs> => {
    try {
      const subs = await SellersService.listSubAccounts(sellerUser.id).catch(() => []);
      return { ...(sellerUser as SellerWithSubs), subAccounts: subs as any[] };
    } catch {
      return { ...(sellerUser as SellerWithSubs), subAccounts: [] };
    }
  };

  const toggleExpand = async (seller: User) => {
    setExpanded(prev => ({ ...prev, [seller.id]: !prev[seller.id] }));
    if (!sellerWithSubs[seller.id]) {
      const data = await fetchSellerSubs(seller);
      setSellerWithSubs(prev => ({ ...prev, [seller.id]: data }));
    }
  };

  const loadMembers = async () => {
    if (!uid) return;
    try {
      setMembersLoading(true);
      const items = await SellersService.listSubAccounts(uid);
      setMembers(items as any[]);
    } catch (e) {
      console.error('Failed to load sub-accounts', e);
    } finally { setMembersLoading(false); }
  };

  const handleUpdateMember = async () => {
    if (!uid || !editing) return;
    try {
      await SellersService.updateSubAccount(uid, editing.id, { name: editing.name, permissions: maskPerms(editing.permissions || {}, sellerPerms) });
      toast({ title: 'Updated', description: 'Sub-account updated successfully.' });
      await loadMembers();
      setEditing(null);
    } catch (e: any) {
      toast({ title: 'Update failed', description: e.message || 'Please try again', variant: 'destructive' });
    }
  };

  const handleDeleteMember = async (m: any) => {
    if (!uid) return;
    try {
      await SellersService.deleteSubAccount(uid, m.id);
      toast({ title: 'Deleted', description: `${m.email} removed.` });
      await loadMembers();
      setSubAccountToDelete(null);
      setEditing(null);
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e.message || 'Please try again', variant: 'destructive' });
    }
  };

  const handleSendInvite = async (email: string, action: 'reinvite' | 'reset') => {
    if (sendingInvite) return;
    try {
      setSendingInvite(true);
      await resendUserInvite(email);
      const title = action === 'reinvite' ? 'Invite sent' : 'Password reset sent';
      const description = action === 'reinvite' 
        ? `Invitation email sent to ${email}`
        : `Password reset email sent to ${email}`;
      toast({ title, description });
    } catch (e: any) {
      const title = action === 'reinvite' ? 'Failed to send invite' : 'Failed to send reset';
      toast({ title, description: e.message || 'Please try again', variant: 'destructive' });
    } finally {
      setSendingInvite(false);
    }
  };

  // Helper to refresh user list from Firestore
  const refreshUserList = async () => {
    try {
      const sellers = await SellersService.list();
      const webUsers = sellers.length ? sellers.map(s => ({
        uid: s.id,
        email: s.email || '',
        name: s.name || '',
        role: (s.role as any) || 'seller',
        isActive: typeof s.isActive === 'boolean' ? s.isActive : true,
        permissions: s.permissions as any,
        createdAt: s.createdAt || Date.now(),
        Platform_fee_percentage: s.Platform_fee_percentage,
        isSubAccount: (s as any).isSubAccount,
        parentId: (s as any).parentId,
      })) : await getWebUsers();
      const mapped: User[] = webUsers.map((u: any) => {
        const createdAtMs = normalizeTimestamp((u as any).createdAt);
        const lastLoginMs = normalizeTimestamp((u as any).lastLogin);
        const perms = ensurePermissions(u.role, (u as any).permissions);
        return {
          id: u.uid,
          username: u.name,
          email: u.email,
          role: u.role,
          status: (u.isActive ? 'active' : 'inactive') as 'active' | 'inactive' | 'pending',
          permissions: perms,
          Platform_fee_percentage: u.Platform_fee_percentage,
          lastLogin: lastLoginMs ? new Date(lastLoginMs).toISOString() : undefined,
          createdAt: createdAtMs ? new Date(createdAtMs).toISOString() : new Date().toISOString(),
          isSubAccount: u.isSubAccount,
          parentId: u.parentId,
        };
      });
      setUsers(mapped);
    } catch (e: any) {
      console.error('Failed to refresh user list:', e);
    }
  };

  // Platform fee handlers
  const handleOpenPlatformFeeModal = async (seller: User) => {
    try {
      // Fetch the seller profile to get current platform fee
      const sellerProfile = await SellersService.get(seller.id);
      const currentFee = sellerProfile?.Platform_fee_percentage ?? 8.88;
      setEditingPlatformFee({ id: seller.id, username: seller.username, currentFee });
      setPlatformFeeValue(currentFee.toString());
      setPlatformFeeModalOpen(true);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message || 'Failed to load platform fee', variant: 'destructive' });
    }
  };

  const handleSavePlatformFee = async () => {
    if (!editingPlatformFee) return;
    
    const feeValue = parseFloat(platformFeeValue);
    if (isNaN(feeValue) || feeValue < 0 || feeValue > 100) {
      toast({ title: 'Invalid value', description: 'Please enter a valid percentage between 0 and 100', variant: 'destructive' });
      return;
    }

    try {
      setPlatformFeeSaving(true);
      await SellersService.updatePlatformFee(editingPlatformFee.id, feeValue);
      toast({ title: 'Success', description: `Platform fee updated to ${feeValue}% for ${editingPlatformFee.username}` });
      setPlatformFeeModalOpen(false);
      setEditingPlatformFee(null);
      // Refresh the user list to show updated data
      await refreshUserList();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message || 'Failed to update platform fee', variant: 'destructive' });
    } finally {
      setPlatformFeeSaving(false);
    }
  };

  // Load users from Firestore on mount
  useEffect(() => {
    const load = async () => {
      try {
        // Prefer new Seller collection; fall back to web_users service for non-migrated envs
        const sellers = await SellersService.list();
        const webUsers = sellers.length ? sellers.map(s => ({
          uid: s.id,
          email: s.email || '',
          name: s.name || '',
          role: (s.role as any) || 'seller',
          isActive: typeof s.isActive === 'boolean' ? s.isActive : true,
          permissions: s.permissions as any,
          createdAt: s.createdAt || Date.now(),
          Platform_fee_percentage: s.Platform_fee_percentage,
          isSubAccount: (s as any).isSubAccount,
          parentId: (s as any).parentId,
        })) : await getWebUsers();
         const mapped: User[] = webUsers.map((u: any) => {
            const createdAtMs = normalizeTimestamp((u as any).createdAt);
            const lastLoginMs = normalizeTimestamp((u as any).lastLogin);
           const perms = ensurePermissions(u.role, (u as any).permissions);
            return {
              id: u.uid,
              username: u.name,
              email: u.email,
              role: u.role,
              status: (u.isActive ? 'active' : 'inactive') as 'active' | 'inactive' | 'pending',
              permissions: perms,
              Platform_fee_percentage: u.Platform_fee_percentage,
              lastLogin: lastLoginMs ? new Date(lastLoginMs).toISOString() : undefined,
              createdAt: createdAtMs ? new Date(createdAtMs).toISOString() : new Date().toISOString(),
              isSubAccount: u.isSubAccount,
              parentId: u.parentId,
            };
          });
         setUsers(mapped);
      } catch (e: any) {
        console.error('Failed to load users:', e);
        setError?.(e.message || 'Failed to load users');
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load sub-accounts for seller view
  useEffect(() => {
    if (canCreateSub) {
      loadMembers();
    }
  }, [canCreateSub, uid]);

  // Email validation function with proper TLD checking
  const validateEmail = (email: string): { isValid: boolean; error?: string } => {
    if (!email) {
      return { isValid: false, error: "Email is required" };
    }

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { isValid: false, error: "Please enter a valid email address" };
    }

    // Extract TLD (Top Level Domain)
    const tldMatch = email.match(/\.([a-zA-Z]{2,})$/);
    if (!tldMatch) {
      return { isValid: false, error: "Invalid email format" };
    }

    const tld = tldMatch[1].toLowerCase();

    // List of common and legitimate TLDs
    const validTLDs = [
      // Generic TLDs
      'com', 'net', 'org', 'edu', 'gov', 'mil', 'int', 'info', 'biz', 'name', 'pro',
      // New generic TLDs
      'email', 'online', 'site', 'tech', 'store', 'app', 'dev', 'web', 'cloud',
      // Country code TLDs (common ones)
      'ph', 'us', 'uk', 'ca', 'au', 'de', 'fr', 'jp', 'cn', 'in', 'br', 'mx', 'es', 'it',
      'nl', 'se', 'no', 'dk', 'fi', 'be', 'ch', 'at', 'nz', 'sg', 'hk', 'tw', 'kr', 'th',
      'my', 'id', 'vn', 'ae', 'sa', 'za', 'eg', 'ng', 'ke', 'ru', 'pl', 'cz', 'hu', 'ro',
      // Other common TLDs
      'io', 'co', 'me', 'tv', 'cc', 'ws', 'mobi', 'tel', 'asia', 'jobs', 'travel',
      'museum', 'coop', 'aero', 'xxx', 'xyz', 'top', 'wang', 'club', 'icu', 'shop'
    ];

    if (!validTLDs.includes(tld)) {
      return { 
        isValid: false, 
        error: `Invalid domain extension '.${tld}'. Please use a legitimate top-level domain (e.g., .com, .net, .org, .ph)` 
      };
    }

    return { isValid: true };
  };

  const handleAddUser = async (e?: React.MouseEvent) => {
    // Prevent any default behavior
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    if (!newUser.username || !newUser.email) {
      setError?.("Please fill in all required fields");
      toast({ 
        title: 'Missing Fields', 
        description: "Please fill in all required fields",
        variant: 'destructive'
      });
      return;
    }

    // Validate email with TLD check
    const emailValidation = validateEmail(newUser.email);
    if (!emailValidation.isValid) {
      setError?.(emailValidation.error || "Invalid email address");
      toast({ 
        title: 'Invalid Email', 
        description: emailValidation.error || "Please enter a valid email address",
        variant: 'destructive'
      });
      return;
    }

    setAddUserLoading(true);
    try {
      // Create Auth user + profile in Firestore and send password setup link via email
      const created = await createWebUser(
        newUser.email!,
        newUser.username!,
        (newUser.role as 'admin' | 'seller') || 'seller',
        (newUser.permissions as any) || {
          dashboard: true,
          profile: true,
          bookings: true,
          confirmation: false,
          withdrawal: false,
          access: false,
          images: false,
          users: false,
          inventory: false,
          'seller-orders': true,
          'add-product': true,
          policies: false
        }
      );

      const user: User = {
        id: created.uid,
        username: newUser.username!,
        email: newUser.email!,
        role: (newUser.role as 'admin' | 'seller') || 'seller',
        status: 'pending',
        permissions: newUser.permissions || defaultPermissionsByRole((newUser.role as 'admin' | 'seller') || 'seller'),
        createdAt: new Date().toISOString()
      };

      setUsers(prev => [...prev, user]);
      
      // Store success data for dialog
      setSuccessUserData({
        username: newUser.username!,
        email: newUser.email!
      });
      
      // Optionally refresh from Firestore to reflect authoritative data
      try {
        await refreshUserList();
      } catch {}
      
      // Reset form and show success dialog
      setNewUser({
        username: "",
        email: "",
        role: "seller",
        status: "pending",
        permissions: defaultPermissionsByRole('seller')
      });
      setShowAddForm(false);
      setError?.(null);
      setSuccessDialogOpen(true);
    } catch (e: any) {
      console.error('Failed to create user:', e);
      setError?.(e.message || 'Failed to create user');
      toast({ 
        title: 'Failed to create user', 
        description: e.message || 'An error occurred while creating the user. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setAddUserLoading(false);
    }
  };

  const handleEditUser = (user: User) => {
    if (onEditUser) {
      onEditUser(user);
      return;
    }
    setEditingUser(user);
    setIsEditDialogOpen(true);
  };

  const handleResendInvite = async (user: User) => {
    try {
      const confirmed = window.confirm(`Resend invitation email to ${user.email}?`);
      if (!confirmed) return;
      await resendUserInvite(user.email);
      toast({ title: 'Invite sent', description: `Password reset link sent to ${user.email}` });
    } catch (e: any) {
      setError?.(e.message || 'Failed to resend invitation email');
      toast({ title: 'Failed to send invite', description: e.message || 'Please try again.' });
    }
  };

  const handleToggleActive = async (user: User) => {
    const next = user.status === 'active' ? 'inactive' : 'active';
    const verb = next === 'active' ? 'activate' : 'deactivate';
    const confirmed = window.confirm(`Are you sure you want to ${verb} ${user.username}?`);
    if (!confirmed) return;
    await handleStatusChange(user.id, next as any);
    toast({ title: `User ${next}`, description: `${user.username} is now ${next}.` });
  };

  const handleUpdateUser = async () => {
    if (!editingUser) return;
    
    // Validate email with TLD check
    if (editingUser.email) {
      const emailValidation = validateEmail(editingUser.email);
      if (!emailValidation.isValid) {
        setError?.(emailValidation.error || "Invalid email address");
        toast({ 
          title: 'Invalid Email', 
          description: emailValidation.error || "Please enter a valid email address",
          variant: 'destructive'
        });
        return;
      }
    }
    
    try {
      // Update role and permissions in Firestore (no RBAC enforcement yet)
      await updateWebUserAccess(
        editingUser.id,
        editingUser.role,
        editingUser.permissions as any
      );

      setUsers(prev => prev.map((user) => (
        user.id === editingUser.id ? editingUser : user
      )));
      // Refresh list from Firestore to reflect authoritative data
      try {
        await refreshUserList();
      } catch {}
      setEditingUser(null);
      setShowAddForm(false);
      setError?.(null);
      toast({ title: 'User updated', description: 'Access and permissions saved.' });
    } catch (e: any) {
      setError?.(e.message || 'Failed to update user');
    }
  };

  // Save from dialog
  const handleSaveEdit = async () => {
    if (!editingUser) return;
    try {
      setSaving(true);
      await handleUpdateUser();
      setIsEditDialogOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (user) {
      setUserToDelete({ id: userId, username: user.username });
      setDeleteModalOpen(true);
    }
  };

  const confirmDeleteUser = async () => {
    if (!userToDelete) return;
    try {
      // Delete from Firestore
      await deleteWebUser(userToDelete.id);
      
      // Update local state after successful deletion
      setUsers(prev => prev.filter((user) => user.id !== userToDelete.id));
      toast({ title: 'User deleted', description: `${userToDelete.username} has been removed.` });
      setDeleteModalOpen(false);
      setUserToDelete(null);
    } catch (e: any) {
      setError?.(e.message || 'Failed to delete user');
      toast({ title: 'Failed to delete user', description: e.message || 'Please try again.' });
    }
  };

  const handleStatusChange = async (userId: string, newStatus: 'active' | 'inactive' | 'pending') => {
    setUsers(prev => prev.map((user) => (
      user.id === userId ? { ...user, status: newStatus } : user
    )));
    try {
      // Persist active/inactive to Firestore boolean flag
      if (newStatus === 'active' || newStatus === 'inactive') {
        await setWebUserStatus(userId, newStatus === 'active');
      }
      // Refresh list to reflect persisted status
      try {
        await refreshUserList();
      } catch {}
    } catch (e: any) {
      setError?.(e.message || 'Failed to update status');
    }
  };

  const handlePermissionChange = (userId: string, permission: keyof User['permissions'], value: boolean) => {
    setUsers(prev => prev.map((user) => (
      user.id === userId 
        ? { ...user, permissions: { ...user.permissions, [permission]: value } }
        : user
    )));
  };

  const formatUserForExport = (u: User) => ({
    Username: u.username,
    Email: u.email,
    Role: u.role,
    Status: u.status,
    Permissions: Object.entries(u.permissions || {})
      .filter(([, v]) => !!v)
      .map(([k]) => k)
      .join(', '),
    CreatedAt: u.createdAt,
    LastLogin: u.lastLogin || ''
  });

  // Helper to convert image URL to base64 data URL (for PDF/ExcelJS)
  const loadImageDataUrl = async (url: string): Promise<string> => {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const exportToPDF = async (list: User[], title: string) => {
    const data = list.map(formatUserForExport);
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

    // Header with logo and title
    try {
      const logoDataUrl = await loadImageDataUrl(dentpalLogo);
      doc.addImage(logoDataUrl, 'PNG', 40, 24, 100, 28);
    } catch {}

    doc.setFontSize(18);
    doc.setTextColor(34, 139, 94); // DentPal brand-ish
    doc.text(`${title}`, 160, 44);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Exported: ${new Date().toLocaleString()}`, 160, 60);

    // Table
    (doc as any).autoTable({
      head: [["Username", "Email", "Role", "Status", "Permissions", "Created At", "Last Login"]],
      body: data.map(d => [d.Username, d.Email, d.Role, d.Status, d.Permissions, d.CreatedAt, d.LastLogin]),
      styles: { fontSize: 9, cellPadding: 6 },
      headStyles: { fillColor: [16, 185, 129], textColor: 255 },
      bodyStyles: { textColor: [55, 65, 81] },
      theme: 'grid',
      startY: 90,
      didDrawPage: (data: any) => {
        // Footer with page numbers
        const ps: any = doc.internal.pageSize as any;
        const pageHeight = ps.height || (ps.getHeight && ps.getHeight());
        const pageWidth = ps.width || (ps.getWidth && ps.getWidth());
        const page = (doc as any).getNumberOfPages ? (doc as any).getNumberOfPages() : data.pageNumber;
        doc.setFontSize(9);
        doc.setTextColor(120);
        doc.text(`DentPal • ${new Date().getFullYear()}`, 40, (pageHeight || 792) - 24);
        doc.text(`Page ${page}`, (pageWidth || 1120) - 80, (pageHeight || 792) - 24);
      }
    });

    doc.save(`${title.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}.pdf`);
  };

  const exportToCSV = (list: User[], title: string) => {
    const data = list.map(formatUserForExport);
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, title);
    XLSX.writeFile(wb, `${title.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}.csv`, { bookType: 'csv' });
  };

  const exportToExcel = async (list: User[], title: string) => {
    const data = list.map(formatUserForExport);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet 1', {
      properties: { defaultRowHeight: 22 },
      pageSetup: { paperSize: 9, orientation: 'landscape' }
    });

    // Add logo
    try {
      const logoDataUrl = await loadImageDataUrl(dentpalLogo);
      const imageId = workbook.addImage({ base64: logoDataUrl, extension: 'png' });
      sheet.addImage(imageId, {
        tl: { col: 0, row: 0 }, // top-left at A1
        ext: { width: 140, height: 40 }
      });
    } catch {}

    // Title row
    const titleRowIndex = 3;
    sheet.mergeCells(titleRowIndex, 2, titleRowIndex, 7); // merge B3:G3
    const titleCell = sheet.getCell(titleRowIndex, 2);
    titleCell.value = `${title}`;
    titleCell.font = { name: 'Inter', bold: true, size: 18, color: { argb: 'FF065F46' } };

    // Subtitle row (exported at)
    const subRowIndex = 4;
    sheet.mergeCells(subRowIndex, 2, subRowIndex, 7);
    const subCell = sheet.getCell(subRowIndex, 2);
    subCell.value = `Exported: ${new Date().toLocaleString()}`;
    subCell.font = { size: 10, color: { argb: 'FF6B7280' } };

    // Header row
    const headerRowIndex = 6;
    const headers = ["Username", "Email", "Role", "Status", "Permissions", "Created At", "Last Login"];
    sheet.getRow(headerRowIndex).values = headers;
    sheet.getRow(headerRowIndex).font = { name: 'Inter', bold: true, color: { argb: 'FFFFFFFF' } } as any;
    sheet.getRow(headerRowIndex).alignment = { vertical: 'middle' as const, horizontal: 'center' as const };
    sheet.getRow(headerRowIndex).height = 28;

    // Header styling and column widths
    const columnWidths = [22, 30, 12, 14, 40, 22, 22];
    headers.forEach((_, i) => {
      const cell = sheet.getRow(headerRowIndex).getCell(i + 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } } as any;
      cell.border = {
        top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' }
      };
      sheet.getColumn(i + 1).width = columnWidths[i];
    });

    // Data rows
    const startRow = headerRowIndex + 1;
    data.forEach((d, idx) => {
      const rowIndex = startRow + idx;
      const row = sheet.getRow(rowIndex);
      row.values = [d.Username, d.Email, d.Role, d.Status, d.Permissions, d.CreatedAt, d.LastLogin];
      row.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true } as any;
      row.height = 22;
      // Zebra striping
      const isAlt = idx % 2 === 0;
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'hair' }, left: { style: 'hair' }, bottom: { style: 'hair' }, right: { style: 'hair' }
        };
        if (isAlt) {
          (cell as any).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
        }
      });
    });

    // Freeze header
    sheet.views = [{ state: 'frozen', ySplit: headerRowIndex }];

    // Footer note
    const footerRow = sheet.addRow([`DentPal • © ${new Date().getFullYear()}`]);
    footerRow.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF6B7280' } } as any;

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `${title.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}.xlsx`);
  };

  const exportUsers = async (list: User[], type: 'csv' | 'xlsx' | 'pdf', title: string) => {
    if (type === 'pdf') return await exportToPDF(list, title);
    if (type === 'xlsx') return await exportToExcel(list, title);
    return exportToCSV(list, title);
  };

  const formatDate = (dateString: string) => {
    try {
      const ms = normalizeTimestamp(dateString) ?? Date.parse(dateString);
      if (!ms || isNaN(ms)) return dateString;
      return new Date(ms).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  // Derived lists and UI helpers
  const filteredUsers = users.filter((user) => {
    // Exclude sub-accounts from the main list (they appear under their parent)
    if (user.isSubAccount) return false;
    
    const term = (searchTerm || '').toLowerCase();
    const uname = (user.username || '').toLowerCase();
    const mail = (user.email || '').toLowerCase();
    const matchesSearch = !term || uname.includes(term) || mail.includes(term);
    const matchesStatus = filterStatus === 'all' || user.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800 border-green-200';
      case 'inactive': return 'bg-red-100 text-red-800 border-red-200';
      case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <CheckCircle className="w-4 h-4" />;
      case 'inactive': return <XCircle className="w-4 h-4" />;
      case 'pending': return <Clock className="w-4 h-4" />;
      default: return <AlertCircle className="w-4 h-4" />;
    }
  };

  const handleExport = () => {
    const list = activeSection === 'admin'
      ? filteredUsers.filter(u => u.role === 'admin')
      : activeSection === 'seller'
        ? filteredUsers.filter(u => u.role === 'seller')
        : filteredUsers;
    const title = activeSection === 'admin' ? 'List of Access on Admin' : activeSection === 'seller' ? 'List of Access on Seller' : 'List of Access on Users';
    exportUsers(list, 'xlsx', title);
  };

  // New: handler that receives a type from dropdowns
  const handleExportAs = async (type: 'csv' | 'xlsx' | 'pdf', listOverride?: User[], titleOverride?: string) => {
    const list = listOverride || (
      activeSection === 'admin'
        ? filteredUsers.filter(u => u.role === 'admin')
        : activeSection === 'seller'
          ? filteredUsers.filter(u => u.role === 'seller')
          : filteredUsers
    );
    const title = titleOverride || (activeSection === 'admin' ? 'List of Access on Admin' : activeSection === 'seller' ? 'List of Access on Seller' : 'List of Access on Users');
    await exportUsers(list, type, title);
  };

  const renderUserForm = () => {
    const currentUser = editingUser || newUser;
    const isEditing = !!editingUser;

    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold text-gray-900">
            {isEditing ? 'Edit User' : 'Add New User'}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowAddForm(false);
              setEditingUser(null);
            }}
          >
            ✕
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Username</label>
              <Input
                type="text"
                placeholder="Enter username"
                value={currentUser.username || ""}
                onChange={(e) => isEditing 
                  ? setEditingUser(prev => prev ? { ...prev, username: e.target.value } : null)
                  : setNewUser(prev => ({ ...prev, username: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
              <Input
                type="email"
                placeholder="Enter email address"
                value={currentUser.email || ""}
                onChange={(e) => isEditing 
                  ? setEditingUser(prev => prev ? { ...prev, email: e.target.value } : null)
                  : setNewUser(prev => ({ ...prev, email: e.target.value }))
                }
              />
            </div>
            {/* Remove password input: invites send a reset link instead */}
            {!isEditing && (
              <div className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
                An invite email with a password setup link will be sent to this user.
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
              <select
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                value={currentUser.role || "seller"}
                onChange={(e) => {
                  const role = e.target.value as 'admin' | 'seller';
                  const permissions = defaultPermissionsByRole(role);
                  
                  if (isEditing) {
                    setEditingUser(prev => prev ? { ...prev, role, permissions } : null);
                  } else {
                    setNewUser(prev => ({ ...prev, role, permissions }));
                  }
                }}
              >
                <option value="seller">Seller</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          {/* Permissions */}
          {currentUser.role === 'admin' ? (
            <div className="space-y-4">
              <h4 className="text-lg font-medium text-gray-900">Manage Access</h4>
              <div className="space-y-3">
                {Object.entries(currentUser.permissions || {})
                  .filter(([permission]) => {
                    // Hide these permissions for Admin role
                    const hiddenAdminPermissions = ['profile', 'bookings', 'confirmation', 'inventory', 'seller-orders', 'add-product'];
                    return !hiddenAdminPermissions.includes(permission);
                  })
                  .map(([permission, enabled]) => (
                  <div key={permission} className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700 capitalize">
                      {permission === 'seller-orders' ? 'orders' : 
                       permission === 'policies' ? 'terms & policies' : 
                       permission === 'product-qc' ? 'QC Product' :
                       permission === 'categories' ? 'Categories' :
                       permission.replace('-', ' ')}
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => {
                          if (isEditing) {
                            setEditingUser(prev => prev ? {
                              ...prev,
                              permissions: {
                                ...prev.permissions,
                                [permission]: e.target.checked
                              }
                            } : null);
                          } else {
                            setNewUser(prev => ({
                              ...prev,
                              permissions: {
                                ...prev.permissions,
                                [permission]: e.target.checked
                              }
                            }));
                          }
                        }}
                        className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
                      />
                      {enabled ? (
                        <Unlock className="w-4 h-4 text-green-500" />
                      ) : (
                        <Lock className="w-4 h-4 text-red-500" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <h4 className="text-lg font-medium text-gray-900">Access</h4>
              <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3">
                Sellers automatically have access to: <span className="font-medium">Sales, Profile, Inventory Control, Orders, Items, Access (Sub Accounts)</span>.
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-200">
          <div className="text-sm text-gray-500">
            {isEditing ? 'Update user information and permissions' : 'The user will receive an email to set their password'}
          </div>
          <div className="flex items-center space-x-3">
            <Button
              variant="outline"
              onClick={() => {
                setShowAddForm(false);
                setEditingUser(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (isEditing) {
                  handleUpdateUser();
                } else {
                  handleAddUser(e);
                }
              }}
              disabled={addUserLoading}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {addUserLoading ? "Processing..." : isEditing ? "Update User" : "Invite User"}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const renderUserList = (userList: User[], title: string) => (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold text-gray-900">{title}</h3>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-green-50 text-green-700">
              {userList.length} users
            </Badge>
            {/* Removed redundant per-list Export dropdown */}
          </div>
        </div>
      </div>

      <div className="overflow-hidden">
        {userList.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">No {title.toLowerCase()} found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Access Level
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {userList.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10">
                          <div className="h-10 w-10 rounded-full bg-gradient-to-r from-green-400 to-teal-500 flex items-center justify-center">
                            <span className="text-sm font-medium text-white">
                              {user.username.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">{user.username}</div>
                          <div className="text-sm text-gray-500">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-wrap gap-1 max-w-md">
                        {Object.entries(user.permissions || {})
                          .filter(([permission, enabled]) => {
                            // Hide seller-specific permissions from admin display
                            const hiddenPermissions = ['bookings', 'booking', 'inventory', 'seller-orders', 'add-product'];
                            return enabled && !hiddenPermissions.includes(permission);
                          })
                          .map(([permission]) => (
                            <Badge 
                              key={permission} 
                              variant="secondary" 
                              className="text-xs bg-green-100 text-green-800 border border-green-200"
                            >
                              {permission === 'policies' 
                                ? 'Policies' 
                                : permission.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </Badge>
                          ))}
                        {Object.entries(user.permissions || {}).filter(([permission, enabled]) => {
                          const hiddenPermissions = ['bookings', 'booking', 'inventory', 'seller-orders', 'add-product'];
                          return enabled && !hiddenPermissions.includes(permission);
                        }).length === 0 && (
                          <span className="text-xs text-gray-400 italic">No permissions</span>
                        )}
                      </div>
                    </td>
                  
                   
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex items-center space-x-1">
                        {/* Edit icon */}
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Edit user"
                          aria-label="Edit user"
                          className="text-blue-600 hover:text-blue-800"
                          onClick={() => {
                            setEditingUser(user);
                            setShowAddForm(false);
                            setIsEditDialogOpen(true);
                          }}
                        >
                          <Edit3 className="w-4 h-4" />
                        </Button>
                        {/* Toggle Active/Inactive */}
                        <Button
                          variant="ghost"
                          size="sm"
                          title={user.status === 'active' ? 'Deactivate' : 'Activate'}
                          aria-label={user.status === 'active' ? 'Deactivate' : 'Activate'}
                          className={user.status === 'active' ? 'text-amber-600 hover:text-amber-800' : 'text-green-600 hover:text-green-800'}
                          onClick={() => handleToggleActive(user)}
                        >
                          {user.status === 'active' ? (
                            <Lock className="w-4 h-4" />
                          ) : (
                            <Unlock className="w-4 h-4" />
                          )}
                        </Button>
                        {/* Resend invite */}
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Resend invite"
                          aria-label="Resend invite"
                          className="text-gray-600 hover:text-gray-800"
                          onClick={() => handleResendInvite(user)}
                        >
                          <Key className="w-4 h-4" />
                        </Button>
                        {/* Delete user */}
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Delete user"
                          aria-label="Delete user"
                          className="text-red-600 hover:text-red-800"
                          onClick={() => handleDeleteUser(user.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  // Seller-only simplified view: show Sub-accounts section only
  if (isSeller && !isAdmin) {
    const allowedKeys = (Object.keys(subPerms) as Array<keyof User['permissions']>).filter(k => sellerPerms[k]);
    return (
      <div className="space-y-6">
        {/* Green banner hidden as requested */}

        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              <h3 className="text-sm font-semibold">Seller Sub-accounts</h3>
            </div>
            <div className="flex items-center gap-2">
              {/* <Button size="sm" variant="outline" onClick={() => { setManageOpen(true); loadMembers(); }}>
                View Sub Account
              </Button> */}
              <Button size="sm" onClick={() => setSubOpen(true)} className="bg-teal-600 hover:bg-teal-700 text-white"><UserPlus className="w-4 h-4 mr-1"/> New Sub-account</Button>
            </div>
          </div>
          <p className="text-xs text-gray-500">Only permissions you already have can be granted to sub-accounts.</p>
        </div>

        {/* Manage Sub-accounts Dialog */}
        <Dialog open={manageOpen} onOpenChange={setManageOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Sub-accounts</DialogTitle>
              <DialogDescription>View, edit, or delete your team members.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {membersLoading ? (
                <div className="text-sm text-gray-500">Loading…</div>
              ) : members.length === 0 ? (
                <div className="text-sm text-gray-500">No sub-accounts yet.</div>
              ) : (
                <div className="divide-y rounded-md border">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center justify-between p-3 hover:bg-gray-50">
                      <div>
                        <div className="font-medium">{m.name || m.email}</div>
                        <div className="text-xs text-gray-500">{m.email}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {Object.entries(m.permissions || {}).filter(([k, v]) => {
                            // Filter out bookings and notifications from display
                            if (k === 'bookings' || k === 'notifications') return false;
                            return v;
                          }).map(([k]) => (
                            <span key={k} className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">{getPermissionLabel(k)}</span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => { setEditing({ ...m }); setViewOnly(true); }}>View</Button>
                        <Button variant="ghost" size="sm" onClick={() => { setEditing({ ...m }); setViewOnly(false); }}><Edit3 className="w-4 h-4 mr-1"/> Edit</Button>
                        <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-800" onClick={() => handleDeleteMember(m)}><Trash2 className="w-4 h-4 mr-1"/> Delete</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setManageOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit/View Sub-account Dialog */}
        <Dialog open={!!editing} onOpenChange={(o)=> { if (!o) { setEditing(null); setViewOnly(false); } }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{viewOnly ? 'View' : 'Edit'} Sub-account - {editing?.name || 'Sub-account'}</DialogTitle>
              <DialogDescription>{editing?.email}</DialogDescription>
            </DialogHeader>
            {editing && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs mb-1">Name</label>
                  <Input value={editing.name || ''} onChange={(e)=> setEditing({ ...editing, name: e.target.value })} disabled={viewOnly} readOnly={viewOnly} className={viewOnly ? 'bg-gray-50' : ''} />
                </div>
                <div>
                  <label className="block text-xs mb-1">Permissions</label>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.keys(sellerPerms).filter(k => {
                      const key = k as keyof typeof sellerPerms;
                      // Filter out bookings, notifications, reports, profile, and access from display
                      if (k === 'bookings' || k === 'notifications' || k === 'reports' || k === 'profile' || k === 'access') return false;
                      return sellerPerms[key];
                    }).map((k) => (
                      <label key={k} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={Boolean(editing.permissions?.[k])}
                          onChange={(e)=> setEditing({ ...editing, permissions: { ...(editing.permissions || {}), [k]: e.target.checked } })}
                          disabled={viewOnly}
                        />
                        <span>{getPermissionLabel(k)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-3 border-t pt-3">
              <p className="text-xs text-gray-600">Account Actions</p>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => editing && handleSendInvite(editing.email, 'reinvite')}
                  disabled={sendingInvite}
                  className="flex-1"
                >
                  Reinvite
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => editing && handleSendInvite(editing.email, 'reset')}
                  disabled={sendingInvite}
                  className="flex-1"
                >
                  Reset Password
                </Button>
              </div>
            </div>
            <DialogFooter className="flex justify-between">
              <div>
                {!viewOnly && editing && (
                  <Button 
                    variant="destructive" 
                    onClick={() => {
                      setSubAccountToDelete(editing);
                    }}
                  >
                    Delete
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={()=> { setEditing(null); setViewOnly(false); }}>Close</Button>
                {!viewOnly && (
                  <Button onClick={handleUpdateMember} className="bg-teal-600 hover:bg-teal-700 text-white">Save changes</Button>
                )}
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Sub-account Delete Confirmation Dialog */}
        <Dialog open={!!subAccountToDelete} onOpenChange={(o) => { if (!o) setSubAccountToDelete(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete Sub-account</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this sub-account?
              </DialogDescription>
            </DialogHeader>
            {subAccountToDelete && (
              <div className="space-y-2 py-4">
                <div className="bg-gray-50 p-3 rounded-md">
                  <p className="text-sm font-medium">{subAccountToDelete.name || 'Sub-account'}</p>
                  <p className="text-xs text-gray-600">{subAccountToDelete.email}</p>
                </div>
                <p className="text-sm text-gray-700">
                  This action cannot be undone. The sub-account will lose access to the system immediately.
                </p>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setSubAccountToDelete(null)}>
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={() => subAccountToDelete && handleDeleteMember(subAccountToDelete)}
              >
                Delete Account
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={subOpen} onOpenChange={setSubOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>New Sub-account</DialogTitle>
              <DialogDescription>Invite a team member with limited access.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="block text-xs mb-1">Name</label>
                <Input value={subName} onChange={(e)=> setSubName(e.target.value)} placeholder="Full name" />
              </div>
              <div>
                <label className="block text-xs mb-1">Email</label>
                <Input type="email" value={subEmail} onChange={(e)=> setSubEmail(e.target.value)} placeholder="name@company.com" />
              </div>
              <div>
                <label className="block text-xs mb-1">Role Bundle</label>
                <select className="w-full p-2 border rounded" value={subBundle} onChange={(e)=> setSubBundle(e.target.value as any)}>
                  <option value="ops">Order Management (Orders & Inventory Control)</option>
                  <option value="finance">Finance (Withdrawal only)</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              {/* Permissions grid (for custom tweak) */}
              <div className="grid grid-cols-2 gap-2">
                {Object.keys({ ...subPerms, chats: (subPerms as any).chats ?? false }).filter(k => {
                  // Hide bookings, notifications, confirmation, access, users, images, profile, withdrawal, policies
                  if ([
                    'bookings', 'notifications', 'confirmation', 'access', 'users', 'images', 'profile', 'withdrawal', 'policies'
                  ].includes(k)) return false;
                  return true;
                }).map((k) => (
                  <label key={k} className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={(subPerms as any)[k]} onChange={(e)=> setSubPerms(p=>({ ...(p as any), [k]: e.target.checked }))} disabled={subBundle!=='custom'} />
                    <span>{getPermissionLabel(k)}</span>
                  </label>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={()=> setSubOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateSub} disabled={subLoading} className="bg-teal-600 hover:bg-teal-700 text-white">
                {subLoading ? 'Sending…' : 'Create & Send Invite'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Sub-accounts List */}
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Sub-accounts</h3>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={loadMembers}
                disabled={membersLoading}
              >
                {membersLoading ? 'Loading...' : 'Refresh'}
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            {membersLoading ? (
              <div className="px-6 py-8 text-center text-sm text-gray-500">
                Loading sub-accounts...
              </div>
            ) : members.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-gray-500">
                No sub-accounts created yet. Click "New Sub-account" to invite team members.
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Permissions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {members.map((member) => {
                    const permissions = member.permissions || {};
                    const activePermissions = Object.keys(permissions)
                      .filter(key => {
                        // Remove profile from display in permissions column
                        if (key === 'profile') return false;
                        return permissions[key] === true;
                      })
                      .map(key => getPermissionLabel(key));

                    return (
                      <tr 
                        key={member.id} 
                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => {
                          setEditing(member);
                          setViewOnly(false);
                        }}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {member.name || 'N/A'}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500">
                            {member.email}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1">
                            {activePermissions.length > 0 ? (
                              activePermissions.map((perm) => (
                                <Badge 
                                  key={perm} 
                                  variant="outline" 
                                  className="text-xs bg-teal-50 text-teal-700 border-teal-200"
                                >
                                  {perm}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-xs text-gray-400">No permissions</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Build a parent->children map for sellers and their sub-accounts (admin view)
  const renderSellerListGrouped = (userList: User[]) => (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold text-gray-900">Seller Users</h3>
          <Badge variant="secondary" className="bg-green-50 text-green-700">{userList.length} sellers</Badge>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Seller</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Access</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {userList.map((seller) => {
              const isOpen = !!expanded[seller.id];
              const withSubs = sellerWithSubs[seller.id];
              return (
                <>
                  <tr key={seller.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3">
                      <button onClick={() => toggleExpand(seller)} className="mr-2 text-gray-600 hover:text-gray-900">
                        {isOpen ? <ChevronDown className="w-4 h-4 inline"/> : <ChevronRight className="w-4 h-4 inline"/>}
                      </button>
                      <span className="font-medium">{seller.username}</span>
                      <span className="ml-2 text-xs text-gray-500">{seller.email}</span>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(seller.permissions || {}).filter(([,v]) => v).map(([k]) => (
                          <Badge key={k} variant="secondary" className="text-xs bg-green-100 text-green-800">{k}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <Badge className={`${getStatusColor(seller.status)} text-xs border`}>
                        <span className="flex items-center space-x-1">{getStatusIcon(seller.status)}<span>{seller.status}</span></span>
                      </Badge>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-1">
                        {/* Edit platform fee button */}
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => handleOpenPlatformFeeModal(seller)} 
                          className="text-blue-600 hover:text-blue-800"
                          title="Edit Platform Fee"
                        >
                          <Edit3 className="w-4 h-4"/>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleToggleActive(seller)} className={seller.status==='active'? 'text-amber-600 hover:text-amber-800':'text-green-600 hover:text-green-800'}>{seller.status==='active'? <Lock className="w-4 h-4"/>:<Unlock className="w-4 h-4"/>}</Button>
                        <Button variant="ghost" size="sm" onClick={() => handleResendInvite(seller)} className="text-gray-600 hover:text-gray-800"><Key className="w-4 h-4"/></Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDeleteUser(seller.id)} className="text-red-600 hover:text-red-800"><Trash2 className="w-4 h-4"/></Button>
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    !withSubs ? (
                      <tr className="bg-gray-50/50">
                        <td colSpan={4} className="px-12 py-3 text-sm text-gray-500">Loading sub-accounts…</td>
                      </tr>
                    ) : (withSubs.subAccounts && withSubs.subAccounts.length > 0 ? (
                      <>
                        {withSubs.subAccounts.map((m) => {
                          const mStatus = (m as any).status || 'pending';
                          return (
                            <tr key={`sub-${seller.id}-${m.id}`} className="hover:bg-gray-50">
                              <td className="px-6 py-3">
                                <div className="flex items-center">
                                  <span className="inline-block w-4 mr-2" aria-hidden></span>
                                  <Users className="w-4 h-4 text-gray-400 mr-2" />
                                  <div>
                                    <div className="font-medium">
                                      {m.name || m.email}
                                      <Badge className="ml-2 text-[10px] bg-gray-100 text-gray-700 border">Sub account</Badge>
                                    </div>
                                    <div className="text-xs text-gray-500">{m.email}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-3">
                                <div className="flex flex-wrap gap-1">
                                  {Object.entries((m as any).permissions || {})
                                    .filter(([, v]) => v)
                                    .filter(([k]) => k !== 'profile') // Sub-accounts don't have profile access
                                    .map(([k]) => (
                                      <Badge
                                        key={k}
                                        variant="secondary"
                                        className="text-xs bg-green-100 text-green-800"
                                      >
                                        {String(k)}
                                      </Badge>
                                    ))}
                                </div>
                              </td>
                              <td className="px-6 py-3">
                                <Badge className={`${getStatusColor(mStatus)} text-xs border`}>
                                  <span className="flex items-center space-x-1">
                                    {getStatusIcon(mStatus)}
                                    <span>{mStatus}</span>
                                  </span>
                                </Badge>
                              </td>
                              <td className="px-6 py-3">
                                <div className="flex items-center gap-1">
                                  <Button variant="ghost" size="sm" onClick={() => setEditing({ ...m })} className="text-gray-700 hover:text-gray-900">View</Button>
                                  <Button variant="ghost" size="sm" onClick={() => setEditing({ ...m })} className="text-blue-600 hover:text-blue-800"><Edit3 className="w-4 h-4"/></Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={async () => {
                                      try {
                                        await resendUserInvite((m as any).email);
                                        toast({ title: 'Invite sent', description: `Password reset link sent to ${(m as any).email}` });
                                      } catch (e: any) {
                                        toast({ title: 'Failed to send invite', description: e.message || 'Please try again.' });
                                      }
                                    }}
                                    className="text-gray-600 hover:text-gray-800"
                                  >
                                    <Key className="w-4 h-4"/>
                                  </Button>
                                  <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-800" onClick={() => handleDeleteMember(m)}><Trash2 className="w-4 h-4"/></Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </>
                    ) : (
                      <tr className="bg-gray-50/50">
                        <td colSpan={4} className="px-12 py-3 text-sm text-gray-500">No sub-accounts.</td>
                      </tr>
                    ))
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
     
      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center space-x-3">
          <XCircle className="w-5 h-5 text-red-500" />
          <span className="text-red-700">{error}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setError?.(null)}
            className="ml-auto text-red-500 hover:text-red-700"
          >
            ✕
          </Button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="bg-white rounded-2xl border border-gray-200 p-2 shadow-sm">
        <div className="flex space-x-2">
          <Button
            variant={activeSection === 'add' ? 'default' : 'ghost'}
            className={`flex-1 ${activeSection === 'add' 
              ? 'bg-green-600 text-white shadow-md' 
              : 'text-gray-600 hover:text-gray-900'
            }`}
            onClick={() => setActiveSection('add')}
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Add User
          </Button>
          <Button
            variant={activeSection === 'admin' ? 'default' : 'ghost'}
            className={`flex-1 ${activeSection === 'admin' 
              ? 'bg-green-600 text-white shadow-md' 
              : 'text-gray-600 hover:text-gray-900'
            }`}
            onClick={() => setActiveSection('admin')}
          >
            <Settings className="w-4 h-4 mr-2" />
            Admin Users ({filteredUsers.filter(u => u.role === 'admin').length})
          </Button>
          <Button
            variant={activeSection === 'seller' ? 'default' : 'ghost'}
            className={`flex-1 ${activeSection === 'seller' 
              ? 'bg-green-600 text-white shadow-md' 
              : 'text-gray-600 hover:text-gray-900'
            }`}
            onClick={() => setActiveSection('seller')}
          >
            <Users className="w-4 h-4 mr-2" />
            Seller Users ({filteredUsers.filter(u => u.role === 'seller').length})
          </Button>
        </div>
      </div>

      {/* Search and Filter Bar */}
      {activeSection !== 'add' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <Input
                placeholder="Search users by username or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="md:w-64">
              <select
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            {/* Export dropdown in toolbar */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="flex items-center space-x-2">
                  <Download className="w-4 h-4" />
                  <span>Export</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExportAs('csv')} className="flex items-center gap-2">
                  <File className="w-4 h-4" /> CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExportAs('xlsx')} className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4" /> Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExportAs('pdf')} className="flex items-center gap-2">
                  <FileText className="w-4 h-4" /> PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {/* Content Area */}
      {activeSection === 'add' && (showAddForm || editingUser) && renderUserForm()}
      
      {activeSection === 'add' && !showAddForm && !editingUser && (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center shadow-sm">
          <div className="max-w-md mx-auto">
            <UserPlus className="w-16 h-16 text-gray-400 mx-auto mb-6" />
            <h3 className="text-2xl font-semibold text-gray-900 mb-4">Add New User</h3>
            <p className="text-gray-500 mb-8">
              Create new user accounts and manage their access permissions to different parts of the system.
            </p>
            <Button
              onClick={() => setShowAddForm(true)}
              className="bg-green-600 hover:bg-green-700 text-white px-8 py-3"
            >
              <UserPlus className="w-5 h-5 mr-2" />
              Create New User
            </Button>
          </div>
        </div>
      )}

      {activeSection === 'admin' && renderUserList(filteredUsers.filter(u => u.role === 'admin'), 'Admin Users')}
      {activeSection === 'seller' && renderSellerListGrouped(filteredUsers.filter(u => u.role === 'seller'))}

      {/* Edit Access Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={(open) => {
        setIsEditDialogOpen(open);
        if (!open) setEditingUser(null);
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit access</DialogTitle>
            <DialogDescription>
              {editingUser ? (
                <span>Update role and permissions for <strong>{editingUser.username}</strong> ({editingUser.email})</span>
              ) : (
                'Update role and permissions'
              )}
            </DialogDescription>
          </DialogHeader>

          {editingUser && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                <div className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-900 font-medium">
                  Admin
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-3">Access permissions</h4>
                <div className="space-y-3 max-h-72 overflow-auto pr-1">
                  {Object.entries(editingUser.permissions || {})
                    .filter(([permission]) => !['bookings', 'inventory', 'seller-orders', 'add-product', 'profile', 'confirmation'].includes(permission))
                    .map(([permission, enabled]) => (
                    <div key={permission} className="flex items-center justify-between">
                      <label className="text-sm text-gray-700 capitalize">{permission === 'seller-orders' ? 'orders' : permission === 'policies' ? 'terms & policies' : permission.replace('-', ' ')}</label>
                      <input
                        type="checkbox"
                        checked={!!enabled}
                        onChange={(e) => setEditingUser(prev => prev ? {
                          ...prev,
                          permissions: { ...prev.permissions, [permission]: e.target.checked }
                        } : prev)}
                        className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => { setIsEditDialogOpen(false); setEditingUser(null); }}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving} className="bg-green-600 hover:bg-green-700 text-white">
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vendor Enrollment Wizard */}
      <Dialog open={vendorWizardOpen} onOpenChange={(o) => setVendorWizardOpen(o)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Vendor Enrollment</DialogTitle>
            <DialogDescription>
              {vendorStep === 'upload' ? 'Upload and review BIR document' : 'Company, address, and contacts'}
            </DialogDescription>
          </DialogHeader>

          {vendorStep === 'upload' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">TIN Number</label>
                <Input
                  placeholder="Enter TIN"
                  value={vendorForm.tin}
                  onChange={(e) => setVendorForm(prev => ({ ...prev, tin: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">BIR Document (image/PDF)</label>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setVendorForm(prev => ({ ...prev, birFile: e.target.files?.[0] || null }))}
                  className="block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
                />
                {vendorForm.bir && (
                  <div className="mt-2 text-xs text-gray-600">Uploaded: <a className="text-green-700 underline" href={vendorForm.bir.url} target="_blank" rel="noreferrer">View file</a></div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setVendorWizardOpen(false); }}>
                  Cancel
                </Button>
                <Button onClick={submitBirAndNext} className="bg-green-600 hover:bg-green-700 text-white">
                  Next
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Company Name</label>
                <Input
                  placeholder="Company Name"
                  value={vendorForm.company.name}
                  onChange={(e) => setVendorForm(prev => ({ ...prev, company: { ...prev.company, name: e.target.value } }))}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input
                  placeholder="Address line 1"
                  value={vendorForm.company.address.line1}
                  onChange={(e) => setVendorForm(prev => ({ ...prev, company: { ...prev.company, address: { ...prev.company.address, line1: e.target.value } } }))}
                />
                <Input
                  placeholder="Address line 2"
                  value={vendorForm.company.address.line2}
                  onChange={(e) => setVendorForm(prev => ({ ...prev, company: { ...prev.company, address: { ...prev.company.address, line2: e.target.value } } }))}
                />
                <Input
                  placeholder="City"
                  value={vendorForm.company.address.city}
                  onChange={(e) => setVendorForm(prev => ({ ...prev, company: { ...prev.company, address: { ...prev.company.address, city: e.target.value } } }))}
                />
                <Input
                  placeholder="Province"
                  value={vendorForm.company.address.province}
                  onChange={(e) => setVendorForm(prev => ({ ...prev, company: { ...prev.company, address: { ...prev.company.address, province: e.target.value } } }))}
                />
                <Input
                  placeholder="ZIP"
                  value={vendorForm.company.address.zip}
                  onChange={(e) => setVendorForm(prev => ({ ...prev, company: { ...prev.company, address: { ...prev.company.address, zip: e.target.value } } }))}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input
                  placeholder="Contact person"
                  value={vendorForm.contacts.name}
                  onChange={(e) => setVendorForm(prev => ({ ...prev, contacts: { ...prev.contacts, name: e.target.value } }))}
                />
                <Input
                  placeholder="Contact email"
                  value={vendorForm.contacts.email}
                  onChange={(e) => setVendorForm(prev => ({ ...prev, contacts: { ...prev.contacts, email: e.target.value } }))}
                />
                <Input
                  placeholder="Contact phone"
                  value={vendorForm.contacts.phone}
                  onChange={(e) => setVendorForm(prev => ({ ...prev, contacts: { ...prev.contacts, phone: e.target.value } }))}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setVendorStep('upload')}>Back</Button>
                <Button onClick={submitCompanyAndFinish} className="bg-green-600 hover:bg-green-700 text-white">Finish</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* NEW: Seller Sub-accounts */}
      {canCreateSub && (
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              <h3 className="text-sm font-semibold">Seller Sub-accounts</h3>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => { setManageOpen(true); loadMembers(); }}>
                View Sub Account
              </Button>
              <Button size="sm" onClick={() => setSubOpen(true)} className="bg-teal-600 hover:bg-teal-700 text-white"><UserPlus className="w-4 h-4 mr-1"/> New Sub-account</Button>
            </div>
          </div>
          <p className="text-xs text-gray-500">Create sub-accounts for Finance or Operations (Orders & Inventory). Sub-accounts cannot create further sub-accounts.</p>
        </div>
      )}

      <Dialog open={subOpen} onOpenChange={setSubOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Sub-account</DialogTitle>
            <DialogDescription>Invite a team member with limited access.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="block text-xs mb-1">Name</label>
              <Input value={subName} onChange={(e)=> setSubName(e.target.value)} placeholder="Full name" />
            </div>
            <div>
              <label className="block text-xs mb-1">Email</label>
              <Input type="email" value={subEmail} onChange={(e)=> setSubEmail(e.target.value)} placeholder="name@company.com" />
            </div>
            <div>
              <label className="block text-xs mb-1">Role Bundle</label>
              <select className="w-full p-2 border rounded" value={subBundle} onChange={(e)=> setSubBundle(e.target.value as any)}>
                <option value="ops">Order Management (Orders & Inventory)</option>
                <option value="finance">Finance (Withdrawal only)</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            {/* Permissions grid (for custom tweak) */}
            <div className="grid grid-cols-2 gap-2">
              {Object.keys(subPerms).filter(k => {
                // Match the filtering logic from the other dialog
                if ([
                  'bookings', 'notifications', 'confirmation', 'access', 'users', 'images', 'profile', 'withdrawal'
                ].includes(k)) return false;
                return true;
              }).map((k) => (
                <label key={k} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={(subPerms as any)[k]} onChange={(e)=> setSubPerms(p=>({ ...(p as any), [k]: e.target.checked }))} disabled={subBundle!=='custom'} />
                  <span className="capitalize">{k.replace('seller-orders','orders').replace('-', ' ')}</span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={()=> setSubOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateSub} disabled={subLoading} className="bg-teal-600 hover:bg-teal-700 text-white">
              {subLoading ? 'Sending…' : 'Create & Send Invite'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-account Success Dialog */}
      <Dialog open={subSuccessOpen} onOpenChange={setSubSuccessOpen}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden rounded-3xl border border-gray-100 shadow-xl bg-white">
          <div className="p-7 text-center flex flex-col items-center">
            {/* Icon wrapper */}
            <div className="h-16 w-16 rounded-2xl bg-green-50 flex items-center justify-center shadow-inner mb-5">
              <CheckCircle className="h-10 w-10 text-green-500" />
            </div>

            {/* Header */}
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-[20px] font-semibold text-gray-900 tracking-wide">
                Sub-account Invited!
              </DialogTitle>
              <DialogDescription className="text-sm text-gray-600 mt-2">
                You invited <span className="font-semibold text-gray-900">{invitedSubName}</span> with email <span className="font-semibold text-gray-900">{invitedSubEmail}</span>
              </DialogDescription>
              <p className="text-xs text-gray-500 mt-3">
                A password reset email has been sent to set up their account.
              </p>
            </DialogHeader>

            {/* Footer */}
            <DialogFooter className="w-full mt-6">
              <Button 
                onClick={() => setSubSuccessOpen(false)} 
                className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 rounded-xl"
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Platform Fee Edit Modal */}
      <Dialog open={platformFeeModalOpen} onOpenChange={setPlatformFeeModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Platform Fee</DialogTitle>
            <DialogDescription>
              {editingPlatformFee && (
                <span>Update platform fee percentage for <strong>{editingPlatformFee.username}</strong></span>
              )}
            </DialogDescription>
          </DialogHeader>
          
          {editingPlatformFee && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Current Fee: <span className="text-green-600 font-semibold">{editingPlatformFee.currentFee}%</span>
                </label>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  New Platform Fee Percentage (%)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={platformFeeValue}
                  onChange={(e) => setPlatformFeeValue(e.target.value)}
                  placeholder="Enter percentage (e.g., 8.88)"
                  className="w-full"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Default is 8.88%. Enter a value between 0 and 100.
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="mt-6">
            <Button 
              variant="outline" 
              onClick={() => {
                setPlatformFeeModalOpen(false);
                setEditingPlatformFee(null);
              }}
              disabled={platformFeeSaving}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSavePlatformFee} 
              disabled={platformFeeSaving}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {platformFeeSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">Delete User</DialogTitle>
            <DialogDescription className="text-gray-600 mt-2">
              Are you sure you want to delete <span className="font-semibold text-gray-900">{userToDelete?.username}</span>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          
          <DialogFooter className="mt-6 gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                setDeleteModalOpen(false);
                setUserToDelete(null);
              }}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button 
              onClick={confirmDeleteUser}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Success Dialog */}
      <Dialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <div className="text-center py-6">
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
              <CheckCircle className="h-10 w-10 text-green-600" />
            </div>
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold text-gray-900 text-center">
                Successfully Sent Invite
              </DialogTitle>
            </DialogHeader>
            {successUserData && (
              <div className="mt-4 space-y-2 text-center">
                <p className="text-gray-700">
                  Invitation has been sent to:
                </p>
                <p className="font-semibold text-gray-900 text-lg">
                  {successUserData.username}
                </p>
                <p className="text-sm text-gray-600">
                  with email: <span className="font-medium text-gray-900">{successUserData.email}</span>
                </p>
              </div>
            )}
          </div>
          
          <DialogFooter className="mt-4">
            <Button 
              onClick={() => {
                setSuccessDialogOpen(false);
                setSuccessUserData(null);
              }}
              className="w-full bg-green-600 hover:bg-green-700 text-white"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AccessTab;
