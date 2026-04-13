export type DiscountType = 'percentage' | 'fixed' | 'free_delivery';
export type VoucherStatus = 'active' | 'inactive' | 'expired';
export type VoucherScope = 'all' | 'specific';

export interface Voucher {
  id: string;
  sellerId: string;
  name: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;       // 0 for free_delivery
  minimumOrderAmount: number;
  maxUses: number;             // 0 = unlimited
  usedCount: number;
  startDate: string;           // ISO date string
  endDate: string;             // ISO date string
  status: VoucherStatus;
  scope: VoucherScope;
  productIds?: string[];       // only when scope === 'specific'
  createdAt: string;
  updatedAt: string;
}

export interface CreateVoucherInput {
  name: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
  minimumOrderAmount: number;
  maxUses: number;
  startDate: string;
  endDate: string;
  scope: VoucherScope;
  productIds?: string[];
}

export interface UpdateVoucherInput extends Partial<CreateVoucherInput> {
  status?: VoucherStatus;
}
