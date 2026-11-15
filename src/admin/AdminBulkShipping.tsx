import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileDown,
  Filter,
  Loader2,
  MapPin,
  Printer,
  RotateCcw,
  Save,
  Settings2,
  Truck,
  X,
} from 'lucide-react';
import { formatINR } from '../data/catalog';
import type { Order, OrderStatus, PaymentStatus } from '../types';
import { bulkMarkOrdersShippedAdmin } from './adminService';
import { loadBrowserPdfFonts } from './shipping/shippingFonts';
import {
  generateBulkOrderSheetPdf,
  generateShippingLabelsPdf,
  triggerPdfDownload,
} from './shipping/shippingPdf';
import {
  type AdminSenderConfig,
  DEFAULT_SHIPPING_FILTERS,
  READY_TO_SHIP_STATUSES,
  type ShippingFiltersState,
  type ShippingLayout,
  computeShippingStats,
  deduplicateOrders,
  filterShippingOrders,
  formatFullAddressLines,
  formatOrderTimestamp,
  getLabelPaymentInfo,
  loadAdminSenderConfig,
  partitionOrdersByValidation,
  saveAdminSenderConfig,
  validateOrderForShipping,
  validateSenderConfig,
} from './shipping/shippingUtils';

interface AdminBulkShippingProps {
  orders: Order[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onInspectOrder: (order: Order) => void;
}

const ALL_ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'confirmed',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
];

const ALL_PAYMENT_STATUSES: PaymentStatus[] = [
  'cod_due',
  'awaiting_payment',
  'paid',
  'refund_pending',
  'failed',
  'refunded',
  'cancelled',
];

function statusBadgeClass(status: OrderStatus): string {
  switch (status) {
    case 'delivered':
      return 'border-[#2b6345] bg-[#ecfdf5] text-[#2b6345]';
    case 'cancelled':
      return 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]';
    case 'shipped':
    case 'packed':
      return 'border-[#d6c2a8] bg-[#f9f4ec] text-[#9a6746]';
    case 'confirmed':
      return 'border-[#24231f] bg-[#24231f] text-white';
    default:
      return 'border-[#e5dfd3] bg-[#f5f2eb] text-[#5f594f]';
  }
}

export function AdminBulkShipping({
  orders,
  loading,
  onRefresh,
  onInspectOrder,
}: AdminBulkShippingProps) {
  const uniqueOrders = useMemo(() => deduplicateOrders(orders), [orders]);

  const [filters, setFilters] = useState<ShippingFiltersState>(
    DEFAULT_SHIPPING_FILTERS
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [labelLayout, setLabelLayout] = useState<ShippingLayout>('a4');

  const [senderConfig, setSenderConfig] = useState<AdminSenderConfig>(() =>
    loadAdminSenderConfig()
  );
  const [senderDraft, setSenderDraft] = useState<AdminSenderConfig>(() =>
    loadAdminSenderConfig()
  );
  const [senderPanelOpen, setSenderPanelOpen] = useState<boolean>(false);
  const [senderFeedback, setSenderFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const [generatingType, setGeneratingType] = useState<'sheet' | 'labels' | null>(
    null
  );
  const [actionNotice, setActionNotice] = useState<{
    type: 'ok' | 'err' | 'warn';
    text: string;
  } | null>(null);

  const [validationModal, setValidationModal] = useState<{
    target: 'sheet' | 'labels';
    validOrders: Order[];
    invalidEntries: { order: Order; issues: string[] }[];
  } | null>(null);

  const [shipConfirmOpen, setShipConfirmOpen] = useState(false);
  const [markingShipped, setMarkingShipped] = useState(false);

  // Prune selected IDs that no longer exist in loaded Supabase orders
  useEffect(() => {
    const validIdSet = new Set(uniqueOrders.map((o) => o.id));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (validIdSet.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [uniqueOrders]);

  const stats = useMemo(
    () => computeShippingStats(uniqueOrders),
    [uniqueOrders]
  );

  const filteredOrders = useMemo(
    () => filterShippingOrders(uniqueOrders, filters),
    [uniqueOrders, filters]
  );

  const selectedOrders = useMemo(
    () => uniqueOrders.filter((o) => selectedIds.has(o.id)),
    [uniqueOrders, selectedIds]
  );

  const senderValidation = useMemo(
    () => validateSenderConfig(senderConfig),
    [senderConfig]
  );

  const allFilteredSelected =
    filteredOrders.length > 0 &&
    filteredOrders.every((o) => selectedIds.has(o.id));

  const toggleOrderSelection = (orderId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const order of filteredOrders) {
        next.add(order.id);
      }
      return next;
    });
  };

  const handleToggleHeaderCheckbox = () => {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const order of filteredOrders) {
          next.delete(order.id);
        }
        return next;
      });
    } else {
      handleSelectAllFiltered();
    }
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleSaveSenderConfig = (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateSenderConfig(senderDraft);
    if (!check.valid) {
      setSenderFeedback({
        type: 'err',
        text: `Complete required sender fields: ${check.issues.join(' · ')}`,
      });
      return;
    }
    const saved = saveAdminSenderConfig(senderDraft);
    setSenderConfig(saved);
    setSenderDraft(saved);
    setSenderFeedback({
      type: 'ok',
      text: 'APNA KAPDA sender dispatch address saved for shipping labels.',
    });
  };

  const executePdfExport = async (
    target: 'sheet' | 'labels',
    ordersToExport: Order[]
  ) => {
    if (ordersToExport.length === 0) return;

    setGeneratingType(target);
    setActionNotice(null);

    try {
      const fonts = await loadBrowserPdfFonts();
      if (target === 'sheet') {
        const result = await generateBulkOrderSheetPdf(ordersToExport, { fonts });
        triggerPdfDownload(result.blob, result.filename);
        setActionNotice({
          type: 'ok',
          text: `Downloaded Bulk Order PDF (${result.orderCount} ${
            result.orderCount === 1 ? 'order' : 'orders'
          }, ${result.pageCount} ${
            result.pageCount === 1 ? 'page' : 'pages'
          }). Remember to click "Mark Selected as Shipped" only after parcel handoff.`,
        });
      } else {
        const result = await generateShippingLabelsPdf(
          ordersToExport,
          senderConfig,
          labelLayout,
          { fonts }
        );
        triggerPdfDownload(result.blob, result.filename);
        setActionNotice({
          type: 'ok',
          text: `Downloaded Shipping Labels (${result.orderCount} ${
            result.orderCount === 1 ? 'label' : 'labels'
          }, ${labelLayout === '4x6' ? '4 × 6 in' : 'A4 grid'}, ${
            result.pageCount
          } ${
            result.pageCount === 1 ? 'page' : 'pages'
          }). Remember to click "Mark Selected as Shipped" only after dispatch.`,
        });
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to generate PDF document.';
      setActionNotice({ type: 'err', text: msg });
    } finally {
      setGeneratingType(null);
    }
  };

  const handleRequestPdf = async (target: 'sheet' | 'labels') => {
    setActionNotice(null);

    if (selectedOrders.length === 0) {
      setActionNotice({
        type: 'warn',
        text: 'Select at least one order before generating PDFs.',
      });
      return;
    }

    if (target === 'labels' && !senderValidation.valid) {
      setSenderPanelOpen(true);
      setSenderFeedback({
        type: 'err',
        text: `Configure complete APNA KAPDA sender address and phone before printing labels: ${senderValidation.issues.join(
          ' · '
        )}`,
      });
      setActionNotice({
        type: 'warn',
        text: 'Shipping labels require configured APNA KAPDA sender details (name, phone, address, city, state, 6-digit PIN). Update Sender Settings above and try again.',
      });
      return;
    }

    const { validOrders, invalidEntries } =
      partitionOrdersByValidation(selectedOrders);

    if (invalidEntries.length > 0) {
      setValidationModal({ target, validOrders, invalidEntries });
      return;
    }

    await executePdfExport(target, validOrders);
  };

  const handleConfirmExcludeAndExport = async () => {
    if (!validationModal || validationModal.validOrders.length === 0) return;
    const { target, validOrders } = validationModal;
    setValidationModal(null);
    await executePdfExport(target, validOrders);
  };

  const shipBreakdown = useMemo(() => {
    const eligible: Order[] = [];
    const cancelled: Order[] = [];
    const delivered: Order[] = [];
    const alreadyShipped: Order[] = [];

    for (const order of selectedOrders) {
      if (READY_TO_SHIP_STATUSES.includes(order.order_status)) {
        eligible.push(order);
      } else if (order.order_status === 'cancelled') {
        cancelled.push(order);
      } else if (order.order_status === 'delivered') {
        delivered.push(order);
      } else if (order.order_status === 'shipped') {
        alreadyShipped.push(order);
      }
    }
    return { eligible, cancelled, delivered, alreadyShipped };
  }, [selectedOrders]);

  const handleConfirmMarkShipped = async () => {
    if (markingShipped || shipBreakdown.eligible.length === 0) return;
    setMarkingShipped(true);
    setActionNotice(null);

    const res = await bulkMarkOrdersShippedAdmin(
      shipBreakdown.eligible.map((o) => o.id)
    );
    setMarkingShipped(false);
    setShipConfirmOpen(false);

    if (res.error) {
      setActionNotice({ type: 'err', text: res.error });
      return;
    }

    const skippedParts: string[] = [];
    if (res.skippedCancelledCount > 0) {
      skippedParts.push(`${res.skippedCancelledCount} cancelled protected`);
    }
    if (res.skippedDeliveredCount > 0) {
      skippedParts.push(`${res.skippedDeliveredCount} delivered skipped`);
    }
    if (res.skippedAlreadyShippedCount > 0) {
      skippedParts.push(`${res.skippedAlreadyShippedCount} already shipped`);
    }

    setActionNotice({
      type: res.updatedIds.length > 0 ? 'ok' : 'warn',
      text:
        res.updatedIds.length > 0
          ? `Marked ${res.updatedIds.length} ${
              res.updatedIds.length === 1 ? 'order' : 'orders'
            } as Shipped in Supabase.${
              skippedParts.length > 0 ? ` (${skippedParts.join(', ')})` : ''
            }`
          : `No eligible orders were updated.${
              skippedParts.length > 0 ? ` (${skippedParts.join(', ')})` : ''
            }`,
    });

    setSelectedIds(new Set());
    await onRefresh();
  };

  return (
    <div className="space-y-6">
      {/* Top Section Header + Sender Config Toggle */}
      <div className="bg-[#fffdf8] border border-[#e5dfd3] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-[10px] tracking-[0.22em] uppercase text-[#9a6746] font-bold">
            Dispatch &amp; Packaging Workspace
          </p>
          <h1 className="font-serif-display text-2xl sm:text-3xl text-[#211f1b] mt-1">
            Bulk Shipping Center
          </h1>
          <p className="text-xs text-[#5f594f] mt-1">
            Select verified customer orders, export print-ready order sheets or QR shipping labels, and confirm dispatch status.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setSenderPanelOpen((v) => !v)}
          className={`inline-flex items-center gap-2.5 px-4 py-2.5 border text-[10px] tracking-[0.16em] uppercase font-semibold transition-colors cursor-pointer shrink-0 ${
            senderValidation.valid
              ? 'border-[#e5dfd3] bg-[#f5f2eb]/70 text-[#211f1b] hover:border-[#24231f]'
              : 'border-[#f59e0b] bg-[#fffbeb] text-[#92400e]'
          }`}
        >
          <Settings2 className="w-3.5 h-3.5 text-[#9a6746]" />
          <span>Sender Settings</span>
          <span
            className={`px-1.5 py-0.5 text-[9px] font-bold ${
              senderValidation.valid
                ? 'bg-[#ecfdf5] text-[#2b6345] border border-[#a7f3d0]'
                : 'bg-[#fef2f2] text-[#b91c1c] border border-[#fecaca]'
            }`}
          >
            {senderValidation.valid ? 'Ready' : 'Required'}
          </span>
        </button>
      </div>

      {/* Configurable APNA KAPDA Sender Dispatch Settings */}
      {senderPanelOpen && (
        <section className="bg-[#fffdf8] border border-[#d6c2a8] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#e5dfd3]">
            <div>
              <p className="text-[10px] tracking-[0.2em] uppercase text-[#9a6746] font-bold">
                Return &amp; Origin Details for Labels
              </p>
              <h2 className="font-serif-display text-xl text-[#211f1b] mt-1">
                APNA KAPDA Sender Configuration
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setSenderPanelOpen(false)}
              aria-label="Close sender settings"
              className="p-1.5 text-[#817b70] hover:text-[#211f1b] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSaveSenderConfig} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-[10px] tracking-[0.14em] uppercase font-semibold text-[#5f594f] mb-1">
                  Sender / Brand Name *
                </label>
                <input
                  type="text"
                  value={senderDraft.senderName}
                  onChange={(e) =>
                    setSenderDraft((s) => ({ ...s, senderName: e.target.value }))
                  }
                  placeholder="APNA KAPDA"
                  className="w-full px-3 py-2 text-xs bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
                />
              </div>

              <div>
                <label className="block text-[10px] tracking-[0.14em] uppercase font-semibold text-[#5f594f] mb-1">
                  Dispatch Phone (10 digits) *
                </label>
                <input
                  type="tel"
                  value={senderDraft.phone}
                  onChange={(e) =>
                    setSenderDraft((s) => ({ ...s, phone: e.target.value }))
                  }
                  placeholder="9876543210"
                  className="w-full px-3 py-2 text-xs bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
                />
              </div>

              <div>
                <label className="block text-[10px] tracking-[0.14em] uppercase font-semibold text-[#5f594f] mb-1">
                  Origin PIN Code (6 digits) *
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={senderDraft.pincode}
                  onChange={(e) =>
                    setSenderDraft((s) => ({
                      ...s,
                      pincode: e.target.value.replace(/\D/g, '').slice(0, 6),
                    }))
                  }
                  placeholder="400001"
                  className="w-full px-3 py-2 text-xs bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b] tabular-nums"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[10px] tracking-[0.14em] uppercase font-semibold text-[#5f594f] mb-1">
                  Warehouse / Studio Address Line 1 *
                </label>
                <input
                  type="text"
                  value={senderDraft.addressLine1}
                  onChange={(e) =>
                    setSenderDraft((s) => ({ ...s, addressLine1: e.target.value }))
                  }
                  placeholder="Unit 4B, Kala Ghoda Textile Hub"
                  className="w-full px-3 py-2 text-xs bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
                />
              </div>

              <div>
                <label className="block text-[10px] tracking-[0.14em] uppercase font-semibold text-[#5f594f] mb-1">
                  Address Line 2 (Optional)
                </label>
                <input
                  type="text"
                  value={senderDraft.addressLine2}
                  onChange={(e) =>
                    setSenderDraft((s) => ({ ...s, addressLine2: e.target.value }))
                  }
                  placeholder="Fort, South Mumbai"
                  className="w-full px-3 py-2 text-xs bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
                />
              </div>

              <div>
                <label className="block text-[10px] tracking-[0.14em] uppercase font-semibold text-[#5f594f] mb-1">
                  City *
                </label>
                <input
                  type="text"
                  value={senderDraft.city}
                  onChange={(e) =>
                    setSenderDraft((s) => ({ ...s, city: e.target.value }))
                  }
                  placeholder="Mumbai"
                  className="w-full px-3 py-2 text-xs bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
                />
              </div>

              <div>
                <label className="block text-[10px] tracking-[0.14em] uppercase font-semibold text-[#5f594f] mb-1">
                  State *
                </label>
                <input
                  type="text"
                  value={senderDraft.state}
                  onChange={(e) =>
                    setSenderDraft((s) => ({ ...s, state: e.target.value }))
                  }
                  placeholder="Maharashtra"
                  className="w-full px-3 py-2 text-xs bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
                />
              </div>
            </div>

            {senderFeedback && (
              <p
                className={`text-xs p-3 border ${
                  senderFeedback.type === 'err'
                    ? 'bg-[#fef2f2] border-[#fecaca] text-[#b91c1c]'
                    : 'bg-[#ecfdf5] border-[#a7f3d0] text-[#2b6345]'
                }`}
              >
                {senderFeedback.text}
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#24231f] text-white text-[10px] tracking-[0.16em] uppercase font-semibold hover:bg-[#9a6746] transition-colors cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Sender Details</span>
              </button>
            </div>
          </form>
        </section>
      )}

      {/* KPI Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-[#fffdf8] border border-[#e5dfd3] p-5">
          <div className="flex items-center justify-between text-[#817b70]">
            <span className="text-[10px] tracking-[0.18em] uppercase font-semibold">
              Total Orders
            </span>
            <Truck className="w-4 h-4 text-[#9a6746]" />
          </div>
          <p className="font-serif-display text-3xl text-[#211f1b] mt-3 tabular-nums">
            {loading ? '—' : stats.totalOrders}
          </p>
          <p className="text-[11px] text-[#5f594f] mt-2">
            Synced directly from Supabase orders
          </p>
        </div>

        <div className="bg-[#fffdf8] border border-[#e5dfd3] p-5">
          <div className="flex items-center justify-between text-[#817b70]">
            <span className="text-[10px] tracking-[0.18em] uppercase font-semibold">
              Orders Ready to Ship
            </span>
            <Printer className="w-4 h-4 text-[#9a6746]" />
          </div>
          <p className="font-serif-display text-3xl text-[#211f1b] mt-3 tabular-nums">
            {loading ? '—' : stats.readyToShipOrders}
          </p>
          <p className="text-[11px] text-[#5f594f] mt-2">
            Status: pending, confirmed, or packed
          </p>
        </div>

        <div className="bg-[#fffdf8] border border-[#e5dfd3] p-5">
          <div className="flex items-center justify-between text-[#817b70]">
            <span className="text-[10px] tracking-[0.18em] uppercase font-semibold">
              Orders Already Shipped
            </span>
            <CheckCircle2 className="w-4 h-4 text-[#9a6746]" />
          </div>
          <p className="font-serif-display text-3xl text-[#211f1b] mt-3 tabular-nums">
            {loading ? '—' : stats.shippedOrders}
          </p>
          <p className="text-[11px] text-[#5f594f] mt-2">
            Dispatched &amp; awaiting customer delivery
          </p>
        </div>

        <div className="bg-[#fffdf8] border border-[#e5dfd3] p-5">
          <div className="flex items-center justify-between text-[#817b70]">
            <span className="text-[10px] tracking-[0.18em] uppercase font-semibold">
              Incomplete Delivery Addresses
            </span>
            <AlertTriangle
              className={`w-4 h-4 ${
                stats.incompleteAddressOrders > 0
                  ? 'text-[#b91c1c]'
                  : 'text-[#9a6746]'
              }`}
            />
          </div>
          <p
            className={`font-serif-display text-3xl mt-3 tabular-nums ${
              stats.incompleteAddressOrders > 0
                ? 'text-[#b91c1c]'
                : 'text-[#211f1b]'
            }`}
          >
            {loading ? '—' : stats.incompleteAddressOrders}
          </p>
          <p className="text-[11px] text-[#5f594f] mt-2">
            Active orders missing phone, address, or 6-digit PIN
          </p>
        </div>
      </div>

      {/* Filters Toolbar */}
      <section className="bg-[#fffdf8] border border-[#e5dfd3] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-[10px] tracking-[0.18em] uppercase font-bold text-[#9a6746]">
            <Filter className="w-3.5 h-3.5" />
            <span>Filter Orders</span>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-[11px] text-[#817b70] tabular-nums">
              Showing <strong className="text-[#211f1b]">{filteredOrders.length}</strong> of{' '}
              {uniqueOrders.length} orders
            </span>
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_SHIPPING_FILTERS)}
              className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.14em] uppercase font-semibold text-[#5f594f] hover:text-[#211f1b] cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Filters</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-[10px] tracking-[0.12em] uppercase text-[#817b70] mb-1">
              Search Order ID
            </label>
            <input
              type="text"
              value={filters.orderIdQuery}
              onChange={(e) =>
                setFilters((f) => ({ ...f, orderIdQuery: e.target.value }))
              }
              placeholder="e.g. AK-104218"
              className="w-full px-3 py-2 text-xs bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
            />
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.12em] uppercase text-[#817b70] mb-1">
              Customer Name or Phone
            </label>
            <input
              type="text"
              value={filters.customerQuery}
              onChange={(e) =>
                setFilters((f) => ({ ...f, customerQuery: e.target.value }))
              }
              placeholder="Name or 10-digit phone..."
              className="w-full px-3 py-2 text-xs bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
            />
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.12em] uppercase text-[#817b70] mb-1">
              City
            </label>
            <input
              type="text"
              value={filters.cityQuery}
              onChange={(e) =>
                setFilters((f) => ({ ...f, cityQuery: e.target.value }))
              }
              placeholder="e.g. Mumbai, Delhi"
              className="w-full px-3 py-2 text-xs bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
            />
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.12em] uppercase text-[#817b70] mb-1">
              PIN Code
            </label>
            <input
              type="text"
              maxLength={6}
              value={filters.pincodeQuery}
              onChange={(e) =>
                setFilters((f) => ({ ...f, pincodeQuery: e.target.value }))
              }
              placeholder="e.g. 400001"
              className="w-full px-3 py-2 text-xs bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b] tabular-nums"
            />
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.12em] uppercase text-[#817b70] mb-1">
              From Date
            </label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) =>
                setFilters((f) => ({ ...f, dateFrom: e.target.value }))
              }
              className="w-full px-3 py-2 text-xs bg-[#fffdf8] border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
            />
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.12em] uppercase text-[#817b70] mb-1">
              To Date
            </label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) =>
                setFilters((f) => ({ ...f, dateTo: e.target.value }))
              }
              className="w-full px-3 py-2 text-xs bg-[#fffdf8] border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
            />
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.12em] uppercase text-[#817b70] mb-1">
              Order Status
            </label>
            <select
              value={filters.orderStatus}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  orderStatus: e.target.value as ShippingFiltersState['orderStatus'],
                }))
              }
              aria-label="Filter shipping orders by status"
              className="w-full px-3 py-2 text-xs bg-[#fffdf8] border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b] capitalize"
            >
              <option value="default_dispatch">
                Active Dispatch (Excludes Cancelled &amp; Delivered)
              </option>
              <option value="all">All Order Statuses</option>
              {ALL_ORDER_STATUSES.map((s) => (
                <option key={s} value={s} className="capitalize">
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.12em] uppercase text-[#817b70] mb-1">
              Payment Status
            </label>
            <select
              value={filters.paymentStatus}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  paymentStatus: e.target.value as 'all' | PaymentStatus,
                }))
              }
              aria-label="Filter shipping orders by payment status"
              className="w-full px-3 py-2 text-xs bg-[#fffdf8] border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
            >
              <option value="all">All Payment Statuses</option>
              {ALL_PAYMENT_STATUSES.map((p) => (
                <option key={p} value={p}>
                  {p.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filters.orderStatus === 'default_dispatch' && (
          <div className="flex flex-wrap items-center gap-5 pt-2 border-t border-[#e5dfd3] text-xs text-[#5f594f]">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filters.includeDelivered}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, includeDelivered: e.target.checked }))
                }
                className="accent-[#24231f] w-3.5 h-3.5"
              />
              <span>Include Delivered Orders</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filters.includeCancelled}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, includeCancelled: e.target.checked }))
                }
                className="accent-[#24231f] w-3.5 h-3.5"
              />
              <span>Include Cancelled Orders</span>
            </label>
          </div>
        )}
      </section>

      {/* Selection & Print/Dispatch Action Bar */}
      <section className="bg-[#fffdf8] border border-[#e5dfd3] p-4 sm:p-5 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="px-3 py-1.5 bg-[#24231f] text-white text-[11px] tracking-[0.1em] uppercase font-semibold tabular-nums">
            Selected: {selectedOrders.length}
          </span>

          <button
            type="button"
            disabled={filteredOrders.length === 0}
            onClick={handleSelectAllFiltered}
            className="px-3.5 py-2 border border-[#e5dfd3] bg-[#f5f2eb]/70 hover:border-[#24231f] text-[10px] tracking-[0.14em] uppercase font-semibold text-[#211f1b] transition-colors cursor-pointer disabled:opacity-40"
          >
            Select All Filtered ({filteredOrders.length})
          </button>

          <button
            type="button"
            disabled={selectedOrders.length === 0}
            onClick={handleDeselectAll}
            className="px-3.5 py-2 border border-[#e5dfd3] bg-[#fffdf8] hover:border-[#24231f] text-[10px] tracking-[0.14em] uppercase font-semibold text-[#5f594f] hover:text-[#211f1b] transition-colors cursor-pointer disabled:opacity-40"
          >
            Deselect All
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center border border-[#e5dfd3] bg-[#f5f2eb]/60 p-0.5">
            <button
              type="button"
              onClick={() => setLabelLayout('a4')}
              className={`px-3 py-1.5 text-[10px] tracking-[0.12em] uppercase font-semibold transition-colors cursor-pointer ${
                labelLayout === 'a4'
                  ? 'bg-[#24231f] text-white'
                  : 'text-[#5f594f] hover:text-[#211f1b]'
              }`}
            >
              A4 Sheet
            </button>
            <button
              type="button"
              onClick={() => setLabelLayout('4x6')}
              className={`px-3 py-1.5 text-[10px] tracking-[0.12em] uppercase font-semibold transition-colors cursor-pointer ${
                labelLayout === '4x6'
                  ? 'bg-[#24231f] text-white'
                  : 'text-[#5f594f] hover:text-[#211f1b]'
              }`}
            >
              4 &times; 6 in
            </button>
          </div>

          <button
            type="button"
            disabled={selectedOrders.length === 0 || generatingType !== null}
            onClick={() => handleRequestPdf('sheet')}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#24231f] text-white text-[10px] tracking-[0.15em] uppercase font-semibold hover:bg-[#9a6746] transition-colors cursor-pointer disabled:opacity-40"
          >
            {generatingType === 'sheet' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileDown className="w-3.5 h-3.5" />
            )}
            <span>Download Bulk Order PDF</span>
          </button>

          <button
            type="button"
            disabled={selectedOrders.length === 0 || generatingType !== null}
            onClick={() => handleRequestPdf('labels')}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#9a6746] text-white text-[10px] tracking-[0.15em] uppercase font-semibold hover:bg-[#7f5336] transition-colors cursor-pointer disabled:opacity-40"
          >
            {generatingType === 'labels' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Printer className="w-3.5 h-3.5" />
            )}
            <span>Download Shipping Labels</span>
          </button>

          <button
            type="button"
            disabled={selectedOrders.length === 0 || markingShipped}
            onClick={() => setShipConfirmOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-[#24231f] text-[#211f1b] text-[10px] tracking-[0.15em] uppercase font-semibold hover:bg-[#24231f] hover:text-white transition-colors cursor-pointer disabled:opacity-40"
          >
            <Truck className="w-3.5 h-3.5" />
            <span>Mark Selected as Shipped</span>
          </button>
        </div>
      </section>

      {actionNotice && (
        <div
          role="status"
          className={`p-4 border text-xs flex items-start gap-2.5 ${
            actionNotice.type === 'err'
              ? 'bg-[#fef2f2] border-[#fecaca] text-[#b91c1c]'
              : actionNotice.type === 'warn'
                ? 'bg-[#fffbeb] border-[#fde68a] text-[#92400e]'
                : 'bg-[#ecfdf5] border-[#a7f3d0] text-[#2b6345]'
          }`}
        >
          {actionNotice.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{actionNotice.text}</span>
        </div>
      )}

      {/* Filtered Orders Selection Table & Mobile Cards */}
      <div className="bg-[#fffdf8] border border-[#e5dfd3] overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs text-[#817b70]">
            Loading orders from Supabase...
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-12 text-center">
            <p className="font-serif-display text-2xl text-[#211f1b]">
              No matching orders to display
            </p>
            <p className="text-xs text-[#817b70] mt-1.5">
              {uniqueOrders.length === 0
                ? 'Customer orders placed through checkout will appear here automatically.'
                : 'Try adjusting your date range, status toggles, or location filters.'}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#e5dfd3] bg-[#f5f2eb]/60 text-[10px] tracking-[0.16em] uppercase text-[#817b70]">
                    <th className="py-3.5 px-4 w-10">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={handleToggleHeaderCheckbox}
                        aria-label="Select all filtered orders"
                        className="accent-[#24231f] w-3.5 h-3.5 cursor-pointer"
                      />
                    </th>
                    <th className="py-3.5 px-3 font-semibold">Order #</th>
                    <th className="py-3.5 px-3 font-semibold">Customer &amp; Phone</th>
                    <th className="py-3.5 px-3 font-semibold">Delivery Address</th>
                    <th className="py-3.5 px-3 font-semibold">Items</th>
                    <th className="py-3.5 px-3 font-semibold">Payment</th>
                    <th className="py-3.5 px-3 font-semibold">Status</th>
                    <th className="py-3.5 px-4 font-semibold text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e5dfd3] text-xs">
                  {filteredOrders.map((order) => {
                    const checked = selectedIds.has(order.id);
                    const addrValidation = validateOrderForShipping(order);
                    const { streetLines, cityStatePin } = formatFullAddressLines(
                      order.shipping_address
                    );
                    const paymentInfo = getLabelPaymentInfo(order);
                    const items = order.order_items ?? [];
                    const totalQty = items.reduce(
                      (s, it) => s + Number(it.quantity || 0),
                      0
                    );

                    return (
                      <tr
                        key={order.id}
                        className={`transition-colors ${
                          checked ? 'bg-[#f9f4ec]' : 'hover:bg-[#f5f2eb]/40'
                        }`}
                      >
                        <td className="py-3.5 px-4 align-top">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleOrderSelection(order.id)}
                            aria-label={`Select order ${order.order_number}`}
                            className="accent-[#24231f] w-3.5 h-3.5 mt-0.5 cursor-pointer"
                          />
                        </td>

                        <td className="py-3.5 px-3 align-top whitespace-nowrap">
                          <p className="font-semibold text-[#211f1b] tabular-nums">
                            {order.order_number}
                          </p>
                          <p className="text-[11px] text-[#817b70] mt-0.5 tabular-nums">
                            {formatOrderTimestamp(order.created_at)}
                          </p>
                          <button
                            type="button"
                            onClick={() => onInspectOrder(order)}
                            className="mt-1 inline-flex items-center gap-1 text-[10px] tracking-[0.1em] uppercase font-semibold text-[#9a6746] hover:text-[#211f1b] cursor-pointer"
                          >
                            <span>Inspect</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </button>
                        </td>

                        <td className="py-3.5 px-3 align-top">
                          <p className="font-medium text-[#211f1b]">
                            {order.customer_name || '—'}
                          </p>
                          <p className="text-[11px] text-[#5f594f] mt-0.5 tabular-nums">
                            {order.customer_phone || 'No phone'}
                          </p>
                        </td>

                        <td className="py-3.5 px-3 align-top max-w-[260px]">
                          <p className="text-[11px] text-[#211f1b] leading-snug">
                            {streetLines.join(', ') || 'Missing street address'}
                          </p>
                          <p className="text-[11px] text-[#5f594f] mt-0.5">
                            {cityStatePin || 'Missing city / PIN'}
                          </p>
                          {!addrValidation.valid && (
                            <div className="mt-1.5 inline-flex items-start gap-1 text-[10px] text-[#b91c1c] bg-[#fef2f2] border border-[#fecaca] px-2 py-0.5">
                              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                              <span>{addrValidation.issues.join(', ')}</span>
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-3 align-top max-w-[210px]">
                          <p className="font-medium text-[#211f1b] tabular-nums">
                            {totalQty} {totalQty === 1 ? 'unit' : 'units'}
                          </p>
                          <p className="text-[11px] text-[#5f594f] mt-0.5 line-clamp-2">
                            {items
                              .map(
                                (i) => `${i.product_name} (${i.selected_size}×${i.quantity})`
                              )
                              .join(', ') || 'No items'}
                          </p>
                        </td>

                        <td className="py-3.5 px-3 align-top whitespace-nowrap">
                          <span
                            className={`inline-block px-2 py-0.5 text-[10px] tracking-[0.1em] uppercase font-bold border ${
                              paymentInfo.mode === 'COD'
                                ? 'bg-[#24231f] text-white border-[#24231f]'
                                : 'bg-[#ecfdf5] text-[#2b6345] border-[#a7f3d0]'
                            }`}
                          >
                            {paymentInfo.mode}
                          </span>
                          <p className="text-[10px] text-[#817b70] mt-1 uppercase">
                            {order.payment_status.replace('_', ' ')}
                          </p>
                        </td>

                        <td className="py-3.5 px-3 align-top whitespace-nowrap">
                          <span
                            className={`inline-block px-2.5 py-1 text-[10px] tracking-[0.12em] uppercase font-semibold border ${statusBadgeClass(
                              order.order_status
                            )}`}
                          >
                            {order.order_status}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 align-top text-right font-semibold text-[#211f1b] tabular-nums whitespace-nowrap">
                          {formatINR(order.total_inr)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Responsive Order Cards */}
            <div className="md:hidden divide-y divide-[#e5dfd3]">
              {filteredOrders.map((order) => {
                const checked = selectedIds.has(order.id);
                const addrValidation = validateOrderForShipping(order);
                const { streetLines, cityStatePin } = formatFullAddressLines(
                  order.shipping_address
                );
                const paymentInfo = getLabelPaymentInfo(order);
                const items = order.order_items ?? [];
                const totalQty = items.reduce(
                  (s, it) => s + Number(it.quantity || 0),
                  0
                );

                return (
                  <div
                    key={order.id}
                    className={`p-4 space-y-2.5 ${
                      checked ? 'bg-[#f9f4ec]' : 'bg-[#fffdf8]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <label className="inline-flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOrderSelection(order.id)}
                          className="accent-[#24231f] w-4 h-4 mt-0.5"
                        />
                        <div>
                          <p className="text-xs font-bold text-[#211f1b] tabular-nums">
                            {order.order_number}
                          </p>
                          <p className="text-[11px] text-[#817b70]">
                            {formatOrderTimestamp(order.created_at)}
                          </p>
                        </div>
                      </label>

                      <span
                        className={`px-2 py-0.5 text-[10px] tracking-[0.1em] uppercase font-semibold border ${statusBadgeClass(
                          order.order_status
                        )}`}
                      >
                        {order.order_status}
                      </span>
                    </div>

                    <div className="pl-6 space-y-1.5 text-xs">
                      <p className="font-medium text-[#211f1b]">
                        {order.customer_name} &middot;{' '}
                        <span className="tabular-nums text-[#5f594f]">
                          {order.customer_phone}
                        </span>
                      </p>

                      <p className="text-[11px] text-[#5f594f]">
                        <MapPin className="w-3 h-3 inline mr-1 text-[#9a6746]" />
                        {[...streetLines, cityStatePin].filter(Boolean).join(', ') ||
                          'Address incomplete'}
                      </p>

                      {!addrValidation.valid && (
                        <p className="text-[11px] text-[#b91c1c] bg-[#fef2f2] border border-[#fecaca] px-2 py-1">
                          Incomplete: {addrValidation.issues.join(', ')}
                        </p>
                      )}

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[11px] text-[#5f594f] tabular-nums">
                          {totalQty} {totalQty === 1 ? 'item' : 'items'} &middot;{' '}
                          <strong>{paymentInfo.mode}</strong> &middot;{' '}
                          <strong>{formatINR(order.total_inr)}</strong>
                        </span>
                        <button
                          type="button"
                          onClick={() => onInspectOrder(order)}
                          className="text-[10px] tracking-[0.12em] uppercase font-semibold text-[#9a6746]"
                        >
                          Inspect
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Pre-PDF Incomplete Address Warning Modal */}
      {validationModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => setValidationModal(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Address validation warning"
        >
          <div
            className="w-full max-w-xl bg-[#fffdf8] border border-[#e5dfd3] p-6 shadow-2xl max-h-[88vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#e5dfd3]">
              <div>
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#b91c1c] font-bold">
                  Pre-Print Address Validation
                </p>
                <h3 className="font-serif-display text-2xl text-[#211f1b] mt-1">
                  {validationModal.invalidEntries.length}{' '}
                  {validationModal.invalidEntries.length === 1
                    ? 'Order Has'
                    : 'Orders Have'}{' '}
                  Incomplete Delivery Details
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setValidationModal(null)}
                aria-label="Close validation modal"
                className="p-1.5 text-[#817b70] hover:text-[#211f1b] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-[#5f594f] mt-3 leading-relaxed">
              The orders below are missing required recipient or delivery details (name, 10-digit phone, street address, city, state, or 6-digit PIN code). Review them before printing or exclude them from this batch.
            </p>

            <div className="mt-4 overflow-y-auto space-y-2.5 pr-1 flex-1">
              {validationModal.invalidEntries.map(({ order, issues }) => (
                <div
                  key={order.id}
                  className="p-3.5 bg-[#fef2f2] border border-[#fecaca] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div>
                    <p className="text-xs font-bold text-[#211f1b] tabular-nums">
                      {order.order_number} &middot;{' '}
                      <span className="font-medium">
                        {order.customer_name || 'Unnamed customer'}
                      </span>
                    </p>
                    <p className="text-[11px] text-[#b91c1c] mt-1">
                      {issues.join(' · ')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setValidationModal(null);
                      onInspectOrder(order);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#fffdf8] border border-[#e5dfd3] hover:border-[#24231f] text-[10px] tracking-[0.12em] uppercase font-semibold text-[#211f1b] shrink-0 cursor-pointer"
                  >
                    <span>Open Order Details</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-5 pt-4 border-t border-[#e5dfd3] flex flex-col-reverse sm:flex-row justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setValidationModal(null)}
                className="px-5 py-2.5 border border-[#e5dfd3] text-[10px] tracking-[0.16em] uppercase font-semibold text-[#5f594f] hover:text-[#211f1b] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={validationModal.validOrders.length === 0}
                onClick={handleConfirmExcludeAndExport}
                className="px-5 py-2.5 bg-[#24231f] text-white text-[10px] tracking-[0.16em] uppercase font-semibold hover:bg-[#9a6746] transition-colors cursor-pointer disabled:opacity-40"
              >
                {validationModal.validOrders.length === 0
                  ? 'No Valid Orders Remaining'
                  : `Exclude ${validationModal.invalidEntries.length} & Download (${validationModal.validOrders.length} valid)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Mark Shipped Confirmation Modal */}
      {shipConfirmOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => !markingShipped && setShipConfirmOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Confirm marking selected orders as shipped"
        >
          <div
            className="w-full max-w-lg bg-[#fffdf8] border border-[#e5dfd3] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#e5dfd3]">
              <div>
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#9a6746] font-bold">
                  Confirm Dispatch Status Update
                </p>
                <h3 className="font-serif-display text-2xl text-[#211f1b] mt-1">
                  Mark {shipBreakdown.eligible.length} of {selectedOrders.length}{' '}
                  Selected as Shipped?
                </h3>
              </div>
              <button
                type="button"
                disabled={markingShipped}
                onClick={() => setShipConfirmOpen(false)}
                aria-label="Close modal"
                className="p-1.5 text-[#817b70] hover:text-[#211f1b] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs text-[#5f594f]">
              <p className="leading-relaxed">
                This will permanently update eligible orders (<strong>pending</strong>,{' '}
                <strong>confirmed</strong>, or <strong>packed</strong>) to{' '}
                <strong className="text-[#211f1b]">Shipped</strong> in Supabase.
              </p>

              <div className="p-3.5 bg-[#f5f2eb] border border-[#e5dfd3] space-y-1.5 tabular-nums">
                <p className="text-[#211f1b] font-semibold">
                  Selected Orders: {selectedOrders.length}
                </p>
                <p>
                  Eligible to mark Shipped:{' '}
                  <strong className="text-[#2b6345]">
                    {shipBreakdown.eligible.length}
                  </strong>
                </p>
                {shipBreakdown.alreadyShipped.length > 0 && (
                  <p>
                    Already Shipped (unchanged):{' '}
                    <strong>{shipBreakdown.alreadyShipped.length}</strong>
                  </p>
                )}
                {shipBreakdown.delivered.length > 0 && (
                  <p>
                    Delivered (protected):{' '}
                    <strong>{shipBreakdown.delivered.length}</strong>
                  </p>
                )}
                {shipBreakdown.cancelled.length > 0 && (
                  <p className="text-[#b91c1c]">
                    Cancelled (strictly protected — will NOT be marked shipped):{' '}
                    <strong>{shipBreakdown.cancelled.length}</strong>
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-[#e5dfd3] flex flex-col-reverse sm:flex-row justify-end gap-2.5">
              <button
                type="button"
                disabled={markingShipped}
                onClick={() => setShipConfirmOpen(false)}
                className="px-5 py-2.5 border border-[#e5dfd3] text-[10px] tracking-[0.16em] uppercase font-semibold text-[#5f594f] hover:text-[#211f1b] cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={markingShipped || shipBreakdown.eligible.length === 0}
                onClick={handleConfirmMarkShipped}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#24231f] text-white text-[10px] tracking-[0.16em] uppercase font-semibold hover:bg-[#9a6746] transition-colors cursor-pointer disabled:opacity-40"
              >
                <Truck className="w-3.5 h-3.5" />
                <span>
                  {markingShipped
                    ? 'Updating Orders...'
                    : `Confirm Mark ${shipBreakdown.eligible.length} Shipped`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
