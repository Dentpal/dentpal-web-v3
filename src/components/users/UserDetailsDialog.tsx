import React, { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { User } from "./types";
import { formatDate, formatCurrency } from "./formatters";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "./badges";
import { updateUserRewardPoints } from "@/services/userService";

// Mask user name for privacy: "Michael John Garcia" -> "M**** J*** G****"
const maskName = (firstName?: string, middleName?: string, lastName?: string) => {
  const maskWord = (word: string) => {
    if (!word || word.length === 0) return '';
    if (word.length === 1) return word; // Single letter stays visible
    return word[0] + '*'.repeat(word.length - 1);
  };
  
  const parts = [
    maskWord(firstName?.trim() || ''),
    maskWord(middleName?.trim() || ''),
    maskWord(lastName?.trim() || '')
  ].filter(Boolean);
  
  return parts.length > 0 ? parts.join(' ') : 'Unknown User';
};


export default function UserDetailsDialog ({ user, open, onClose }: { user: User | null; open: boolean ; onClose: () => void}) {
  const [saving, setSaving] = useState(false);
  const [points, setPoints] = useState<string>(user ? String(user.rewardPoints ?? 0) : "0");

  React.useEffect(() => {
    setPoints(user ? String(user.rewardPoints ?? 0) : "0");
  }, [user]);

  if (!user) return null;

  const fullName = maskName(user.firstName, user.middleName, user.lastName);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateUserRewardPoints(user.id, Number(points || 0));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>User details</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-1">
            <Card>
              <CardContent className="pt-6 flex flex-col items-center gap-3">
                <Avatar className="h-24 w-24">
                  <AvatarImage src={(user as any).photoURL} alt={fullName} />
                  <AvatarFallback>{(user.firstName?.[0] ?? 'U')}{(user.lastName?.[0] ?? '')}</AvatarFallback>
                </Avatar>
                <div className="text-center">
                  <div className="text-lg font-semibold">{fullName || user.email}</div>
                  <div className="text-sm text-muted-foreground">{user.email}</div>
                </div>
                <div className="mt-2"><StatusBadge status={user.status} /></div>
              </CardContent>
            </Card>
          </div>

          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Contact number</Label>
                  <div className="mt-1">{user.contactNumber || '—'}</div>
                </div>
                <div>
                  <Label>Created at</Label>
                  <div className="mt-1">{formatDate(user.createdAt)}</div>
                </div>
                <div>
                  <Label>Last updated</Label>
                  <div className="mt-1">{formatDate((user as any).lastActivity ?? (user as any).updatedAt)}</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div>
                  <Label>Reward points</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    min={0}
                    value={points}
                    onChange={(e) => setPoints(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Close</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}