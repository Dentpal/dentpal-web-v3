import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import type { Voucher, CreateVoucherInput, UpdateVoucherInput } from '@/types/voucher';
import SellersService from '@/services/sellers';

const formatTermsDate = (iso: string): string => {
  if (!iso) return iso;
  try {
    return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
};

export function generateVoucherTerms(v: {
  name: string;
  code: string;
  discountType: Voucher['discountType'];
  discountValue: number;
  maximumSpend?: number;
  minimumOrderAmount: number;
  maxUses: number;
  usedCount: number;
  startDate: string;
  endDate: string;
  status: Voucher['status'];
  scope: Voucher['scope'];
  sellerId: string;
  sellerName?: string;
  createdAt: string;
  updatedAt: string;
}): string {
  const valueText =
    v.discountType === 'free_delivery'
      ? 'free delivery'
      : v.discountType === 'percentage'
        ? `${v.discountValue}% off`
        : `PHP ${v.discountValue} off`;

  const usageLimitText =
    v.maxUses === 0
      ? 'This voucher has no maximum redemption limit, unless otherwise specified.'
      : `This voucher may be redeemed up to ${v.maxUses} times in total across all users, unless otherwise specified.`;

  const scopeText =
    v.scope === 'all'
      ? 'This voucher is valid for all products and categories offered by the specified seller, unless otherwise excluded.'
      : 'This voucher is valid only for selected products from the specified seller.';

  const maxSpendText =
    v.maximumSpend !== undefined
      ? `This voucher is applicable only to orders with a total value of up to PHP ${v.maximumSpend}.\nOrders exceeding this amount will not qualify for the discount.`
      : 'No maximum order value restriction applies to this voucher.';

  const sellerLabel = v.sellerName?.trim() || v.sellerId;

  return `Voucher Name: ${v.name}
Promo Code: ${v.code}

1. Discount Offer
This voucher entitles the user to ${valueText} on eligible items from the specified seller.

2. Validity Period
This voucher is valid from ${formatTermsDate(v.startDate)} to ${formatTermsDate(v.endDate)}, inclusive.
Redemptions outside this period will not be honored.

3. Minimum Purchase Requirement
A minimum purchase of PHP ${v.minimumOrderAmount} is required to apply this voucher.

4. Maximum Order Value Eligibility
${maxSpendText}

5. Usage Limit
${usageLimitText}

6. Applicable Scope
${scopeText}

7. Seller Restriction
This voucher is valid only for purchases made from ${sellerLabel} on the platform.

8. General Conditions
- This voucher is non-transferable and cannot be exchanged for cash.
- Only one voucher may be used per transaction.
- This voucher cannot be combined with other promotions unless explicitly stated.
- The platform reserves the right to reject or cancel orders found to be fraudulent or in violation of these terms.
- Abuse, misuse, or suspicious activity may result in account suspension or restriction.

9. Changes and Termination
The platform reserves the right to amend, suspend, or terminate this voucher at its discretion, subject to applicable laws and regulations.`;
}

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
      ...(input.discountType === 'free_delivery' && input.shippingOption && input.shippingOption.length > 0
        ? { shippingOption: input.shippingOption }
        : {}),
      createdAt: now,
      updatedAt: now,
      ...(auth.currentUser?.email ? { createdBy: auth.currentUser.email } : {}),
      ...(auth.currentUser?.displayName ? { createdByName: auth.currentUser.displayName } : {}),
    };

    const sellerProfile = await SellersService.get(sellerId).catch(() => null);
    const sellerName = sellerProfile?.name?.trim() || sellerId;
    const termsAndCondition = generateVoucherTerms({ ...data, sellerName });
    const docRef = await addDoc(vouchersCol(), { ...data, termsAndCondition });
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

    const updatedAt = new Date().toISOString();
    const updatePayload: Record<string, unknown> = { ...input, updatedAt };

    const existingSnap = await getDoc(voucherDoc(voucherId));
    if (existingSnap.exists()) {
      const existing = existingSnap.data() as Voucher;
      const merged = { ...existing, ...input, updatedAt };
      const sellerProfile = await SellersService.get(merged.sellerId).catch(() => null);
      const sellerName = sellerProfile?.name?.trim() || merged.sellerId;
      updatePayload.termsAndCondition = generateVoucherTerms({ ...merged, sellerName });
    }

    await updateDoc(voucherDoc(voucherId), updatePayload);
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
    shippingOption: source.shippingOption,
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
