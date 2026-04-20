import {
  collection,
  doc,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import type { Voucher, CreateVoucherInput, UpdateVoucherInput } from '@/types/voucher';

const VOUCHERS_COLLECTION = 'Vouchers';

function vouchersCol() {
  return collection(db, VOUCHERS_COLLECTION);
}

function voucherDoc(voucherId: string) {
  return doc(db, VOUCHERS_COLLECTION, voucherId);
}

export async function createVoucher(
  sellerId: string,
  input: CreateVoucherInput
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const isUnique = await checkVoucherCodeUnique(sellerId, input.code);
    if (!isUnique) {
      return { success: false, error: 'Voucher code already exists' };
    }

    const now = new Date().toISOString();
    const data = {
      sellerId,
      name: input.name.trim(),
      code: input.code.toUpperCase().trim(),
      discountType: input.discountType,
      discountValue: input.discountValue,
      ...(input.maximumSpend !== undefined ? { maximumSpend: input.maximumSpend } : {}),
      minimumOrderAmount: input.minimumOrderAmount,
      maxUses: input.maxUses,
      usedCount: 0,
      startDate: input.startDate,
      endDate: input.endDate,
      status: 'active' as const,
      scope: input.scope,
      ...(input.scope === 'specific' && input.productIds ? { productIds: input.productIds } : {}),
      createdAt: now,
      updatedAt: now,
      ...(auth.currentUser?.email ? { createdBy: auth.currentUser.email } : {}),
      ...(auth.currentUser?.displayName ? { createdByName: auth.currentUser.displayName } : {}),
    };

    const docRef = await addDoc(vouchersCol(), data);
    return { success: true, id: docRef.id };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to create voucher' };
  }
}

export async function getSellerVouchers(sellerId: string): Promise<Voucher[]> {
  // Note: avoid combining where + orderBy to skip Firestore composite index requirement.
  const q = query(vouchersCol(), where('sellerId', '==', sellerId));
  const snap = await getDocs(q);
  const vouchers = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Voucher));
  // Sort client-side by createdAt desc
  vouchers.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return vouchers;
}

export async function updateVoucher(
  sellerId: string,
  voucherId: string,
  input: UpdateVoucherInput
): Promise<{ success: boolean; error?: string }> {
  try {
    if (input.code) {
      const isUnique = await checkVoucherCodeUnique(sellerId, input.code, voucherId);
      if (!isUnique) {
        return { success: false, error: 'Voucher code already exists' };
      }
      input.code = input.code.toUpperCase().trim();
    }
    if (input.name) input.name = input.name.trim();

    await updateDoc(voucherDoc(voucherId), { ...input, updatedAt: new Date().toISOString() });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to update voucher' };
  }
}

export async function toggleVoucherStatus(
  sellerId: string,
  voucherId: string,
  newStatus: 'active' | 'inactive'
): Promise<{ success: boolean; error?: string }> {
  return updateVoucher(sellerId, voucherId, { status: newStatus });
}

export async function deleteVoucher(
  sellerId: string,
  voucherId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await deleteDoc(voucherDoc(voucherId));
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to delete voucher' };
  }
}

export async function cloneVoucher(
  sellerId: string,
  source: Voucher
): Promise<{ success: boolean; id?: string; error?: string }> {
  const clonedCode = `${source.code}-COPY`;
  return createVoucher(sellerId, {
    name: `${source.name} (Copy)`,
    code: clonedCode,
    discountType: source.discountType,
    discountValue: source.discountValue,
    minimumOrderAmount: source.minimumOrderAmount,
    maxUses: source.maxUses,
    startDate: source.startDate,
    endDate: source.endDate,
    scope: source.scope,
    productIds: source.productIds,
  });
}

export async function bulkEndVouchers(
  sellerId: string,
  voucherIds: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const batch = writeBatch(db);
    const now = new Date().toISOString();
    for (const id of voucherIds) {
      batch.update(voucherDoc(id), { status: 'inactive', updatedAt: now });
    }
    await batch.commit();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Bulk end failed' };
  }
}

export async function bulkDeleteVouchers(
  sellerId: string,
  voucherIds: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const batch = writeBatch(db);
    for (const id of voucherIds) {
      batch.delete(voucherDoc(id));
    }
    await batch.commit();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Bulk delete failed' };
  }
}

export async function bulkExtendExpiry(
  sellerId: string,
  voucherIds: string[],
  newEndDate: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const batch = writeBatch(db);
    const now = new Date().toISOString();
    for (const id of voucherIds) {
      batch.update(voucherDoc(id), { endDate: newEndDate, updatedAt: now });
    }
    await batch.commit();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Bulk extend failed' };
  }
}

export async function checkVoucherCodeUnique(
  sellerId: string,
  code: string,
  excludeId?: string
): Promise<boolean> {
  const q = query(vouchersCol(), where('sellerId', '==', sellerId), where('code', '==', code.toUpperCase().trim()));
  const snap = await getDocs(q);
  if (snap.empty) return true;
  if (excludeId) {
    return snap.docs.every((d) => d.id === excludeId);
  }
  return false;
}
