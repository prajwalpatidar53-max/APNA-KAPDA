import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Minus, Plus, ShoppingBag, Truck, X } from 'lucide-react';
import { FREE_SHIPPING_THRESHOLD_INR, formatINR } from '../data/catalog';
import { previewCheckoutDiscount } from '../services/storeService';
import { getAvailableStockForSize } from '../utils/inventory';
import type { CartItem, DiscountPreviewResult, Product } from '../types';
import { ResilientImage } from './ResilientImage';
import { STORE_EASE } from './StoreMotion';

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

  const totalUnits = itemsWithProduct.reduce((s, x) => s + x.qty, 0);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/45 backdrop-blur-[2px] z-[90]"
          />

          {/* Slide-over Drawer */}
          <motion.aside
            aria-label="Shopping bag"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.3, ease: STORE_EASE }}
            className="fixed z-[100] right-0 top-0 h-full w-full max-w-[440px] bg-[#fffdf9] sm:rounded-l-[28px] p-5 sm:p-6 flex flex-col border-l border-[#e8e1d5] shadow-2xl"
          >
            <div className="flex items-center justify-between pb-4 border-b border-[#ece5d9]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#f5efe4] border border-[#e5dccd] flex items-center justify-center text-[#8d5b3c]">
                  <ShoppingBag className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-serif-display text-2xl text-[#1f1d1a] leading-none">
                    Your bag
                  </h2>
                  <p className="text-[11px] text-[#7c756b] mt-1 tabular-nums">
                    {totalUnits} {totalUnits === 1 ? 'item' : 'items'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close bag"
                className="w-9 h-9 rounded-full flex items-center justify-center text-[#7c756b] hover:text-[#1f1d1a] hover:bg-[#f2ece0] transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Free Shipping Progress */}
            {itemsWithProduct.length > 0 && (
              <div className="mt-4 p-3.5 rounded-2xl bg-[#f8f4ed] border border-[#eae2d5]">
                <div className="flex items-center gap-2 text-[11px] text-[#575148] mb-2">
                  <Truck className="w-3.5 h-3.5 text-[#8d5b3c] shrink-0" />
                  {remainingForFreeShipping === 0 ? (
                    <span className="text-[#2b6345] font-semibold">
                      Complimentary shipping across India unlocked!
                    </span>
                  ) : (
                    <span>
                      Add{' '}
                      <strong className="tabular-nums text-[#1f1d1a]">
                        {formatINR(remainingForFreeShipping)}
                      </strong>{' '}
                      more for free shipping.
                    </span>
                  )}
                </div>
                <div className="w-full h-1.5 rounded-full bg-[#e6ded0] overflow-hidden">
                  <motion.div
                    initial={false}
                    animate={{ width: `${shippingProgress}%` }}
                    transition={{ duration: 0.35, ease: STORE_EASE }}
                    className="h-full rounded-full bg-gradient-to-r from-[#8d5b3c] to-[#b57c56]"
                  />
                </div>
              </div>
            )}

            {/* Line Items */}
            <div className="flex-1 overflow-y-auto py-3 divide-y divide-[#ece5d9]">
              {itemsWithProduct.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-14 px-4">
                  <div className="w-14 h-14 rounded-full bg-[#f5efe4] border border-[#e5dccd] flex items-center justify-center text-[#8d5b3c] mb-4">
                    <ShoppingBag className="w-6 h-6" />
                  </div>
                  <p className="font-serif-display text-2xl text-[#1f1d1a]">
                    Your bag is empty.
                  </p>
                  <p className="text-xs text-[#7c756b] mt-2 leading-relaxed max-w-xs">
                    Explore our Men&apos;s, Women&apos;s, and Unisex edits to find
                    something tailored to your everyday style.
                  </p>
                  <button
                    type="button"
                    onClick={onClose}
                    className="mt-6 rounded-full bg-[#1f1d1a] text-white px-6 py-2.5 text-[11px] font-semibold tracking-[0.14em] uppercase hover:bg-[#8d5b3c] transition-colors cursor-pointer"
                  >
                    Continue Browsing
                  </button>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {itemsWithProduct.map(({ product, size, qty }) => {
                    const maxStock = getAvailableStockForSize(product, size);
                    return (
                      <motion.div
                        key={`${product.id}-${size}`}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        transition={{ duration: 0.22, ease: STORE_EASE }}
                        className="grid grid-cols-[76px_1fr_auto] gap-3.5 py-4 items-start"
                      >
                        <div className="w-[76px] h-[96px] rounded-xl bg-[#eae3d6] overflow-hidden border border-[#e8e1d5]">
                          <ResilientImage
                            src={product.image_url}
                            alt={product.name}
                            className="w-full h-full object-cover"
                          />
                        </div>

                        <div className="min-w-0">
                          <h4 className="text-xs font-semibold text-[#1f1d1a] truncate">
                            {product.name}
                          </h4>
                          <p className="text-[11px] text-[#7c756b] mt-0.5">
                            Size: <strong className="text-[#1f1d1a]">{size}</strong> &middot;{' '}
                            <span className="tabular-nums">
                              {formatINR(product.price_inr)}
                            </span>
                          </p>

                          <div className="inline-flex items-center rounded-full border border-[#dfd6c7] bg-[#faf7f2] mt-3 p-0.5">
                            <button
                              type="button"
                              onClick={() => onChangeQty(product.id, size, -1)}
                              aria-label={`Decrease ${product.name} quantity`}
                              className="w-7 h-7 rounded-full flex items-center justify-center text-[#1f1d1a] hover:bg-[#eae2d5] cursor-pointer"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="w-7 text-center text-xs font-semibold tabular-nums">
                              {qty}
                            </span>
                            <button
                              type="button"
                              disabled={qty >= maxStock}
                              onClick={() => onChangeQty(product.id, size, 1)}
                              aria-label={`Increase ${product.name} quantity`}
                              className="w-7 h-7 rounded-full flex items-center justify-center text-[#1f1d1a] hover:bg-[#eae2d5] disabled:opacity-35 cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        <div className="text-right flex flex-col items-end justify-between h-full">
                          <span className="text-xs font-bold text-[#1f1d1a] tabular-nums">
                            {formatINR(product.price_inr * qty)}
                          </span>
                          <button
                            type="button"
                            onClick={() => onRemoveItem(product.id, size)}
                            className="text-[11px] text-[#8d5b3c] hover:text-[#1f1d1a] underline underline-offset-2 mt-4 cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              )}
            </div>

            {/* Drawer Footer */}
            <div className="border-t border-[#ece5d9] pt-4">
              <div className="flex items-center justify-between text-sm font-bold text-[#1f1d1a] tabular-nums">
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
                  <span className="font-semibold">
                    &minus;{formatINR(activeDiscount)}
                  </span>
                </div>
              )}
              <p className="text-[11px] text-[#7c756b] mt-1.5">
                Coupons &amp; shipping calculated at checkout. Cash on Delivery (COD)
                available.
              </p>
              <motion.button
                type="button"
                whileTap={{ scale: 0.99 }}
                disabled={itemsWithProduct.length === 0}
                onClick={onProceedToCheckout}
                className="w-full mt-4 rounded-full bg-[#1f1d1a] text-white py-4 px-5 text-[11px] tracking-[0.16em] uppercase font-semibold inline-flex items-center justify-center gap-2 hover:bg-[#8d5b3c] transition-colors disabled:opacity-45 cursor-pointer shadow-sm"
              >
                <span>Proceed to Checkout</span>
                <ArrowUpRight className="w-4 h-4" />
              </motion.button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
