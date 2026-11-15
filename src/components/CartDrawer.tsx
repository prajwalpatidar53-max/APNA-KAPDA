import { useEffect, useState } from 'react';
import { ArrowUpRight, Minus, Plus, X } from 'lucide-react';
import {
  FREE_SHIPPING_THRESHOLD_INR,
  formatINR,
} from '../data/catalog';
import { previewCheckoutDiscount } from '../services/storeService';
import { getAvailableStockForSize } from '../utils/inventory';
import type { CartItem, DiscountPreviewResult, Product } from '../types';
import { ResilientImage } from './ResilientImage';

interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
  cart: CartItem[];
  products: Product[];
  appliedCouponCode?: string | null;
  onChangeQty: (productId: string, size: string, delta: number) => void;
  onRemoveItem: (productId: string, size: string) => void;
  onProceedToCheckout: () => void;
}

export function CartDrawer({
  open,
  onClose,
  cart,
  products,
  appliedCouponCode,
  onChangeQty,
  onRemoveItem,
  onProceedToCheckout,
}: CartDrawerProps) {
  const [discountPreview, setDiscountPreview] =
    useState<DiscountPreviewResult | null>(null);

  const itemsWithProduct = cart
    .map((item) => ({
      ...item,
      product: products.find((p) => p.id === item.productId),
    }))
    .filter((entry): entry is CartItem & { product: Product } => Boolean(entry.product));

  const subtotal = itemsWithProduct.reduce(
    (sum, item) => sum + item.product.price_inr * item.qty,
    0
  );

  const cartSignature = itemsWithProduct
    .map((x) => `${x.product.id}:${x.qty}`)
    .join('|');

  useEffect(() => {
    if (!open || itemsWithProduct.length === 0) {
      setDiscountPreview(null);
      return;
    }

    let cancelled = false;
    void previewCheckoutDiscount({
      items: itemsWithProduct.map((x) => ({
        product_id: x.product.id,
        quantity: x.qty,
        unit_price_inr: x.product.price_inr,
      })),
      couponCode: appliedCouponCode,
    }).then((res) => {
      if (!cancelled) {
        setDiscountPreview(res);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open, cartSignature, appliedCouponCode]);

  const activeDiscount =
    discountPreview && discountPreview.valid ? discountPreview.discount_inr : 0;

  const remainingForFreeShipping = Math.max(
    0,
    FREE_SHIPPING_THRESHOLD_INR - subtotal
  );
  const shippingProgress = Math.min(
    100,
    (subtotal / FREE_SHIPPING_THRESHOLD_INR) * 100
  );

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black/45 z-[90] transition-opacity duration-300 ${
          open ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none'
        }`}
      />

      {/* Slide-over Drawer */}
      <aside
        aria-label="Shopping bag"
        className={`fixed z-[100] right-0 top-0 h-full w-full max-w-[430px] bg-[#fffdf8] p-6 flex flex-col border-l border-[#e5dfd3] transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between pb-5 border-b border-[#e5dfd3]">
          <div>
            <h2 className="font-serif-display text-2xl text-[#211f1b]">Your bag</h2>
            <p className="text-[11px] text-[#817b70] mt-0.5 tabular-nums">
              {itemsWithProduct.reduce((s, x) => s + x.qty, 0)} item(s)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close bag"
            className="p-1.5 text-[#817b70] hover:text-[#211f1b] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Free Shipping Progress */}
        {itemsWithProduct.length > 0 && (
          <div className="py-3.5 border-b border-[#e5dfd3]">
            <p className="text-[11px] text-[#5f594f] mb-2">
              {remainingForFreeShipping === 0 ? (
                <span className="text-[#9a6746] font-medium">
                  You unlocked complimentary shipping across India.
                </span>
              ) : (
                <>
                  Add <strong className="tabular-nums text-[#211f1b]">{formatINR(remainingForFreeShipping)}</strong> more for free shipping.
                </>
              )}
            </p>
            <div className="w-full h-1 bg-[#e5dfd3] overflow-hidden">
              <div
                className="h-full bg-[#9a6746] transition-all duration-300"
                style={{ width: `${shippingProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Line Items */}
        <div className="flex-1 overflow-y-auto py-3 divide-y divide-[#e5dfd3]">
          {itemsWithProduct.length === 0 ? (
            <div className="text-center py-16 px-4">
              <p className="font-serif-display text-xl text-[#211f1b]">
                Your bag is empty.
              </p>
              <p className="text-xs text-[#817b70] mt-2 leading-relaxed">
                Explore our Men&apos;s, Women&apos;s, and Unisex edits to find something that feels like you.
              </p>
            </div>
          ) : (
            itemsWithProduct.map(({ product, size, qty }) => {
              const maxStock = getAvailableStockForSize(product, size);
              return (
                <div
                  key={`${product.id}-${size}`}
                  className="grid grid-cols-[74px_1fr_auto] gap-3.5 py-4 items-start"
                >
                  <div className="w-[74px] h-[94px] bg-[#e9e3d8] overflow-hidden">
                    <ResilientImage
                      src={product.image_url}
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  <div className="min-w-0">
                    <h4 className="text-xs font-semibold text-[#211f1b] truncate">
                      {product.name}
                    </h4>
                    <p className="text-[11px] text-[#817b70] mt-0.5">
                      Size: {size} &middot;{' '}
                      <span className="tabular-nums">{formatINR(product.price_inr)}</span>
                    </p>

                    <div className="inline-flex items-center border border-[#e5dfd3] mt-3">
                      <button
                        type="button"
                        onClick={() => onChangeQty(product.id, size, -1)}
                        aria-label={`Decrease ${product.name} quantity`}
                        className="w-7 h-7 flex items-center justify-center text-[#211f1b] hover:bg-[#f5f2eb]"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-7 text-center text-xs font-medium tabular-nums">
                        {qty}
                      </span>
                      <button
                        type="button"
                        disabled={qty >= maxStock}
                        onClick={() => onChangeQty(product.id, size, 1)}
                        aria-label={`Increase ${product.name} quantity`}
                        className="w-7 h-7 flex items-center justify-center text-[#211f1b] hover:bg-[#f5f2eb] disabled:opacity-35"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <div className="text-right flex flex-col items-end justify-between h-full">
                    <span className="text-xs font-semibold text-[#211f1b] tabular-nums">
                      {formatINR(product.price_inr * qty)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveItem(product.id, size)}
                      className="text-[11px] text-[#9a6746] hover:text-[#211f1b] underline underline-offset-2 mt-4"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Drawer Footer */}
        <div className="border-t border-[#e5dfd3] pt-5">
          <div className="flex items-center justify-between text-sm font-bold text-[#211f1b] tabular-nums">
            <span>Subtotal</span>
            <span>{formatINR(subtotal)}</span>
          </div>
          {activeDiscount > 0 && (
            <div className="flex items-center justify-between text-xs text-[#2b6345] mt-1.5 tabular-nums">
              <span>
                {discountPreview?.applied_coupon_code
                  ? `Coupon (${discountPreview.applied_coupon_code})`
                  : discountPreview?.applied_offer_title || 'Offer Applied'}
              </span>
              <span className="font-semibold">&minus;{formatINR(activeDiscount)}</span>
            </div>
          )}
          <p className="text-[11px] text-[#817b70] mt-1.5">
            Coupons &amp; shipping calculated at checkout. Cash on Delivery (COD) available.
          </p>
          <button
            type="button"
            disabled={itemsWithProduct.length === 0}
            onClick={onProceedToCheckout}
            className="w-full mt-4 bg-[#24231f] text-white py-4 px-5 text-[11px] tracking-[0.18em] uppercase font-medium inline-flex items-center justify-center gap-2 hover:bg-[#9a6746] transition-colors disabled:opacity-45 cursor-pointer"
          >
            <span>Proceed to Checkout</span>
            <ArrowUpRight className="w-4 h-4" />
          </button>
        </div>
      </aside>
    </>
  );
}
