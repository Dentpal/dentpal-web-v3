export type DiscountType = 'percentage' | 'fixed' | 'free_delivery';
export type VoucherStatus = 'active' | 'inactive' | 'expired';
export type VoucherScope = 'all' | 'specific';
export type ShippingOption = 'express' | 'standard' | 'both';

export interface Voucher {
  id: string;
  sellerId: string;
  name: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;       // 0 for free_delivery
  maximumSpend?: number;       // only for percentage discounts
  minimumOrderAmount: number;
  maxUses: number;             // 0 = unlimited
  usedCount: number;
  startDate: string;           // ISO date string
  endDate: string;             // ISO date string
  status: VoucherStatus;
  scope: VoucherScope;
  productIds?: string[];       // only when scope === 'specific'
  shippingOption?: ShippingOption[]; // only for free_delivery
  createdAt: string;
  updatedAt: string;
  createdBy?: string;        // email of the user who created the voucher
  createdByName?: string;    // display name of the creator
  termsAndCondition?: string;
}

export interface CreateVoucherInput {
  name: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
  maximumSpend?: number;
  minimumOrderAmount: number;
  maxUses: number;
  startDate: string;
  endDate: string;
  scope: VoucherScope;
  productIds?: string[];
  shippingOption?: ShippingOption[];
}

export interface UpdateVoucherInput extends Partial<CreateVoucherInput> {
  status?: VoucherStatus;
}
