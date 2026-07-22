import React, { useState, useMemo, useEffect } from "react";
import UserSummaryCards from "./UserSummaryCards";
import UserFilters from "./UserFilters";
import UserTable from "./UserTable";
import UserDetailsDialog from "./UserDetailsDialog";
import ResetPointsDialog from "./ResetPointsDialog";
import { User, Filters } from "./types";
import { useUserRealtime } from "@/hooks/useUser";
import { updateUserSellerApproval, deleteUser, updateUserStatus, verifyUserEmail } from "@/services/userService";
import { getProvinces as getPhProvinces } from '@/lib/phLocations';
import { Button } from "@/components/ui/button";
import { Download, FileText, FileSpreadsheet } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';


export default function UsersTab() {
  const { users, loading, resetPoints } = useUserRealtime();
  const { toast } = useToast();
  const [filters, setFilters] = useState<Filters>({search:'', province:'all', specialty:'all', status:'all'});
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedUser, setSelectedUser] = useState<User|null>(null);
  const [isResetOpen, setResetOpen] = useState(false);
  const [phProvinces, setPhProvinces] = useState<Array<{ code: string; name: string }>>([]);

  useEffect(() => {
    (async () => {
      try {
        const provinces = await getPhProvinces();
        console.log('[UsersTab] Loaded provinces:', provinces.length, provinces.slice(0, 5));
        
        const hasMetroManila = provinces.some(p => 
          p.name.toLowerCase().includes('metro manila') || 
          p.code === 'NCR' ||
          p.code === 'METRO_MANILA'
        );
        
        if (!hasMetroManila) {
          provinces.unshift({ code: 'METRO_MANILA', name: 'Metro Manila' });
          console.log('[UsersTab] Added Metro Manila to province list');
        }
        
        setPhProvinces(provinces);
      } catch (error) {
        console.error('Failed to load provinces:', error);
        setPhProvinces([{ code: 'METRO_MANILA', name: 'Metro Manila' }]);
      }
    })();
  }, []);

  async function handleConfirmReset() {
    if (selected.length === 0) return;
    try {
      await resetPoints(selected); // bulk or single
    } catch (err) {
      console.error('Failed to reset points', err);
    } finally {
      setResetOpen(false);
      setSelected([]);
    }
  }

  const handleChangeSellerApproval = async (id: string, status: User['sellerApprovalStatus']) => {
    try {
      await updateUserSellerApproval(id, status);
    } catch (e) {
      console.error('Failed to update seller approval status', e);
    }
  };

  const handleToggleUserStatus = async (id: string, currentStatus: User['status']) => {

    if (currentStatus !== 'active' && currentStatus !== 'inactive') {
      console.warn(`Cannot toggle status for user ${id}: current status '${currentStatus}' is not 'active' or 'inactive'`);
      toast({ 
        title: 'Cannot toggle status', 
        description: `Users with '${currentStatus}' status cannot be toggled. Only 'active' and 'inactive' users can be toggled.`, 
        variant: 'destructive' 
      });
      return;
    }

    try {
      const newStatus: User['status'] = currentStatus === 'active' ? 'inactive' : 'active';
      await updateUserStatus(id, newStatus);
      toast({ 
        title: 'Status updated', 
        description: `User account has been ${newStatus === 'active' ? 'activated' : 'deactivated'} successfully. ${newStatus === 'inactive' ? 'The user will no longer be able to log in.' : 'The user can now log in again.'}`,
      });
    } catch (e) {
      console.error('Failed to toggle user status', e);
      toast({ 
        title: 'Failed to update status', 
        description: e instanceof Error ? e.message : 'Please try again.', 
        variant: 'destructive' 
      });
    }
  };

  const handleDeleteUser = async (id: string) => {
    try {
      await deleteUser(id);
      setSelected(prev => prev.filter(sid => sid !== id));
    } catch (e) {
      console.error('Failed to delete user', e);
    }
  };

  const handleVerifyEmail = async (id: string, email: string) => {
    try {
      await verifyUserEmail(id);
      toast({ 
        title: 'Email verified', 
        description: `Email address for ${email} has been manually verified successfully.`,
      });
    } catch (e) {
      console.error('Failed to verify user email', e);
      toast({ 
        title: 'Failed to verify email', 
        description: e instanceof Error ? e.message : 'Please try again.', 
        variant: 'destructive' 
      });
    }
  };

  const formatCreatedAt = (createdAt: any): string => {
    if (!createdAt) return '';
    let date: Date | null = null;
    if (typeof createdAt?.toDate === 'function') {
      date = createdAt.toDate(); // Firestore Timestamp
    } else if (typeof createdAt?.seconds === 'number') {
      date = new Date(createdAt.seconds * 1000);
    } else if (typeof createdAt === 'number' || typeof createdAt === 'string') {
      date = new Date(createdAt);
    } else if (createdAt instanceof Date) {
      date = createdAt;
    }
    if (!date || isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const exportToCSV = () => {
    const usersToExport = selected.length > 0
      ? filtered.filter(u => selected.includes(u.id))
      : filtered;

    if (usersToExport.length === 0) {
      alert('No users to export. Please select users or ensure filters show results.');
      return;
    }

    const data = usersToExport.map(u => ({
      'Account ID': u.accountId || '',
      'Name': `${u.firstName || ''} ${u.lastName || ''}`.trim(),
      'Email': u.email || '',
      'Specialty': Array.isArray(u.specialty) ? u.specialty.join(', ') : (u.specialty || 'N/A'),
      'Contact Number': u.contactNumber || '',
      'Created At': formatCreatedAt(u.createdAt),
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');

    const filename = selected.length > 0 
      ? `selected_users_${new Date().toISOString().slice(0, 10)}.csv`
      : `all_users_${new Date().toISOString().slice(0, 10)}.csv`;

    XLSX.writeFile(wb, filename, { bookType: 'csv' });
  };

  const exportToPDF = () => {
    const usersToExport = selected.length > 0 
      ? filtered.filter(u => selected.includes(u.id))
      : filtered;

    if (usersToExport.length === 0) {
      alert('No users to export. Please select users or ensure filters show results.');
      return;
    }

    const doc = new jsPDF('landscape');

    doc.setFontSize(16);
    doc.text('Users Report', 14, 15);

    doc.setFontSize(10);
    const exportDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    doc.text(`Export Date: ${exportDate}`, 14, 22);
    doc.text(`Total Users: ${usersToExport.length}`, 14, 28);
    if (selected.length > 0) {
      doc.text(`(Showing ${selected.length} selected users)`, 14, 34);
    }

    const tableData = usersToExport.map(u => [
      u.accountId || '',
      `${u.firstName || ''} ${u.lastName || ''}`.trim(),
      u.email || '',
      Array.isArray(u.specialty) ? u.specialty.join(', ') : (u.specialty || 'N/A'),
      u.contactNumber || '',
      formatCreatedAt(u.createdAt),
    ]);

    autoTable(doc, {
      head: [['Account ID', 'Name', 'Email', 'Specialty', 'Contact Number', 'Created At']],
      body: tableData,
      startY: selected.length > 0 ? 40 : 34,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [13, 148, 136] }, // Teal color
    });

    const filename = selected.length > 0 
      ? `selected_users_${new Date().toISOString().slice(0, 10)}.pdf`
      : `all_users_${new Date().toISOString().slice(0, 10)}.pdf`;

    doc.save(filename);
  };

  const getUserProvince = (user: User): string | null => {

    const findProvinceCode = (provinceName: string): string | null => {
      if (!provinceName) return null;
      const normalized = provinceName.toLowerCase().trim();
      
      if (normalized === 'metro manila' || normalized === 'ncr' || normalized.includes('national capital region')) {
        return 'METRO_MANILA';
      }
      
      const match = phProvinces.find(p => 
        p.name.toLowerCase() === normalized ||
        p.code === provinceName || 
        p.code.toLowerCase() === normalized
      );
      return match ? match.code : null;
    };

    if (user.addresses && Array.isArray(user.addresses) && user.addresses.length > 0) {
      const defaultAddress = user.addresses.find((addr: any) => addr?.isDefault === true);
      if (defaultAddress) {
        if (defaultAddress.provinceCode) return defaultAddress.provinceCode;
        if (defaultAddress.province) {
          const code = findProvinceCode(defaultAddress.province);
          if (code) return code;
        }
        
        if (defaultAddress.state) {
          const code = findProvinceCode(defaultAddress.state);
          if (code) return code;
        }
        if (defaultAddress.country === 'Philippines' && defaultAddress.state) {
          const code = findProvinceCode(defaultAddress.state);
          if (code) return code;
        }
      }
      
      for (const addr of user.addresses) {
        if (addr?.provinceCode) return addr.provinceCode;
        if (addr?.province) {
          const code = findProvinceCode(addr.province);
          if (code) return code;
        }
        if (addr?.state) {
          const code = findProvinceCode(addr.state);
          if (code) return code;
        }
      }
    }
    
    if (user.shippingAddresses && Array.isArray(user.shippingAddresses) && user.shippingAddresses.length > 0) {
      for (const addr of user.shippingAddresses) {
        if (typeof addr === 'object' && addr !== null) {
          const a = addr as any;
          if (a.isDefault === true) {
            if (a.provinceCode) return a.provinceCode;
            if (a.province) {
              const code = findProvinceCode(a.province);
              if (code) return code;
            }
            if (a.state) {
              const code = findProvinceCode(a.state);
              if (code) return code;
            }
          }
        }
      }
      const firstObj = user.shippingAddresses.find(addr => typeof addr === 'object' && addr !== null) as any;
      if (firstObj) {
        if (firstObj.provinceCode) return firstObj.provinceCode;
        if (firstObj.province) {
          const code = findProvinceCode(firstObj.province);
          if (code) return code;
        }
        if (firstObj.state) {
          const code = findProvinceCode(firstObj.state);
          if (code) return code;
        }
      }
    }
    
    return null;
  };

  const specialties = useMemo(() => {
    const allSpecialties = users.flatMap(u => u.specialty || []);
    const uniqueSpecialties = Array.from(new Set(allSpecialties)).filter(Boolean);
    console.log('[UsersTab] Loaded specialties from Firebase User > specialty (array):', uniqueSpecialties);
    console.log('[UsersTab] Sample users with specialty:', users.slice(0, 3).map(u => ({ 
      id: u.id, 
      email: u.email, 
      specialty: u.specialty 
    })));
    return uniqueSpecialties;
  }, [users]);

  const filtered = useMemo(() => {
    const q = (filters.search || '').trim().toLowerCase();
    const result = users.filter(u => {
      const matchesSearch =
        q === '' ||
        (u.accountId ?? '').toLowerCase().includes(q) ||
        `${u.firstName ?? ''} ${u.lastName ?? ''}`.toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q);
      const matchesStatus = filters.status === 'all' || u.status === filters.status;
      const matchesSpecialty = filters.specialty === 'all' || (u.specialty || []).includes(filters.specialty);
      
      if (filters.specialty !== 'all' && u === users[0]) {
        console.log('[UsersTab] Specialty Filter Debug:', {
          filterSpecialty: filters.specialty,
          userSpecialties: u.specialty,
          matches: matchesSpecialty,
          userEmail: u.email
        });
      }
      
      const userProvince = getUserProvince(u);
      const matchesProvince = 
        filters.province === 'all' || 
        userProvince === filters.province;
      
      if (filters.province !== 'all' && u === users[0]) {
        console.log('[UsersTab] Province Filter Debug:', {
          filterProvince: filters.province,
          filterProvinceName: phProvinces.find(p => p.code === filters.province)?.name,
          userProvince: userProvince,
          userProvinceName: phProvinces.find(p => p.code === userProvince)?.name,
          matches: matchesProvince,
          userEmail: u.email,
          addresses: u.addresses,
          shippingAddresses: u.shippingAddresses
        });
      }
      
      return matchesSearch && matchesStatus && matchesSpecialty && matchesProvince;
    });
    
    console.log(`[UsersTab] Filtered ${result.length} users out of ${users.length} (province: ${filters.province})`);
    return result;
  }, [users, filters, phProvinces]);

  const ITEMS_PER_PAGE = 15;
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [filters]);

  if (loading) {
    return <div className="py-8 text-center">Loading users...</div>;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  const onSelect = (id:string, checked:boolean) => setSelected(prev => checked ? [...prev,id] : prev.filter(p=>p!==id));
  const onSelectAll = (checked:boolean) => setSelected(checked ? filtered.map(u=>u.id) : []);
  const onView = (u:User) => setSelectedUser(u);
  const onEdit = (u:User) => setSelectedUser(u);

  return (
    <div className="space-y-6">
      <UserSummaryCards totalUsers={filtered.length} activeUsers={filtered.filter(u=>u.status==='active').length} totalRevenue={filtered.reduce((s,u)=>s+u.totalSpent,0)} totalOrders={filtered.reduce((s,u)=>s+u.totalTransactions,0)} />
      
      {/* Filters with Export Button */}
      <div className="flex items-end gap-4">
        <div className="flex-1">
          <UserFilters filters={filters} provinces={phProvinces} specialties={specialties} onChange={setFilters} />
        </div>
        <div className="flex items-center gap-2">
          {selected.length > 0 && (
            <span className="text-sm text-gray-600 mr-2">
              {selected.length} selected
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="flex items-center gap-2">
                <Download className="w-4 h-4" />
                <span>Export</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportToCSV} className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4" /> 
                {selected.length > 0 ? `Export Selected (${selected.length}) as CSV` : 'Export All as CSV'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportToPDF} className="flex items-center gap-2">
                <FileText className="w-4 h-4" /> 
                {selected.length > 0 ? `Export Selected (${selected.length}) as PDF` : 'Export All as PDF'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      
      <UserTable
        users={paginated}
        selected={selected}
        onSelect={onSelect}
        onSelectAll={onSelectAll}
        onView={onView}
        onEdit={onEdit}
        onDelete={handleDeleteUser}
        onChangeSellerApproval={handleChangeSellerApproval}
        onToggleStatus={handleToggleUserStatus}
        onVerifyEmail={handleVerifyEmail}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border rounded-lg bg-gray-50">
          <span className="text-xs text-gray-500">
            Page {safePage} of {totalPages} ({filtered.length} user{filtered.length !== 1 ? 's' : ''})
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="px-3 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="px-3 py-1 text-xs rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <UserDetailsDialog user={selectedUser} open={!!selectedUser} onClose={()=>setSelectedUser(null)} />
      <ResetPointsDialog open={isResetOpen} label={selected.length ? `${selected.length} users` : 'user'} onCancel={()=>setResetOpen(false)} onConfirm={handleConfirmReset} />
    </div>
  );
}