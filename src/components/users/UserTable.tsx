import React, { useEffect, useState } from "react";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { User } from "./types";
import { StatusBadge } from "./badges";
import { Pencil, Eye, Trash2, Calendar, Phone, User as UserIcon, Lock, Unlock, MailCheck } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

function approvalClass(status: User['sellerApprovalStatus']) {
  switch (status) {
    case 'pending':
      return 'bg-yellow-100 text-yellow-800';
    case 'approved':
      return 'bg-green-100 text-green-800';
    case 'rejected':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-white text-foreground border';
  }
}

export default function UserTable({
  users,
  selected,
  onSelect,
  onSelectAll,
  onView,
  onEdit,
  onDelete,
  onChangeSellerApproval,
  onToggleStatus,
  onVerifyEmail,
}: {
  users: User[];
  selected: string[];
  onSelect: (id: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
  onView: (u: User) => void;
  onEdit: (u: User) => void;
  onDelete: (id: string) => void;
  onChangeSellerApproval: (id: string, status: User["sellerApprovalStatus"]) => void;
  onToggleStatus: (id: string, currentStatus: User['status']) => void;
  onVerifyEmail: (id: string, email: string) => void;
}) {
  // VIEW MODAL STATE
  const [viewUserId, setViewUserId] = useState<string | null>(null);
  const [viewUserData, setViewUserData] = useState<any | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!viewUserId) { setViewUserData(null); return; }
      setViewLoading(true); setViewError(null);
      try {
        // Changed collection name from 'web_users' to 'User'
        const snap = await getDoc(doc(db, 'User', viewUserId));
        if (!snap.exists()) { if (!cancelled) setViewError('User not found'); return; }
        const data = snap.data();
        if (!cancelled) setViewUserData({ id: viewUserId, ...data });
      } catch (e) {
        if (!cancelled) setViewError('Failed to load user');
      } finally {
        if (!cancelled) setViewLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [viewUserId]);

  const maskContact = (raw: any) => {
    if (!raw) return '—';
    const digits = String(raw).replace(/[^0-9]/g,'');
    if (digits.length < 10) return raw;
    return digits.slice(0,2) + '******' + digits.slice(-3);
  };

  // Mask user name for privacy: "Michael John Garcia" -> "M**** J*** G****"
  const maskName = (firstName?: string, lastName?: string) => {
    const maskWord = (word: string) => {
      if (!word || word.length === 0) return '';
      if (word.length === 1) return word; // Single letter stays visible
      return word[0] + '*'.repeat(word.length - 1);
    };
    
    const first = maskWord(firstName?.trim() || '');
    const last = maskWord(lastName?.trim() || '');
    
    if (!first && !last) return 'Unknown User';
    if (!last) return first;
    if (!first) return last;
    return `${first} ${last}`;
  };

  const fmtDate = (val: any) => {
    if (!val) return '—';
    try {
      let d: Date;
      if (val?.toDate) d = val.toDate(); else d = new Date(val);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch { return '—'; }
  };

  const fmtDateTime = (val: any) => {
    if (!val) return '—';
    try {
      let d: Date;
      if (val?.toDate) d = val.toDate(); else d = new Date(val);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return '—'; }
  };

  return (
    <div className="overflow-x-auto">
      <Table className="">
        <TableHeader>
          <TableRow>
            <TableHead>
              <Checkbox
                checked={selected.length === users.length && users.length > 0}
                onCheckedChange={onSelectAll}
              />
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Reward Points</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id} className="hover:bg-muted/40">
              <TableCell>
                <Checkbox
                  checked={selected.includes(u.id)}
                  onCheckedChange={(c) => onSelect(u.id, !!c)}
                />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={(u as any).photoURL} alt={maskName(u.firstName, u.lastName)} />
                    <AvatarFallback>{(u.firstName?.[0] ?? 'U')}{(u.lastName?.[0] ?? '')}</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col">
                    <span className="font-medium leading-tight">{maskName(u.firstName, u.lastName)}</span>
                    <span className="text-xs text-muted-foreground leading-tight">{u.email}</span>
                  </div>
                </div>
              </TableCell>
          
              <TableCell>
                <StatusBadge status={u.status} />
              </TableCell>
              <TableCell className="text-right">{u.rewardPoints ?? 0}</TableCell>
              <TableCell className="text-right">
                <TooltipProvider>
                  <div className="flex justify-end gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => onEdit(u)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Edit</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="View"
                          onClick={() => { /* removed onView(u) to avoid second dialog */ setViewUserId(u.id); }}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>View</TooltipContent>
                    </Tooltip>
                    
                    {/* Only show lock/unlock for active or inactive users */}
                    {(u.status === 'active' || u.status === 'inactive') && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            aria-label={u.status === 'active' ? 'Disable Account' : 'Enable Account'}
                            onClick={() => onToggleStatus(u.id, u.status)}
                            className={u.status === 'active' ? 'text-amber-600 hover:text-amber-800' : 'text-green-600 hover:text-green-800'}
                          >
                            {u.status === 'active' ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{u.status === 'active' ? 'Disable Account' : 'Enable Account'}</TooltipContent>
                      </Tooltip>
                    )}
                    
                    {/* Verify Email Button */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          aria-label="Verify Email"
                          onClick={() => onVerifyEmail(u.id, u.email)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          <MailCheck className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Verify Email</TooltipContent>
                    </Tooltip>
                    
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => onDelete(u.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete</TooltipContent>
                    </Tooltip>
                  </div>
                </TooltipProvider>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* VIEW MODAL */}
      {viewUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { setViewUserId(null); setViewUserData(null); }} />
          <div className="relative w-full max-w-xl mx-4">
            <div className="rounded-3xl shadow-2xl overflow-hidden border border-gray-200 bg-white animate-fade-in">
              {/* Header */}
              <div className="bg-gradient-to-r from-teal-600 via-teal-500 to-teal-400 px-6 pt-6 pb-4 text-white relative">
                <button
                  aria-label="Close"
                  onClick={() => { setViewUserId(null); setViewUserData(null); }}
                  className="absolute top-4 right-4 text-white/80 hover:text-white transition"
                >✕</button>
                <div className="flex items-start gap-5">
                  <div className="relative">
                    <Avatar className="h-20 w-20 rounded-2xl ring-4 ring-white/30 shadow-lg">
                      <AvatarImage src={viewUserData?.photoURL} alt={maskName(viewUserData?.firstName, viewUserData?.lastName)} />
                      <AvatarFallback className="text-lg bg-white/20 text-white font-semibold">
                        {(viewUserData?.firstName?.[0] ?? 'U')}{(viewUserData?.lastName?.[0] ?? '')}
                      </AvatarFallback>
                    </Avatar>
                    {viewUserData?.gender && (
                      <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[10px] px-2 py-1 rounded-full bg-white/90 text-teal-710 shadow" title="Gender">
                        {String(viewUserData.gender).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-semibold leading-tight truncate">{maskName(viewUserData?.firstName, viewUserData?.lastName)}</h2>
                    <p className="text-sm text-white/80 truncate">{viewUserData?.email}</p>
                    <div className="mt-2 inline-flex items-center gap-2 text-xs bg-white/15 backdrop-blur px-3 py-1 rounded-full">
                      <span className="font-medium tracking-wide">ID</span>
                      <span className="opacity-90">{viewUserId}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 space-y-6">
                {viewLoading && (
                  <div className="space-y-4">
                    <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
                    <div className="grid grid-cols-2 gap-4">
                      {Array.from({ length: 6 }).map((_,i) => (
                        <div key={i} className="space-y-2">
                          <div className="h-3 w-20 bg-gray-100 rounded animate-pulse" />
                          <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {viewError && (
                  <div className="text-center py-6 text-sm text-red-600 bg-red-50 rounded-xl border border-red-100">{viewError}</div>
                )}
                {!viewLoading && !viewError && viewUserData && (
                  <>
                    {/* Primary Info Grid */}
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-1">
                        <div className="text-[11px] font-medium text-gray-500 tracking-wide flex items-center gap-1"><Phone className="w-3 h-3" />Contact</div>
                        <div className="text-sm font-medium text-gray-900">{maskContact(viewUserData.phoneNumber || viewUserData.contactNumber || viewUserData.contact || viewUserData.mobile || viewUserData.phone)}</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[11px] font-medium text-gray-500 tracking-wide flex items-center gap-1"><UserIcon className="w-3 h-3" />Gender</div>
                        <div className="text-sm font-medium text-gray-900">{viewUserData.gender || '—'}</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[11px] font-medium text-gray-500 tracking-wide flex items-center gap-1"><Calendar className="w-3 h-3" />Birthdate</div>
                        <div className="text-sm font-medium text-gray-900">{fmtDate(viewUserData.birthdate || viewUserData.birthday || viewUserData.dob)}</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[11px] font-medium text-gray-500 tracking-wide">Reward Points</div>
                        <div className="text-sm font-semibold text-teal-700">{(viewUserData.rewardPoints ?? 0).toLocaleString()}</div>
                      </div>
                    </div>

                    {/* Meta Section */}
                    <div className="grid grid-cols-2 gap-6 pt-4 border-t border-gray-100">
                      <div className="space-y-1">
                        <div className="text-[11px] font-medium text-gray-500 tracking-wide">Created At</div>
                        <div className="text-xs font-medium text-gray-800 bg-gray-50 rounded-md px-2 py-1 inline-block">{fmtDateTime(viewUserData.createdAt)}</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[11px] font-medium text-gray-500 tracking-wide">Last Updated</div>
                        <div className="text-xs font-medium text-gray-800 bg-gray-50 rounded-md px-2 py-1 inline-block">{fmtDateTime(viewUserData.updatedAt)}</div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 pb-6 -mt-2 flex justify-end">
                <Button variant="secondary" onClick={() => { setViewUserId(null); setViewUserData(null); }} className="text-xs rounded-full px-4">Close</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}