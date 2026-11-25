import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  CheckCircle2,
  Edit3,
  Megaphone,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { formatINR } from '../data/catalog';
import type {
  Offer,
  OfferAppliesTo,
  OfferDiscountMode,
  OfferDiscountType,
  Product,
  ProductCategory,
  StorefrontBanner,
  StorefrontBannerDestinationType,
} from '../types';
import { ADMIN_EASE, AdminTableSkeleton } from './AdminMotion';
import {
  deleteAdminBanner,
  deleteAdminOffer,
  fetchAdminBanners,
  fetchAdminOffers,
  saveAdminBanner,
  saveAdminOffer,
  toggleBannerActiveAdmin,
  toggleOfferActiveAdmin,
} from './adminService';

interface AdminOffersProps {
  products: Product[];
  onDataChanged?: () => Promise<void> | void;
}

type OffersSubTab = 'offers' | 'banner';

const CATEGORIES: ProductCategory[] = ['Men', 'Women', 'Unisex'];

const CARD_CLASS =
  'rounded-[22px] bg-white/88 backdrop-blur-sm border border-white shadow-[0_8px_28px_-14px_rgba(15,36,48,0.12)]';

const INPUT_CLASS =
  'w-full px-3.5 py-2.5 rounded-xl border border-slate-200/90 bg-[#f4f8fa] text-[#0f2430] placeholder:text-[#7c94a0] outline-none focus:border-[#0e7490] focus:bg-white transition-colors';

function toLocalDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function formatScheduleDate(iso: string | null | undefined): string {
  if (!iso) return 'Anytime';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

type ScheduleBadge = {
  label: string;
  className: string;
};

function getScheduleBadge(
  isActive: boolean,
  startsAt: string | null,
  expiresAt: string | null
): ScheduleBadge {
  const now = Date.now();
  const startMs = startsAt ? new Date(startsAt).getTime() : null;
  const endMs = expiresAt ? new Date(expiresAt).getTime() : null;

  if (!isActive) {
    return {
      label: 'Paused',
      className: 'border-slate-200 bg-slate-100 text-[#607b87]',
    };
  }
  if (endMs !== null && now > endMs) {
    return {
      label: 'Expired',
      className: 'border-rose-200 bg-rose-50 text-rose-700',
    };
  }
  if (startMs !== null && now < startMs) {
    return {
      label: 'Scheduled',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
    };
  }
  return {
    label: 'Live',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  };
}

export function AdminOffers({ products, onDataChanged }: AdminOffersProps) {
  const [subTab, setSubTab] = useState<OffersSubTab>('offers');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [banners, setBanners] = useState<StorefrontBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [notice, setNotice] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  // Offer Editor State
  const [offerFormOpen, setOfferFormOpen] = useState(false);
  const [editingOfferId, setEditingOfferId] = useState<string | undefined>();
  const [offerTitle, setOfferTitle] = useState('');
  const [offerDescription, setOfferDescription] = useState('');
  const [discountMode, setDiscountMode] = useState<OfferDiscountMode>('coupon');
  const [couponCode, setCouponCode] = useState('');
  const [discountType, setDiscountType] = useState<OfferDiscountType>('percentage');
  const [discountValue, setDiscountValue] = useState('10');
  const [minCartValue, setMinCartValue] = useState('0');
  const [maxDiscount, setMaxDiscount] = useState('');
  const [appliesTo, setAppliesTo] = useState<OfferAppliesTo>('all');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [productPickerQuery, setProductPickerQuery] = useState('');
  const [totalUsageLimit, setTotalUsageLimit] = useState('');
  const [perCustomerLimit, setPerCustomerLimit] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [offerIsActive, setOfferIsActive] = useState(true);
  const [savingOffer, setSavingOffer] = useState(false);
  const [offerFormError, setOfferFormError] = useState('');
  const [confirmDeleteOffer, setConfirmDeleteOffer] = useState<Offer | null>(null);
  const [deletingOffer, setDeletingOffer] = useState(false);

  // Banner Editor State
  const [bannerFormOpen, setBannerFormOpen] = useState(false);
  const [editingBannerId, setEditingBannerId] = useState<string | undefined>();
  const [bannerOfferTitle, setBannerOfferTitle] = useState('');
  const [bannerText, setBannerText] = useState('');
  const [bannerCtaText, setBannerCtaText] = useState('Shop Now');
  const [bannerDestType, setBannerDestType] =
    useState<StorefrontBannerDestinationType>('shop');
  const [bannerDestValue, setBannerDestValue] = useState('');
  const [bannerStartsAt, setBannerStartsAt] = useState('');
  const [bannerExpiresAt, setBannerExpiresAt] = useState('');
  const [bannerIsActive, setBannerIsActive] = useState(true);
  const [savingBanner, setSavingBanner] = useState(false);
  const [bannerFormError, setBannerFormError] = useState('');
  const [confirmDeleteBanner, setConfirmDeleteBanner] =
    useState<StorefrontBanner | null>(null);
  const [deletingBanner, setDeletingBanner] = useState(false);

  const loadOffersAndBanners = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const [offersRes, bannersRes] = await Promise.all([
      fetchAdminOffers(),
      fetchAdminBanners(),
    ]);
    setOffers(offersRes.offers);
    setBanners(bannersRes.banners);
    setMigrationMissing(
      Boolean(offersRes.migrationMissing || bannersRes.migrationMissing)
    );
    const errs = [offersRes.error, bannersRes.error].filter(Boolean);
    if (errs.length > 0) {
      setLoadError(errs.join(' · '));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadOffersAndBanners();
  }, [loadOffersAndBanners]);

  const filteredProductsForPicker = useMemo(() => {
    const q = productPickerQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.garment_type.toLowerCase().includes(q)
    );
  }, [products, productPickerQuery]);

  const resetOfferForm = () => {
    setEditingOfferId(undefined);
    setOfferTitle('');
    setOfferDescription('');
    setDiscountMode('coupon');
    setCouponCode('');
    setDiscountType('percentage');
    setDiscountValue('10');
    setMinCartValue('0');
    setMaxDiscount('');
    setAppliesTo('all');
    setSelectedProductIds([]);
    setSelectedCategories([]);
    setProductPickerQuery('');
    setTotalUsageLimit('');
    setPerCustomerLimit('');
    setStartsAt('');
    setExpiresAt('');
    setOfferIsActive(true);
    setOfferFormError('');
  };

  const openCreateOffer = () => {
    resetOfferForm();
    setOfferFormOpen(true);
  };

  const openEditOffer = (offer: Offer) => {
    setEditingOfferId(offer.id);
    setOfferTitle(offer.title);
    setOfferDescription(offer.description);
    setDiscountMode(offer.discount_mode);
    setCouponCode(offer.coupon_code || '');
    setDiscountType(offer.discount_type);
    setDiscountValue(String(offer.discount_value));
    setMinCartValue(String(offer.min_cart_value_inr));
    setMaxDiscount(
      offer.max_discount_inr !== null ? String(offer.max_discount_inr) : ''
    );
    setAppliesTo(offer.applies_to);
    setSelectedProductIds(offer.product_ids);
    setSelectedCategories(offer.categories);
    setProductPickerQuery('');
    setTotalUsageLimit(
      offer.total_usage_limit !== null ? String(offer.total_usage_limit) : ''
    );
    setPerCustomerLimit(
      offer.per_customer_usage_limit !== null
        ? String(offer.per_customer_usage_limit)
        : ''
    );
    setStartsAt(toLocalDateTimeInput(offer.starts_at));
    setExpiresAt(toLocalDateTimeInput(offer.expires_at));
    setOfferIsActive(offer.is_active);
    setOfferFormError('');
    setOfferFormOpen(true);
  };

  const handleSaveOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    setOfferFormError('');
    setNotice(null);
    setSavingOffer(true);

    const res = await saveAdminOffer({
      id: editingOfferId,
      title: offerTitle,
      description: offerDescription,
      discount_mode: discountMode,
      coupon_code: discountMode === 'coupon' ? couponCode : null,
      discount_type: discountType,
      discount_value: Number(discountValue),
      min_cart_value_inr: Number(minCartValue || 0),
      max_discount_inr: maxDiscount.trim() ? Number(maxDiscount) : null,
      applies_to: appliesTo,
      product_ids: selectedProductIds,
      categories: selectedCategories,
      total_usage_limit: totalUsageLimit.trim() ? Number(totalUsageLimit) : null,
      per_customer_usage_limit: perCustomerLimit.trim()
        ? Number(perCustomerLimit)
        : null,
      allow_stacking: false,
      is_active: offerIsActive,
      starts_at: startsAt ? startsAt : null,
      expires_at: expiresAt ? expiresAt : null,
    });

    setSavingOffer(false);

    if (res.error || !res.offer) {
      setOfferFormError(res.error || 'Could not save offer.');
      return;
    }

    setOfferFormOpen(false);
    resetOfferForm();
    setNotice({
      type: 'ok',
      text: editingOfferId
        ? `Updated offer "${res.offer.title}".`
        : `Created offer "${res.offer.title}".`,
    });
    await loadOffersAndBanners();
    await onDataChanged?.();
  };

  const handleToggleOfferActive = async (offer: Offer) => {
    setNotice(null);
    const res = await toggleOfferActiveAdmin(offer.id, !offer.is_active);
    if (res.error) {
      setNotice({ type: 'err', text: res.error });
      return;
    }
    setNotice({
      type: 'ok',
      text: `Offer "${offer.title}" is now ${!offer.is_active ? 'active' : 'paused'}.`,
    });
    await loadOffersAndBanners();
  };

  const handleDeleteOfferConfirmed = async () => {
    if (!confirmDeleteOffer || deletingOffer) return;
    setDeletingOffer(true);
    const res = await deleteAdminOffer(confirmDeleteOffer.id);
    setDeletingOffer(false);
    if (res.error) {
      setNotice({ type: 'err', text: res.error });
      setConfirmDeleteOffer(null);
      return;
    }
    const deletedTitle = confirmDeleteOffer.title;
    setConfirmDeleteOffer(null);
    setNotice({ type: 'ok', text: `Deleted offer "${deletedTitle}".` });
    await loadOffersAndBanners();
  };

  // Banner Helpers
  const resetBannerForm = () => {
    setEditingBannerId(undefined);
    setBannerOfferTitle('');
    setBannerText('');
    setBannerCtaText('Shop Now');
    setBannerDestType('shop');
    setBannerDestValue('');
    setBannerStartsAt('');
    setBannerExpiresAt('');
    setBannerIsActive(true);
    setBannerFormError('');
  };

  const openCreateBanner = () => {
    resetBannerForm();
    setBannerFormOpen(true);
  };

  const openEditBanner = (banner: StorefrontBanner) => {
    setEditingBannerId(banner.id);
    setBannerOfferTitle(banner.offer_title);
    setBannerText(banner.banner_text);
    setBannerCtaText(banner.cta_text);
    setBannerDestType(banner.destination_type);
    setBannerDestValue(banner.destination_value);
    setBannerStartsAt(toLocalDateTimeInput(banner.starts_at));
    setBannerExpiresAt(toLocalDateTimeInput(banner.expires_at));
    setBannerIsActive(banner.is_active);
    setBannerFormError('');
    setBannerFormOpen(true);
  };

  const handleSaveBanner = async (e: React.FormEvent) => {
    e.preventDefault();
    setBannerFormError('');
    setNotice(null);
    setSavingBanner(true);

    const res = await saveAdminBanner({
      id: editingBannerId,
      offer_title: bannerOfferTitle,
      banner_text: bannerText,
      cta_text: bannerCtaText,
      destination_type: bannerDestType,
      destination_value: bannerDestValue,
      is_active: bannerIsActive,
      starts_at: bannerStartsAt ? bannerStartsAt : null,
      expires_at: bannerExpiresAt ? bannerExpiresAt : null,
    });

    setSavingBanner(false);

    if (res.error || !res.banner) {
      setBannerFormError(res.error || 'Could not save promotional banner.');
      return;
    }

    setBannerFormOpen(false);
    resetBannerForm();
    setNotice({
      type: 'ok',
      text: editingBannerId
        ? 'Updated storefront promotional banner.'
        : 'Saved storefront promotional banner.',
    });
    await loadOffersAndBanners();
  };

  const handleToggleBannerActive = async (banner: StorefrontBanner) => {
    setNotice(null);
    const res = await toggleBannerActiveAdmin(banner.id, !banner.is_active);
    if (res.error) {
      setNotice({ type: 'err', text: res.error });
      return;
    }
    setNotice({
      type: 'ok',
      text: `Promotional banner "${banner.offer_title || banner.banner_text}" is now ${
        !banner.is_active ? 'active' : 'paused'
      }.`,
    });
    await loadOffersAndBanners();
  };

  const handleDeleteBannerConfirmed = async () => {
    if (!confirmDeleteBanner || deletingBanner) return;
    setDeletingBanner(true);
    const res = await deleteAdminBanner(confirmDeleteBanner.id);
    setDeletingBanner(false);
    if (res.error) {
      setNotice({ type: 'err', text: res.error });
      setConfirmDeleteBanner(null);
      return;
    }
    setConfirmDeleteBanner(null);
    setNotice({ type: 'ok', text: 'Deleted storefront promotional banner.' });
    await loadOffersAndBanners();
  };

  const liveBannerInDb = banners.find(
    (b) =>
      getScheduleBadge(b.is_active, b.starts_at, b.expires_at).label === 'Live'
  );

  const previewBannerTitle = bannerFormOpen
    ? bannerOfferTitle.trim()
    : liveBannerInDb?.offer_title || '';
  const previewBannerText = bannerFormOpen
    ? bannerText.trim() || 'Free shipping on orders above ₹1,499 · Made for every you'
    : liveBannerInDb?.banner_text ||
      'Free shipping on orders above ₹1,499 · Made for every you';
  const previewBannerCta = bannerFormOpen
    ? bannerCtaText.trim()
    : liveBannerInDb?.cta_text || '';

  return (
    <div className="space-y-5">
      {/* Header & Sub-Navigation */}
      <div
        className={`${CARD_CLASS} p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4`}
      >
        <div>
          <p className="text-[11px] tracking-[0.18em] uppercase text-[#0e7490] font-semibold">
            Promotions &amp; Merchandising
          </p>
          <h1 className="text-2xl sm:text-[26px] font-semibold tracking-tight text-[#0f2430] mt-1">
            Offers, Coupons &amp; Storefront Banner
          </h1>
          <p className="text-xs text-[#546e7a] mt-1">
            Server-validated automatic offers &amp; coupon codes (no stacking: customer receives one active offer per order).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('offers')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
              subTab === 'offers'
                ? 'bg-[#0f2430] text-white border-[#0f2430]'
                : 'bg-white text-[#546e7a] border-slate-200 hover:bg-slate-50 hover:text-[#0f2430]'
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            <span>Offers &amp; Coupons ({offers.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('banner')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
              subTab === 'banner'
                ? 'bg-[#0f2430] text-white border-[#0f2430]'
                : 'bg-white text-[#546e7a] border-slate-200 hover:bg-slate-50 hover:text-[#0f2430]'
            }`}
          >
            <Megaphone className="w-3.5 h-3.5" />
            <span>Promotional Banner ({banners.length})</span>
          </button>
        </div>
      </div>

      {migrationMissing && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-950">
              Offers &amp; Banner SQL Migration Required
            </p>
            <p className="text-amber-900/90 leading-relaxed">
              Run{' '}
              <code className="bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded font-mono text-[11px]">
                supabase/offers_migration.sql
              </code>{' '}
              in Supabase SQL Editor to create{' '}
              <code className="bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded font-mono text-[11px]">
                public.offers
              </code>
              ,{' '}
              <code className="bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded font-mono text-[11px]">
                public.offer_redemptions
              </code>
              ,{' '}
              <code className="bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded font-mono text-[11px]">
                public.storefront_banners
              </code>
              , and{' '}
              <code className="bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded font-mono text-[11px]">
                preview_checkout_discount
              </code>
              .
            </p>
          </div>
        </div>
      )}

      {loadError && !migrationMissing && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{loadError}</span>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className={`p-3.5 rounded-2xl border text-xs flex items-center gap-2.5 ${
            notice.type === 'err'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          {notice.type === 'err' ? (
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 1: OFFERS & COUPONS */}
      {/* =================================================================== */}
      {subTab === 'offers' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[#546e7a]">
              Active policy:{' '}
              <strong className="text-[#0f2430]">
                Single Best Offer (No Stacking)
              </strong>{' '}
              — coupon codes take priority when entered; otherwise the highest eligible automatic offer applies.
            </p>
            <button
              type="button"
              disabled={migrationMissing}
              onClick={openCreateOffer}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#0f2430] hover:bg-[#0e7490] text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-45 shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Offer / Coupon</span>
            </button>
          </div>

          <AnimatePresence>
            {offerFormOpen && (
              <motion.form
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: ADMIN_EASE }}
                onSubmit={handleSaveOffer}
                className={`${CARD_CLASS} border-cyan-200/80 p-6 space-y-5`}
              >
                <div className="flex items-center justify-between pb-3 border-b border-slate-200/80">
                  <div>
                    <p className="text-[11px] tracking-[0.16em] uppercase text-[#0e7490] font-semibold">
                      {editingOfferId ? 'Edit Offer' : 'New Offer / Coupon'}
                    </p>
                    <h2 className="text-xl font-semibold text-[#0f2430] mt-0.5">
                      {editingOfferId ? offerTitle || 'Edit Offer' : 'Configure Discount Rule'}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setOfferFormOpen(false);
                      resetOfferForm();
                    }}
                    aria-label="Close offer form"
                    className="p-1.5 rounded-full text-[#607b87] hover:text-[#0f2430] hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                      Offer Title *
                    </label>
                    <input
                      type="text"
                      required
                      value={offerTitle}
                      onChange={(e) => setOfferTitle(e.target.value)}
                      placeholder="e.g. Festive Welcome 15% Off"
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                      Short Description
                    </label>
                    <input
                      type="text"
                      value={offerDescription}
                      onChange={(e) => setOfferDescription(e.target.value)}
                      placeholder="e.g. Valid on orders above ₹1,499"
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                      Discount Mode *
                    </label>
                    <select
                      value={discountMode}
                      onChange={(e) =>
                        setDiscountMode(e.target.value as OfferDiscountMode)
                      }
                      className={INPUT_CLASS}
                    >
                      <option value="coupon">Coupon Code (Entered at Checkout)</option>
                      <option value="automatic">Automatic Offer (Auto-Applied)</option>
                    </select>
                  </div>

                  {discountMode === 'coupon' ? (
                    <div>
                      <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                        Coupon Code *
                      </label>
                      <input
                        type="text"
                        required
                        value={couponCode}
                        onChange={(e) =>
                          setCouponCode(
                            e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '')
                          )
                        }
                        placeholder="WELCOME10"
                        maxLength={32}
                        className={`${INPUT_CLASS} text-[#0e7490] font-mono font-bold uppercase`}
                      />
                    </div>
                  ) : (
                    <div className="flex items-end pb-2.5 text-[11px] text-[#607b87]">
                      No coupon code required — automatically evaluates eligible carts.
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                      Discount Type *
                    </label>
                    <select
                      value={discountType}
                      onChange={(e) =>
                        setDiscountType(e.target.value as OfferDiscountType)
                      }
                      className={INPUT_CLASS}
                    >
                      <option value="percentage">Percentage Discount (%)</option>
                      <option value="fixed">Fixed Amount Discount (₹ INR)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                      Discount Value ({discountType === 'percentage' ? '%' : '₹'}) *
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      max={discountType === 'percentage' ? 100 : undefined}
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                      className={`${INPUT_CLASS} tabular-nums`}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                      Minimum Cart Value (₹)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={minCartValue}
                      onChange={(e) => setMinCartValue(e.target.value)}
                      className={`${INPUT_CLASS} tabular-nums`}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                      Max Discount Cap (₹, Optional)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={maxDiscount}
                      onChange={(e) => setMaxDiscount(e.target.value)}
                      placeholder="Unlimited"
                      className={`${INPUT_CLASS} tabular-nums`}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                      Total Usage Limit (Optional)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={totalUsageLimit}
                      onChange={(e) => setTotalUsageLimit(e.target.value)}
                      placeholder="Unlimited"
                      className={`${INPUT_CLASS} tabular-nums`}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                      Per-Customer Usage Limit (Optional)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={perCustomerLimit}
                      onChange={(e) => setPerCustomerLimit(e.target.value)}
                      placeholder="Unlimited"
                      className={`${INPUT_CLASS} tabular-nums`}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                      Start Date &amp; Time (Optional)
                    </label>
                    <input
                      type="datetime-local"
                      value={startsAt}
                      onChange={(e) => setStartsAt(e.target.value)}
                      className={`${INPUT_CLASS} tabular-nums`}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                      Expiry Date &amp; Time (Optional)
                    </label>
                    <input
                      type="datetime-local"
                      value={expiresAt}
                      onChange={(e) => setExpiresAt(e.target.value)}
                      className={`${INPUT_CLASS} tabular-nums`}
                    />
                  </div>
                </div>

                {/* Target Scope */}
                <div className="pt-4 border-t border-slate-200/80 space-y-3 text-xs">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#546e7a] mb-2">
                      Applies To *
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { id: 'all', label: 'All Products' },
                          { id: 'categories', label: 'Specific Categories' },
                          { id: 'products', label: 'Specific Products' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setAppliesTo(opt.id)}
                          className={`px-3.5 py-2 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
                            appliesTo === opt.id
                              ? 'bg-[#0f2430] text-white border-[#0f2430]'
                              : 'bg-[#f4f8fa] text-[#546e7a] border-slate-200 hover:text-[#0f2430] hover:border-[#0e7490]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {appliesTo === 'categories' && (
                    <div className="p-4 rounded-2xl bg-[#f4f8fa] border border-slate-200/80">
                      <p className="text-[11px] font-semibold text-[#546e7a] mb-2.5">
                        Select Categories ({selectedCategories.length} selected)
                      </p>
                      <div className="flex flex-wrap gap-4">
                        {CATEGORIES.map((cat) => {
                          const checked = selectedCategories.includes(cat);
                          return (
                            <label
                              key={cat}
                              className="inline-flex items-center gap-2 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedCategories((prev) =>
                                      Array.from(new Set([...prev, cat]))
                                    );
                                  } else {
                                    setSelectedCategories((prev) =>
                                      prev.filter((c) => c !== cat)
                                    );
                                  }
                                }}
                                className="accent-[#0e7490]"
                              />
                              <span className="font-semibold text-[#0f2430]">{cat}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {appliesTo === 'products' && (
                    <div className="p-4 rounded-2xl bg-[#f4f8fa] border border-slate-200/80 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold text-[#546e7a]">
                          Select Target Products ({selectedProductIds.length} selected)
                        </p>
                        <div className="relative w-56">
                          <Search className="w-3.5 h-3.5 text-[#7c94a0] absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={productPickerQuery}
                            onChange={(e) => setProductPickerQuery(e.target.value)}
                            placeholder="Filter products..."
                            className="w-full pl-8 pr-3 py-1.5 rounded-xl text-[11px] bg-white border border-slate-200 text-[#0f2430] placeholder:text-[#7c94a0] outline-none focus:border-[#0e7490]"
                          />
                        </div>
                      </div>

                      <div className="max-h-48 overflow-y-auto divide-y divide-slate-200/70 rounded-xl bg-white border border-slate-200/80">
                        {filteredProductsForPicker.length === 0 ? (
                          <p className="p-3 text-[11px] text-[#607b87]">
                            No products match your filter.
                          </p>
                        ) : (
                          filteredProductsForPicker.map((prod) => {
                            const checked = selectedProductIds.includes(prod.id);
                            return (
                              <label
                                key={prod.id}
                                className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-[#f2f8fa] cursor-pointer"
                              >
                                <span className="inline-flex items-center gap-2.5 min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedProductIds((prev) =>
                                          Array.from(new Set([...prev, prod.id]))
                                        );
                                      } else {
                                        setSelectedProductIds((prev) =>
                                          prev.filter((id) => id !== prod.id)
                                        );
                                      }
                                    }}
                                    className="accent-[#0e7490]"
                                  />
                                  <span className="truncate font-medium text-[#0f2430]">
                                    {prod.name}
                                  </span>
                                </span>
                                <span className="text-[11px] text-[#607b87] shrink-0 tabular-nums">
                                  {prod.category} · {formatINR(prod.price_inr)}
                                </span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}

                  <label className="inline-flex items-center gap-2.5 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={offerIsActive}
                      onChange={(e) => setOfferIsActive(e.target.checked)}
                      className="accent-[#0e7490]"
                    />
                    <span className="font-medium text-[#0f2430]">
                      Offer is Active (evaluates immediately within schedule)
                    </span>
                  </label>
                </div>

                {offerFormError && (
                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
                    {offerFormError}
                  </div>
                )}

                <div className="flex flex-wrap justify-end gap-3 pt-3 border-t border-slate-200/80">
                  <button
                    type="button"
                    onClick={() => {
                      setOfferFormOpen(false);
                      resetOfferForm();
                    }}
                    className="px-4 py-2.5 rounded-full border border-slate-200 text-xs font-semibold text-[#546e7a] hover:text-[#0f2430] hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingOffer}
                    className="px-5 py-2.5 rounded-full bg-[#0f2430] hover:bg-[#0e7490] text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {savingOffer
                      ? 'Saving...'
                      : editingOfferId
                        ? 'Save Changes'
                        : 'Publish Offer'}
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>

          {/* Offers List */}
          <div className={`${CARD_CLASS} overflow-hidden`}>
            {loading ? (
              <AdminTableSkeleton rows={5} />
            ) : offers.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-base font-semibold text-[#0f2430]">
                  No offers or coupons created yet
                </p>
                <p className="text-xs text-[#546e7a] mt-1.5">
                  Create an automatic storewide promotion or a coupon code for checkout.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200/80 bg-[#f6fafb] text-[11px] font-semibold text-[#607b87]">
                      <th className="py-3.5 px-5">Offer</th>
                      <th className="py-3.5 px-3">Mode / Code</th>
                      <th className="py-3.5 px-3">Discount</th>
                      <th className="py-3.5 px-3">Target &amp; Schedule</th>
                      <th className="py-3.5 px-3">Usage</th>
                      <th className="py-3.5 px-3">Status</th>
                      <th className="py-3.5 px-5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70 text-xs">
                    {offers.map((offer) => {
                      const badge = getScheduleBadge(
                        offer.is_active,
                        offer.starts_at,
                        offer.expires_at
                      );
                      return (
                        <tr key={offer.id} className="hover:bg-[#f2f8fa] transition-colors">
                          <td className="py-3.5 px-5">
                            <p className="font-semibold text-[#0f2430]">{offer.title}</p>
                            {offer.description && (
                              <p className="text-[11px] text-[#607b87] mt-0.5">
                                {offer.description}
                              </p>
                            )}
                          </td>
                          <td className="py-3.5 px-3 whitespace-nowrap">
                            {offer.discount_mode === 'coupon' ? (
                              <span className="px-2.5 py-1 rounded-full bg-cyan-50 border border-cyan-200 font-mono text-[11px] font-bold text-[#0e7490]">
                                {offer.coupon_code}
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-full bg-sky-50 border border-sky-200 text-[10px] uppercase tracking-wider font-semibold text-sky-700">
                                Automatic
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-3 tabular-nums">
                            <p className="font-semibold text-[#0f2430]">
                              {offer.discount_type === 'percentage'
                                ? `${offer.discount_value}% OFF`
                                : `Flat ${formatINR(offer.discount_value)} OFF`}
                            </p>
                            <p className="text-[11px] text-[#607b87]">
                              Min: {formatINR(offer.min_cart_value_inr)}
                              {offer.max_discount_inr !== null
                                ? ` · Cap: ${formatINR(offer.max_discount_inr)}`
                                : ''}
                            </p>
                          </td>
                          <td className="py-3.5 px-3 text-[11px] text-[#546e7a]">
                            <p className="font-semibold text-[#0f2430]">
                              {offer.applies_to === 'all'
                                ? 'All Products'
                                : offer.applies_to === 'categories'
                                  ? `Categories: ${offer.categories.join(', ')}`
                                  : `${offer.product_ids.length} Specific Product(s)`}
                            </p>
                            <p className="text-[#607b87] tabular-nums mt-0.5">
                              {offer.starts_at || offer.expires_at
                                ? `${formatScheduleDate(offer.starts_at)} → ${
                                    offer.expires_at
                                      ? formatScheduleDate(offer.expires_at)
                                      : 'No expiry'
                                  }`
                                : 'No expiry schedule'}
                            </p>
                          </td>
                          <td className="py-3.5 px-3 tabular-nums whitespace-nowrap text-[#546e7a]">
                            <p className="font-semibold text-[#0f2430]">
                              {offer.usage_count} /{' '}
                              {offer.total_usage_limit ?? '∞'}
                            </p>
                            {offer.per_customer_usage_limit !== null && (
                              <p className="text-[10px] text-[#708a96]">
                                Max {offer.per_customer_usage_limit}/customer
                              </p>
                            )}
                          </td>
                          <td className="py-3.5 px-3 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => handleToggleOfferActive(offer)}
                              title="Toggle Active / Paused"
                              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border cursor-pointer transition-opacity hover:opacity-85 ${badge.className}`}
                            >
                              {badge.label}
                            </button>
                          </td>
                          <td className="py-3.5 px-5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openEditOffer(offer)}
                                aria-label={`Edit ${offer.title}`}
                                className="p-2 rounded-xl border border-slate-200 bg-white text-[#4a6470] hover:text-[#0e7490] hover:border-[#0e7490]/40 hover:bg-cyan-50/50 cursor-pointer transition-colors"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteOffer(offer)}
                                aria-label={`Delete ${offer.title}`}
                                className="p-2 rounded-xl border border-slate-200 bg-white text-[#607b87] hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 cursor-pointer transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 2: HOMEPAGE PROMOTIONAL BANNER */}
      {/* =================================================================== */}
      {subTab === 'banner' && (
        <div className="space-y-5">
          {/* Live Storefront Bar Preview */}
          <div className={`${CARD_CLASS} p-5 space-y-3`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[11px] tracking-[0.16em] uppercase text-[#0e7490] font-semibold">
                  Live Announcement Bar Preview
                </p>
                <p className="text-xs text-[#546e7a] mt-0.5">
                  {bannerFormOpen
                    ? 'Previewing your current draft below before publishing.'
                    : liveBannerInDb
                      ? 'Showing the promotional banner currently live on the storefront.'
                      : 'No custom banner is live — storefront shows default shipping announcement.'}
                </p>
              </div>
              {!bannerFormOpen && (
                <button
                  type="button"
                  disabled={migrationMissing}
                  onClick={openCreateBanner}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#0f2430] hover:bg-[#0e7490] text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-45 shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Promotional Banner</span>
                </button>
              )}
            </div>

            {/* Authentic Storefront Top Bar Preview */}
            <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="bg-[#1e1b18] text-[#eee6d8] h-9 px-4 flex items-center justify-center relative text-[10px] tracking-[0.18em] uppercase">
                <span className="truncate flex items-center gap-2">
                  {previewBannerTitle && (
                    <strong className="text-[#d6b38d] font-bold">
                      {previewBannerTitle} ·
                    </strong>
                  )}
                  <span>{previewBannerText}</span>
                  {previewBannerCta && (
                    <span className="underline underline-offset-4 text-[#fffdf8] font-semibold">
                      {previewBannerCta}
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>

          <AnimatePresence>
            {bannerFormOpen && (
              <motion.form
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: ADMIN_EASE }}
                onSubmit={handleSaveBanner}
                className={`${CARD_CLASS} border-cyan-200/80 p-6 space-y-4 text-xs`}
              >
                <div className="flex items-center justify-between pb-3 border-b border-slate-200/80">
                  <div>
                    <p className="text-[11px] tracking-[0.16em] uppercase text-[#0e7490] font-semibold">
                      {editingBannerId ? 'Edit Banner' : 'New Storefront Banner'}
                    </p>
                    <h2 className="text-xl font-semibold text-[#0f2430] mt-0.5">
                      Configure Top Announcement Bar
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setBannerFormOpen(false);
                      resetBannerForm();
                    }}
                    aria-label="Close banner form"
                    className="p-1.5 rounded-full text-[#607b87] hover:text-[#0f2430] hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                      Offer Prefix / Tag (Optional)
                    </label>
                    <input
                      type="text"
                      value={bannerOfferTitle}
                      onChange={(e) => setBannerOfferTitle(e.target.value)}
                      placeholder="e.g. FESTIVE EDIT"
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                      CTA Link Text (Optional)
                    </label>
                    <input
                      type="text"
                      value={bannerCtaText}
                      onChange={(e) => setBannerCtaText(e.target.value)}
                      placeholder="Shop Now"
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                      Banner Message Text *
                    </label>
                    <input
                      type="text"
                      required
                      value={bannerText}
                      onChange={(e) => setBannerText(e.target.value)}
                      placeholder="e.g. Flat 15% Off Above ₹1,999 · Use Code WELCOME15"
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                      Click Destination
                    </label>
                    <select
                      value={bannerDestType}
                      onChange={(e) => {
                        const next = e.target.value as StorefrontBannerDestinationType;
                        setBannerDestType(next);
                        setBannerDestValue(
                          next === 'category'
                            ? 'Men'
                            : next === 'product'
                              ? products[0]?.id || ''
                              : ''
                        );
                      }}
                      className={INPUT_CLASS}
                    >
                      <option value="shop">Storefront Catalog (#shop)</option>
                      <option value="category">Specific Category Collection</option>
                      <option value="product">Specific Product Page</option>
                      <option value="url">Custom Section / Internal Path</option>
                    </select>
                  </div>

                  <div>
                    {bannerDestType === 'category' && (
                      <>
                        <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                          Target Category
                        </label>
                        <select
                          value={bannerDestValue || 'Men'}
                          onChange={(e) => setBannerDestValue(e.target.value)}
                          className={INPUT_CLASS}
                        >
                          {CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                    {bannerDestType === 'product' && (
                      <>
                        <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                          Target Product
                        </label>
                        <select
                          value={bannerDestValue}
                          onChange={(e) => setBannerDestValue(e.target.value)}
                          className={INPUT_CLASS}
                        >
                          <option value="">Select a product...</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({formatINR(p.price_inr)})
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                    {bannerDestType === 'url' && (
                      <>
                        <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                          Section ID or Path (e.g. #collections or #story)
                        </label>
                        <input
                          type="text"
                          value={bannerDestValue}
                          onChange={(e) => setBannerDestValue(e.target.value)}
                          placeholder="#collections"
                          className={INPUT_CLASS}
                        />
                      </>
                    )}
                    {bannerDestType === 'shop' && (
                      <div className="pt-6 text-[11px] text-[#607b87]">
                        Clicking the CTA scrolls cleanly to the Shop catalog grid.
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                      Start Date &amp; Time (Optional)
                    </label>
                    <input
                      type="datetime-local"
                      value={bannerStartsAt}
                      onChange={(e) => setBannerStartsAt(e.target.value)}
                      className={`${INPUT_CLASS} tabular-nums`}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#546e7a] mb-1.5">
                      Expiry Date &amp; Time (Optional)
                    </label>
                    <input
                      type="datetime-local"
                      value={bannerExpiresAt}
                      onChange={(e) => setBannerExpiresAt(e.target.value)}
                      className={`${INPUT_CLASS} tabular-nums`}
                    />
                  </div>
                </div>

                <label className="inline-flex items-center gap-2.5 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={bannerIsActive}
                    onChange={(e) => setBannerIsActive(e.target.checked)}
                    className="accent-[#0e7490]"
                  />
                  <span className="font-medium text-[#0f2430]">
                    Enable Banner on Storefront (publishes live immediately within schedule without redeploying)
                  </span>
                </label>

                {bannerFormError && (
                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
                    {bannerFormError}
                  </div>
                )}

                <div className="flex flex-wrap justify-end gap-3 pt-3 border-t border-slate-200/80">
                  <button
                    type="button"
                    onClick={() => {
                      setBannerFormOpen(false);
                      resetBannerForm();
                    }}
                    className="px-4 py-2.5 rounded-full border border-slate-200 text-xs font-semibold text-[#546e7a] hover:text-[#0f2430] hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingBanner}
                    className="px-5 py-2.5 rounded-full bg-[#0f2430] hover:bg-[#0e7490] text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {savingBanner
                      ? 'Saving...'
                      : editingBannerId
                        ? 'Save Banner'
                        : 'Publish Banner'}
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>

          {/* Banners List */}
          <div className={`${CARD_CLASS} overflow-hidden`}>
            {loading ? (
              <AdminTableSkeleton rows={4} />
            ) : banners.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-base font-semibold text-[#0f2430]">
                  No promotional banners saved yet
                </p>
                <p className="text-xs text-[#546e7a] mt-1.5">
                  Create a scheduled promotional announcement bar to highlight sales or coupon codes live on the storefront.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200/70">
                {banners.map((banner) => {
                  const badge = getScheduleBadge(
                    banner.is_active,
                    banner.starts_at,
                    banner.expires_at
                  );
                  return (
                    <div
                      key={banner.id}
                      className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-[#f2f8fa] transition-colors"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleToggleBannerActive(banner)}
                            className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border cursor-pointer ${badge.className}`}
                          >
                            {badge.label}
                          </button>
                          {banner.offer_title && (
                            <span className="text-xs font-bold text-[#0e7490] uppercase tracking-wider">
                              {banner.offer_title}
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-[#0f2430]">
                          {banner.banner_text}
                        </p>
                        <p className="text-[11px] text-[#607b87] tabular-nums">
                          CTA:{' '}
                          <strong className="text-[#0f2430]">
                            {banner.cta_text || 'None'}
                          </strong>{' '}
                          → {banner.destination_type}
                          {banner.destination_value ? ` (${banner.destination_value})` : ''} ·{' '}
                          {banner.starts_at || banner.expires_at
                            ? `${formatScheduleDate(banner.starts_at)} → ${
                                banner.expires_at
                                  ? formatScheduleDate(banner.expires_at)
                                  : 'No expiry'
                              }`
                            : 'Always while active'}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggleBannerActive(banner)}
                          className="px-3.5 py-1.5 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-[#0f2430] cursor-pointer transition-colors"
                        >
                          {banner.is_active ? 'Pause' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditBanner(banner)}
                          aria-label="Edit banner"
                          className="p-2 rounded-xl border border-slate-200 bg-white text-[#4a6470] hover:text-[#0e7490] hover:border-[#0e7490]/40 hover:bg-cyan-50/50 cursor-pointer transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteBanner(banner)}
                          aria-label="Delete banner"
                          className="p-2 rounded-xl border border-slate-200 bg-white text-[#607b87] hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Offer Modal */}
      <AnimatePresence>
        {confirmDeleteOffer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[70] bg-[#071c27]/60 backdrop-blur-[3px] flex items-center justify-center p-4"
            onClick={() => !deletingOffer && setConfirmDeleteOffer(null)}
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.22, ease: ADMIN_EASE }}
              className="w-full max-w-md rounded-[26px] bg-white text-[#0f2430] border border-white p-6 space-y-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-[11px] tracking-[0.14em] uppercase text-rose-600 font-semibold">
                Confirm Offer Deletion
              </p>
              <h3 className="text-xl font-semibold text-[#0f2430]">
                Delete &ldquo;{confirmDeleteOffer.title}&rdquo;?
              </h3>
              <p className="text-xs text-[#546e7a] leading-relaxed">
                Existing placed orders preserve their historical discount amounts and coupon text. This removes the active offer rule.
              </p>
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={deletingOffer}
                  onClick={() => setConfirmDeleteOffer(null)}
                  className="px-4 py-2 rounded-full border border-slate-200 text-xs font-semibold text-[#546e7a] hover:text-[#0f2430] hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deletingOffer}
                  onClick={handleDeleteOfferConfirmed}
                  className="px-4 py-2 rounded-full bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 cursor-pointer disabled:opacity-50"
                >
                  {deletingOffer ? 'Deleting...' : 'Delete Offer'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Banner Modal */}
      <AnimatePresence>
        {confirmDeleteBanner && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[70] bg-[#071c27]/60 backdrop-blur-[3px] flex items-center justify-center p-4"
            onClick={() => !deletingBanner && setConfirmDeleteBanner(null)}
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.22, ease: ADMIN_EASE }}
              className="w-full max-w-md rounded-[26px] bg-white text-[#0f2430] border border-white p-6 space-y-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-[11px] tracking-[0.14em] uppercase text-rose-600 font-semibold">
                Confirm Banner Deletion
              </p>
              <h3 className="text-xl font-semibold text-[#0f2430]">
                Delete this promotional banner?
              </h3>
              <p className="text-xs text-[#546e7a]">
                {confirmDeleteBanner.banner_text}
              </p>
              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={deletingBanner}
                  onClick={() => setConfirmDeleteBanner(null)}
                  className="px-4 py-2 rounded-full border border-slate-200 text-xs font-semibold text-[#546e7a] hover:text-[#0f2430] hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deletingBanner}
                  onClick={handleDeleteBannerConfirmed}
                  className="px-4 py-2 rounded-full bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 cursor-pointer disabled:opacity-50"
                >
                  {deletingBanner ? 'Deleting...' : 'Delete Banner'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
