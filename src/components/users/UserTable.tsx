import React, { useState } from "react";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { User } from "./types";
import { StatusBadge } from "./badges";
import { Pencil, Eye, Trash2, Lock, Unlock, MailCheck } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { maskName } from "./formatters";
import UserDetailModal from "./UserDetailModal";

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
  const [viewUserId, setViewUserId] = useState<string | null>(null);

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
                          onClick={() => setViewUserId(u.id)}
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

      <UserDetailModal userId={viewUserId} onClose={() => setViewUserId(null)} />
    </div>
  );
}
