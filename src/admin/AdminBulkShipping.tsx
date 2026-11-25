import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileDown,
  Filter,
  FlaskConical,
  Loader2,
  MapPin,
  Printer,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { formatINR } from '../data/catalog';
import type { Order, OrderStatus, PaymentStatus } from '../types';
import {
  ADMIN_EASE,
  AdminTableSkeleton,
  AnimatedCounter,
  orderStatusBadgeV2,
} from './AdminMotion';
import {
  type BulkTestOrderSummary,
  bulkMarkOrdersShippedAdmin,
  createShippingTestOrdersAdmin,
  deleteShippingTestOrdersAdmin,
} from './adminService';
import { loadBrowserPdfFonts } from './shipping/shippingFonts';
import {
  generateBulkOrderSheetPdf,
  generateShippingLabelsPdf,
  triggerPdfDownload,
  triggerPdfPrint,
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
  return orderStatusBadgeV2(status);
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
  const [pdfDeliveryMode, setPdfDeliveryMode] = useState<'download' | 'print'>(
    'download'
  );
  const [lastGeneratedPdf, setLastGeneratedPdf] = useState<{
    blob: Blob;
    filename: string;
    label: string;
  } | null>(null);
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

  const [qaPanelOpen, setQaPanelOpen] = useState(false);
  const [qaAction, setQaAction] = useState<'create' | 'delete' | null>(null);
  const [qaConfirmDelete, setQaConfirmDelete] = useState(false);
  const [qaFeedback, setQaFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [qaGeneratedOrders, setQaGeneratedOrders] = useState<BulkTestOrderSummary[]>([]);

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
        setLastGeneratedPdf({
          blob: result.blob,
          filename: result.filename,
          label: `Bulk Order PDF (${result.orderCount} ${
            result.orderCount === 1 ? 'order' : 'orders'
          }, ${result.pageCount} ${result.pageCount === 1 ? 'page' : 'pages'})`,
        });
        if (pdfDeliveryMode === 'print') {
          triggerPdfPrint(result.blob);
        } else {
          triggerPdfDownload(result.blob, result.filename);
        }
        setActionNotice({
          type: 'ok',
          text: `${
            pdfDeliveryMode === 'print' ? 'Prepared for printing' : 'Downloaded'
          }: Bulk Order PDF (${result.orderCount} ${
            result.orderCount === 1 ? 'order' : 'orders'
          }, ${result.pageCount} ${
            result.pageCount === 1 ? 'page' : 'pages'
          }). Order statuses remain unchanged.`,
        });
      } else {
        const result = await generateShippingLabelsPdf(
          ordersToExport,
          senderConfig,
          labelLayout,
          { fonts }
        );
        setLastGeneratedPdf({
          blob: result.blob,
          filename: result.filename,
          label: `Shipping Labels (${result.orderCount} ${
            result.orderCount === 1 ? 'label' : 'labels'
          }, ${labelLayout === '4x6' ? '4 × 6 in' : 'A4 grid'})`,
        });
        if (pdfDeliveryMode === 'print') {
          triggerPdfPrint(result.blob);
        } else {
          triggerPdfDownload(result.blob, result.filename);
        }
        setActionNotice({
          type: 'ok',
          text: `${
            pdfDeliveryMode === 'print' ? 'Prepared for printing' : 'Downloaded'
          }: Shipping Labels (${result.orderCount} ${
            result.orderCount === 1 ? 'label' : 'labels'
          }, ${labelLayout === '4x6' ? '4 × 6 in' : 'A4 grid'}, ${
            result.pageCount
          } ${
            result.pageCount === 1 ? 'page' : 'pages'
          }). Order statuses remain unchanged.`,
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

  const handleGenerateTestOrders = async () => {
    if (qaAction !== null) return;
    setQaAction('create');
    setQaFeedback(null);
    setQaConfirmDelete(false);

    const res = await createShippingTestOrdersAdmin();
    setQaAction(null);

    if (res.error) {
      setQaFeedback({ type: 'err', text: res.error });
      return;
    }

    setQaGeneratedOrders(res.orders);
    setQaFeedback({
      type: 'ok',
      text: `Ready: ${res.total_count} isolated QA test orders (${res.created_count} newly created, ${res.existing_count} already present). Product stock was not deducted.`,
    });
    await onRefresh();
  };

  const handleDeleteTestOrders = async () => {
    if (qaAction !== null) return;
    setQaAction('delete');
    setQaFeedback(null);

    const res = await deleteShippingTestOrdersAdmin();
    setQaAction(null);
    setQaConfirmDelete(false);

    if (res.error) {
      setQaFeedback({ type: 'err', text: res.error });
      return;
    }

    setQaGeneratedOrders([]);
    setQaFeedback({
      type: 'ok',
      text: `Removed ${res.deleted_count} QA test ${
        res.deleted_count === 1 ? 'order' : 'orders'
      }. Real customer orders and product inventory remain untouched.`,
    });
    await onRefresh();
  };

  return (
    <div className="space-y-5">
      {/* Top Section Header + Sender Config Toggle */}
      <div className="rounded-2xl bg-[#0e1622]/85 border border-white/[0.08] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-[11px] tracking-[0.2em] uppercase text-amber-400 font-semibold">
            Dispatch &amp; Packaging Workspace
          </p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white mt-1">
            Shipping Center
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Select verified customer orders, download or print Bulk Order Sheets and internal QR shipping labels, and confirm dispatch status.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setQaPanelOpen((v) => !v)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[11px] tracking-[0.12em] uppercase font-semibold transition-colors cursor-pointer ${
              qaPanelOpen
                ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
                : 'border-white/[0.1] bg-white/[0.03] text-slate-200 hover:bg-white/[0.07] hover:border-white/[0.18]'
            }`}
          >
            <FlaskConical className="w-3.5 h-3.5 text-amber-400" />
            <span>QA Test Orders</span>
            {stats.testOrdersCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 tabular-nums">
                {stats.testOrdersCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSenderPanelOpen((v) => !v)}
            className={`inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-[11px] tracking-[0.12em] uppercase font-semibold transition-colors cursor-pointer shrink-0 ${
              senderValidation.valid
                ? 'border-white/[0.1] bg-white/[0.03] text-slate-200 hover:bg-white/[0.07] hover:border-white/[0.18]'
                : 'border-amber-500/40 bg-amber-500/12 text-amber-200 hover:bg-amber-500/18'
            }`}
          >
            <Settings2 className="w-3.5 h-3.5 text-amber-400" />
            <span>Sender Settings</span>
            <span
              className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${
                senderValidation.valid
                  ? 'bg-emerald-500/12 text-emerald-300 border-emerald-500/25'
                  : 'bg-rose-500/12 text-rose-300 border-rose-500/25'
              }`}
            >
              {senderValidation.valid ? 'Ready' : 'Required'}
            </span>
          </button>
        </div>
      </div>

      {/* Collapsible QA Test Orders Generator / Cleanup Panel */}
      <AnimatePresence>
        {qaPanelOpen && (
          <motion.section
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: ADMIN_EASE }}
            className="rounded-2xl bg-[#0e1622]/90 border border-amber-500/25 p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-white/[0.07]">
              <div>
                <p className="text-[11px] tracking-[0.18em] uppercase text-amber-400 font-semibold">
                  Bulk Shipping QA Utility
                </p>
                <h2 className="text-lg font-semibold text-white mt-1">
                  Isolated 20-Order Shipping Test Suite
                </h2>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Seeds or clears 20 clearly marked{' '}
                  <code className="px-1.5 py-0.5 rounded bg-white/[0.06] text-amber-300 font-mono text-[11px]">
                    is_test_order = true
                  </code>{' '}
                  orders (
                  <code className="text-slate-200 font-mono">AK-910001</code>&ndash;
                  <code className="text-slate-200 font-mono">AK-910020</code>) across 20 Indian cities using existing catalog products and prices. Inventory stock is never deducted, and revenue analytics and customer accounts ignore test orders.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQaPanelOpen(false)}
                aria-label="Close QA test orders panel"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={qaAction !== null}
                onClick={handleGenerateTestOrders}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] tracking-[0.12em] uppercase font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                {qaAction === 'create' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FlaskConical className="w-3.5 h-3.5" />
                )}
                <span>
                  {qaAction === 'create'
                    ? 'Creating Test Orders...'
                    : 'Generate 20 Test Orders'}
                </span>
              </button>

              {stats.testOrdersCount > 0 && !qaConfirmDelete && (
                <button
                  type="button"
                  disabled={qaAction !== null}
                  onClick={() => setQaConfirmDelete(true)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-rose-500/35 bg-rose-500/10 text-rose-300 text-[11px] tracking-[0.12em] uppercase font-semibold hover:bg-rose-500/20 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove All Test Orders ({stats.testOrdersCount})</span>
                </button>
              )}

              {qaConfirmDelete && (
                <div className="inline-flex flex-wrap items-center gap-2 rounded-xl bg-rose-500/10 border border-rose-500/30 px-3.5 py-2 text-xs">
                  <span className="text-rose-200 font-semibold">
                    Delete {stats.testOrdersCount} QA test orders?
                  </span>
                  <button
                    type="button"
                    disabled={qaAction !== null}
                    onClick={handleDeleteTestOrders}
                    className="px-3 py-1 rounded-lg bg-rose-600 text-white text-[10px] tracking-[0.12em] uppercase font-semibold hover:bg-rose-500 cursor-pointer disabled:opacity-50"
                  >
                    {qaAction === 'delete' ? 'Removing...' : 'Confirm Remove'}
                  </button>
                  <button
                    type="button"
                    disabled={qaAction !== null}
                    onClick={() => setQaConfirmDelete(false)}
                    className="px-3 py-1 rounded-lg border border-white/[0.12] bg-white/[0.04] text-slate-300 text-[10px] tracking-[0.12em] uppercase font-semibold hover:text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {qaFeedback && (
              <p
                className={`text-xs p-3.5 rounded-xl border ${
                  qaFeedback.type === 'err'
                    ? 'bg-rose-500/10 border-rose-500/25 text-rose-200'
                    : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-200'
                }`}
              >
                {qaFeedback.text}
              </p>
            )}

            {qaGeneratedOrders.length > 0 && (
              <div className="rounded-xl border border-white/[0.08] max-h-64 overflow-y-auto bg-[#080d14]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-[#0d1520] border-b border-white/[0.07] text-[10px] tracking-[0.14em] uppercase text-slate-400">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Order #</th>
                      <th className="py-2.5 px-3 font-semibold">Order UUID</th>
                      <th className="py-2.5 px-3 font-semibold">Customer</th>
                      <th className="py-2.5 px-3 font-semibold">City &amp; PIN</th>
                      <th className="py-2.5 px-3 font-semibold">Status</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {qaGeneratedOrders.map((row) => (
                      <tr key={row.id} className="hover:bg-white/[0.02]">
                        <td className="py-2 px-3 font-semibold text-white tabular-nums whitespace-nowrap">
                          {row.order_number}
                        </td>
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                          {row.id}
                        </td>
                        <td className="py-2 px-3 text-slate-200">{row.customer_name}</td>
                        <td className="py-2 px-3 text-slate-400 whitespace-nowrap">
                          {row.city}, {row.state} &ndash; {row.pincode}
                        </td>
                        <td className="py-2 px-3 capitalize text-slate-300 whitespace-nowrap">
                          {row.order_status} &middot;{' '}
                          {row.payment_method === 'cod' ? 'COD' : 'Online'}
                        </td>
                        <td className="py-2 px-3 text-right font-semibold text-white tabular-nums">
                          {formatINR(row.total_inr)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {/* Configurable APNA KAPDA Sender Dispatch Settings */}
      <AnimatePresence>
        {senderPanelOpen && (
          <motion.section
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: ADMIN_EASE }}
            className="rounded-2xl bg-[#0e1622]/90 border border-amber-500/25 p-5 sm:p-6"
          >
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-white/[0.07]">
              <div>
                <p className="text-[11px] tracking-[0.18em] uppercase text-amber-400 font-semibold">
                  Return &amp; Origin Details for Labels
                </p>
                <h2 className="text-lg font-semibold text-white mt-1">
                  APNA KAPDA Sender Configuration
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSenderPanelOpen(false)}
                aria-label="Close sender settings"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSenderConfig} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] tracking-[0.14em] uppercase font-semibold text-slate-400 mb-1.5">
                    Sender / Brand Name *
                  </label>
                  <input
                    type="text"
                    value={senderDraft.senderName}
                    onChange={(e) =>
                      setSenderDraft((s) => ({ ...s, senderName: e.target.value }))
                    }
                    placeholder="APNA KAPDA"
                    className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100 placeholder:text-slate-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] tracking-[0.14em] uppercase font-semibold text-slate-400 mb-1.5">
                    Dispatch Phone (10 digits) *
                  </label>
                  <input
                    type="tel"
                    value={senderDraft.phone}
                    onChange={(e) =>
                      setSenderDraft((s) => ({ ...s, phone: e.target.value }))
                    }
                    placeholder="9876543210"
                    className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100 placeholder:text-slate-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] tracking-[0.14em] uppercase font-semibold text-slate-400 mb-1.5">
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
                    className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100 placeholder:text-slate-500 tabular-nums"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[10px] tracking-[0.14em] uppercase font-semibold text-slate-400 mb-1.5">
                    Warehouse / Studio Address Line 1 *
                  </label>
                  <input
                    type="text"
                    value={senderDraft.addressLine1}
                    onChange={(e) =>
                      setSenderDraft((s) => ({ ...s, addressLine1: e.target.value }))
                    }
                    placeholder="Unit 4B, Kala Ghoda Textile Hub"
                    className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100 placeholder:text-slate-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] tracking-[0.14em] uppercase font-semibold text-slate-400 mb-1.5">
                    Address Line 2 (Optional)
                  </label>
                  <input
                    type="text"
                    value={senderDraft.addressLine2}
                    onChange={(e) =>
                      setSenderDraft((s) => ({ ...s, addressLine2: e.target.value }))
                    }
                    placeholder="Fort, South Mumbai"
                    className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100 placeholder:text-slate-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] tracking-[0.14em] uppercase font-semibold text-slate-400 mb-1.5">
                    City *
                  </label>
                  <input
                    type="text"
                    value={senderDraft.city}
                    onChange={(e) =>
                      setSenderDraft((s) => ({ ...s, city: e.target.value }))
                    }
                    placeholder="Mumbai"
                    className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100 placeholder:text-slate-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] tracking-[0.14em] uppercase font-semibold text-slate-400 mb-1.5">
                    State *
                  </label>
                  <input
                    type="text"
                    value={senderDraft.state}
                    onChange={(e) =>
                      setSenderDraft((s) => ({ ...s, state: e.target.value }))
                    }
                    placeholder="Maharashtra"
                    className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100 placeholder:text-slate-500"
                  />
                </div>
              </div>

              {senderFeedback && (
                <p
                  className={`text-xs p-3.5 rounded-xl border ${
                    senderFeedback.type === 'err'
                      ? 'bg-rose-500/10 border-rose-500/25 text-rose-200'
                      : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-200'
                  }`}
                >
                  {senderFeedback.text}
                </p>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] tracking-[0.12em] uppercase font-bold transition-colors cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Sender Details</span>
                </button>
              </div>
            </form>
          </motion.section>
        )}
      </AnimatePresence>

      {/* KPI Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-gradient-to-br from-[#131d2b]/95 to-[#0d141f]/95 border border-white/[0.08] p-5 hover:border-white/[0.15] transition-colors">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] tracking-[0.14em] uppercase font-semibold">
              Total Orders
            </span>
            <span className="w-8 h-8 rounded-xl bg-sky-500/12 border border-sky-500/20 flex items-center justify-center">
              <Truck className="w-4 h-4 text-sky-400" />
            </span>
          </div>
          <p className="text-3xl font-semibold text-white mt-3 tabular-nums">
            {loading ? '—' : <AnimatedCounter value={stats.totalOrders} />}
          </p>
          <p className="text-[11px] text-slate-400 mt-2">
            {stats.testOrdersCount > 0
              ? `Includes ${stats.testOrdersCount} QA test ${
                  stats.testOrdersCount === 1 ? 'order' : 'orders'
                }`
              : 'Synced directly from Supabase orders'}
          </p>
        </div>

        <div className="rounded-2xl bg-gradient-to-br from-[#131d2b]/95 to-[#0d141f]/95 border border-white/[0.08] p-5 hover:border-white/[0.15] transition-colors">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] tracking-[0.14em] uppercase font-semibold">
              Orders Ready to Ship
            </span>
            <span className="w-8 h-8 rounded-xl bg-amber-500/12 border border-amber-500/20 flex items-center justify-center">
              <Printer className="w-4 h-4 text-amber-400" />
            </span>
          </div>
          <p className="text-3xl font-semibold text-white mt-3 tabular-nums">
            {loading ? '—' : <AnimatedCounter value={stats.readyToShipOrders} />}
          </p>
          <p className="text-[11px] text-slate-400 mt-2">
            Status: pending, confirmed, or packed
          </p>
        </div>

        <div className="rounded-2xl bg-gradient-to-br from-[#131d2b]/95 to-[#0d141f]/95 border border-white/[0.08] p-5 hover:border-white/[0.15] transition-colors">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] tracking-[0.14em] uppercase font-semibold">
              Orders Already Shipped
            </span>
            <span className="w-8 h-8 rounded-xl bg-emerald-500/12 border border-emerald-500/20 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </span>
          </div>
          <p className="text-3xl font-semibold text-white mt-3 tabular-nums">
            {loading ? '—' : <AnimatedCounter value={stats.shippedOrders} />}
          </p>
          <p className="text-[11px] text-slate-400 mt-2">
            Dispatched &amp; awaiting customer delivery
          </p>
        </div>

        <div className="rounded-2xl bg-gradient-to-br from-[#131d2b]/95 to-[#0d141f]/95 border border-white/[0.08] p-5 hover:border-white/[0.15] transition-colors">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] tracking-[0.14em] uppercase font-semibold">
              Incomplete Delivery Addresses
            </span>
            <span
              className={`w-8 h-8 rounded-xl border flex items-center justify-center ${
                stats.incompleteAddressOrders > 0
                  ? 'bg-rose-500/12 border-rose-500/25'
                  : 'bg-teal-500/12 border-teal-500/20'
              }`}
            >
              <AlertTriangle
                className={`w-4 h-4 ${
                  stats.incompleteAddressOrders > 0
                    ? 'text-rose-400'
                    : 'text-teal-400'
                }`}
              />
            </span>
          </div>
          <p
            className={`text-3xl font-semibold mt-3 tabular-nums ${
              stats.incompleteAddressOrders > 0 ? 'text-rose-400' : 'text-white'
            }`}
          >
            {loading ? (
              '—'
            ) : (
              <AnimatedCounter value={stats.incompleteAddressOrders} />
            )}
          </p>
          <p className="text-[11px] text-slate-400 mt-2">
            Active orders missing phone, address, or 6-digit PIN
          </p>
        </div>
      </div>

      {/* Filters Toolbar */}
      <section className="rounded-2xl bg-[#0e1622]/85 border border-white/[0.08] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-[11px] tracking-[0.16em] uppercase font-semibold text-amber-400">
            <Filter className="w-3.5 h-3.5" />
            <span>Filter Orders</span>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-400 tabular-nums">
              Showing <strong className="text-white">{filteredOrders.length}</strong> of{' '}
              {uniqueOrders.length} orders
            </span>
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_SHIPPING_FILTERS)}
              className="inline-flex items-center gap-1.5 text-[11px] tracking-[0.1em] uppercase font-semibold text-slate-400 hover:text-amber-300 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Filters</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-[10px] tracking-[0.12em] uppercase text-slate-400 mb-1.5">
              Search Order ID
            </label>
            <input
              type="text"
              value={filters.orderIdQuery}
              onChange={(e) =>
                setFilters((f) => ({ ...f, orderIdQuery: e.target.value }))
              }
              placeholder="e.g. AK-104218"
              className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100 placeholder:text-slate-500"
            />
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.12em] uppercase text-slate-400 mb-1.5">
              Customer Name or Phone
            </label>
            <input
              type="text"
              value={filters.customerQuery}
              onChange={(e) =>
                setFilters((f) => ({ ...f, customerQuery: e.target.value }))
              }
              placeholder="Name or 10-digit phone..."
              className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100 placeholder:text-slate-500"
            />
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.12em] uppercase text-slate-400 mb-1.5">
              City
            </label>
            <input
              type="text"
              value={filters.cityQuery}
              onChange={(e) =>
                setFilters((f) => ({ ...f, cityQuery: e.target.value }))
              }
              placeholder="e.g. Mumbai, Delhi"
              className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100 placeholder:text-slate-500"
            />
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.12em] uppercase text-slate-400 mb-1.5">
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
              className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100 placeholder:text-slate-500 tabular-nums"
            />
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.12em] uppercase text-slate-400 mb-1.5">
              From Date
            </label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) =>
                setFilters((f) => ({ ...f, dateFrom: e.target.value }))
              }
              className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100 [color-scheme:dark]"
            />
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.12em] uppercase text-slate-400 mb-1.5">
              To Date
            </label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) =>
                setFilters((f) => ({ ...f, dateTo: e.target.value }))
              }
              className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100 [color-scheme:dark]"
            />
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.12em] uppercase text-slate-400 mb-1.5">
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
              className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100 capitalize"
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
            <label className="block text-[10px] tracking-[0.12em] uppercase text-slate-400 mb-1.5">
              Payment Method
            </label>
            <select
              value={filters.paymentMethod}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  paymentMethod: e.target.value as ShippingFiltersState['paymentMethod'],
                }))
              }
              aria-label="Filter shipping orders by payment method"
              className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100"
            >
              <option value="all">All Payment Methods</option>
              <option value="cod">Cash on Delivery (COD)</option>
              <option value="online_pending">Online Payment</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.12em] uppercase text-slate-400 mb-1.5">
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
              className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100"
            >
              <option value="all">All Payment Statuses</option>
              {ALL_PAYMENT_STATUSES.map((p) => (
                <option key={p} value={p}>
                  {p.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.12em] uppercase text-slate-400 mb-1.5">
              Order Scope
            </label>
            <select
              value={filters.orderScope}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  orderScope: e.target.value as ShippingFiltersState['orderScope'],
                }))
              }
              aria-label="Filter shipping orders by scope"
              className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100"
            >
              <option value="all">All Orders (Live &amp; QA Test)</option>
              <option value="live">Live Customer Orders</option>
              <option value="test">QA Test Orders Only</option>
            </select>
          </div>
        </div>

        {filters.orderStatus === 'default_dispatch' && (
          <div className="flex flex-wrap items-center gap-5 pt-3 border-t border-white/[0.07] text-xs text-slate-300">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filters.includeDelivered}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, includeDelivered: e.target.checked }))
                }
                className="accent-amber-500 w-3.5 h-3.5 rounded"
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
                className="accent-amber-500 w-3.5 h-3.5 rounded"
              />
              <span>Include Cancelled Orders</span>
            </label>
          </div>
        )}
      </section>

      {/* Selection & Print/Dispatch Action Bar */}
      <section className="rounded-2xl bg-[#0e1622]/85 border border-white/[0.08] p-4 sm:p-5 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="px-3.5 py-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-[11px] tracking-[0.1em] uppercase font-bold tabular-nums">
            Selected: {selectedOrders.length}
          </span>

          <button
            type="button"
            disabled={filteredOrders.length === 0}
            onClick={handleSelectAllFiltered}
            className="px-3.5 py-2 rounded-xl border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-[11px] tracking-[0.1em] uppercase font-semibold text-slate-200 transition-colors cursor-pointer disabled:opacity-40"
          >
            Select All Filtered ({filteredOrders.length})
          </button>

          <button
            type="button"
            disabled={selectedOrders.length === 0}
            onClick={handleDeselectAll}
            className="px-3.5 py-2 rounded-xl border border-white/[0.08] bg-transparent hover:bg-white/[0.05] text-[11px] tracking-[0.1em] uppercase font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer disabled:opacity-40"
          >
            Deselect All
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center rounded-xl border border-white/[0.09] bg-[#080d14] p-0.5">
            <button
              type="button"
              onClick={() => setLabelLayout('a4')}
              className={`px-3 py-1.5 rounded-lg text-[10px] tracking-[0.12em] uppercase font-semibold transition-colors cursor-pointer ${
                labelLayout === 'a4'
                  ? 'bg-white/[0.12] text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              A4 Sheet
            </button>
            <button
              type="button"
              onClick={() => setLabelLayout('4x6')}
              className={`px-3 py-1.5 rounded-lg text-[10px] tracking-[0.12em] uppercase font-semibold transition-colors cursor-pointer ${
                labelLayout === '4x6'
                  ? 'bg-white/[0.12] text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              4 &times; 6 in
            </button>
          </div>

          <div className="flex items-center rounded-xl border border-white/[0.09] bg-[#080d14] p-0.5">
            <button
              type="button"
              onClick={() => setPdfDeliveryMode('download')}
              className={`px-3 py-1.5 rounded-lg text-[10px] tracking-[0.12em] uppercase font-semibold transition-colors cursor-pointer ${
                pdfDeliveryMode === 'download'
                  ? 'bg-white/[0.12] text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Download PDF
            </button>
            <button
              type="button"
              onClick={() => setPdfDeliveryMode('print')}
              className={`px-3 py-1.5 rounded-lg text-[10px] tracking-[0.12em] uppercase font-semibold transition-colors cursor-pointer ${
                pdfDeliveryMode === 'print'
                  ? 'bg-white/[0.12] text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Print PDF
            </button>
          </div>

          <button
            type="button"
            disabled={selectedOrders.length === 0 || generatingType !== null}
            onClick={() => handleRequestPdf('sheet')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.12] text-white text-[11px] tracking-[0.1em] uppercase font-semibold transition-colors cursor-pointer disabled:opacity-40"
          >
            {generatingType === 'sheet' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileDown className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span>Download Bulk Order PDF</span>
          </button>

          <button
            type="button"
            disabled={selectedOrders.length === 0 || generatingType !== null}
            onClick={() => handleRequestPdf('labels')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] tracking-[0.1em] uppercase font-bold transition-colors cursor-pointer disabled:opacity-40"
          >
            {generatingType === 'labels' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Printer className="w-3.5 h-3.5" />
            )}
            <span>Generate Shipping Labels</span>
          </button>

          <button
            type="button"
            disabled={selectedOrders.length === 0 || markingShipped}
            onClick={() => setShipConfirmOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-teal-500/40 bg-teal-500/12 text-teal-200 hover:bg-teal-500/22 text-[11px] tracking-[0.1em] uppercase font-semibold transition-colors cursor-pointer disabled:opacity-40"
          >
            <Truck className="w-3.5 h-3.5" />
            <span>Mark Selected as Shipped</span>
          </button>
        </div>
      </section>

      {actionNotice && (
        <div
          role="status"
          className={`p-4 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-3 ${
            actionNotice.type === 'err'
              ? 'bg-rose-500/10 border-rose-500/25 text-rose-200'
              : actionNotice.type === 'warn'
                ? 'bg-amber-500/10 border-amber-500/25 text-amber-200'
                : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {actionNotice.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{actionNotice.text}</span>
          </div>

          {lastGeneratedPdf && actionNotice.type === 'ok' && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  triggerPdfDownload(lastGeneratedPdf.blob, lastGeneratedPdf.filename)
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-400/35 text-emerald-200 text-[10px] tracking-[0.12em] uppercase font-semibold hover:bg-emerald-500/25 transition-colors cursor-pointer"
              >
                <FileDown className="w-3 h-3" />
                <span>Download</span>
              </button>
              <button
                type="button"
                onClick={() => triggerPdfPrint(lastGeneratedPdf.blob)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 text-[10px] tracking-[0.12em] uppercase font-bold hover:bg-emerald-400 transition-colors cursor-pointer"
              >
                <Printer className="w-3 h-3" />
                <span>Print</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Filtered Orders Selection Table & Mobile Cards */}
      <div className="rounded-2xl bg-[#0e1622]/85 border border-white/[0.08] overflow-hidden">
        {loading ? (
          <AdminTableSkeleton rows={6} />
        ) : filteredOrders.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-lg font-semibold text-white">
              No matching orders to display
            </p>
            <p className="text-xs text-slate-400 mt-1.5">
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
                  <tr className="border-b border-white/[0.07] bg-white/[0.02] text-[10px] tracking-[0.14em] uppercase text-slate-400">
                    <th className="py-3.5 px-4 w-10">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={handleToggleHeaderCheckbox}
                        aria-label="Select all filtered orders"
                        className="accent-amber-500 w-3.5 h-3.5 cursor-pointer"
                      />
                    </th>
                    <th className="py-3.5 px-3 font-semibold">Order # &amp; Date</th>
                    <th className="py-3.5 px-3 font-semibold">Customer &amp; Phone</th>
                    <th className="py-3.5 px-3 font-semibold">City &amp; PIN</th>
                    <th className="py-3.5 px-3 font-semibold">Delivery Address</th>
                    <th className="py-3.5 px-3 font-semibold">Items</th>
                    <th className="py-3.5 px-3 font-semibold">Payment</th>
                    <th className="py-3.5 px-3 font-semibold">Status</th>
                    <th className="py-3.5 px-4 font-semibold text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05] text-xs">
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
                          checked ? 'bg-amber-500/[0.08]' : 'hover:bg-white/[0.025]'
                        }`}
                      >
                        <td className="py-3.5 px-4 align-top">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleOrderSelection(order.id)}
                            aria-label={`Select order ${order.order_number}`}
                            className="accent-amber-500 w-3.5 h-3.5 mt-0.5 cursor-pointer"
                          />
                        </td>

                        <td className="py-3.5 px-3 align-top whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <p className="font-semibold text-white tabular-nums">
                              {order.order_number}
                            </p>
                            {order.is_test_order && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] tracking-[0.12em] uppercase font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                TEST
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                            {formatOrderTimestamp(order.created_at)}
                          </p>
                          <button
                            type="button"
                            onClick={() => onInspectOrder(order)}
                            className="mt-1 inline-flex items-center gap-1 text-[10px] tracking-[0.1em] uppercase font-semibold text-amber-400 hover:text-amber-300 cursor-pointer"
                          >
                            <span>Inspect</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </button>
                        </td>

                        <td className="py-3.5 px-3 align-top">
                          <p className="font-medium text-slate-100">
                            {order.customer_name || '—'}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                            {order.customer_phone || 'No phone'}
                          </p>
                        </td>

                        <td className="py-3.5 px-3 align-top whitespace-nowrap">
                          <p className="font-medium text-slate-100">
                            {order.shipping_address?.city || '—'}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                            PIN: {order.shipping_address?.pincode || '—'}
                          </p>
                        </td>

                        <td className="py-3.5 px-3 align-top max-w-[230px]">
                          <p className="text-[11px] text-slate-200 leading-snug">
                            {streetLines.join(', ') || 'Missing street address'}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {cityStatePin || 'Missing city / PIN'}
                          </p>
                          {!addrValidation.valid && (
                            <div className="mt-1.5 inline-flex items-start gap-1 rounded-lg text-[10px] text-rose-300 bg-rose-500/12 border border-rose-500/25 px-2 py-0.5">
                              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                              <span>{addrValidation.issues.join(', ')}</span>
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-3 align-top max-w-[210px]">
                          <p className="font-medium text-slate-100 tabular-nums">
                            {totalQty} {totalQty === 1 ? 'unit' : 'units'}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">
                            {items
                              .map(
                                (i) => `${i.product_name} (${i.selected_size}×${i.quantity})`
                              )
                              .join(', ') || 'No items'}
                          </p>
                        </td>

                        <td className="py-3.5 px-3 align-top whitespace-nowrap">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-md text-[10px] tracking-[0.1em] uppercase font-bold border ${
                              paymentInfo.mode === 'COD'
                                ? 'bg-orange-500/12 text-orange-300 border-orange-500/25'
                                : 'bg-emerald-500/12 text-emerald-300 border-emerald-500/25'
                            }`}
                          >
                            {paymentInfo.mode}
                          </span>
                          <p className="text-[10px] text-slate-500 mt-1 uppercase">
                            {order.payment_status.replace('_', ' ')}
                          </p>
                        </td>

                        <td className="py-3.5 px-3 align-top whitespace-nowrap">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-lg text-[10px] tracking-[0.1em] uppercase font-semibold border ${statusBadgeClass(
                              order.order_status
                            )}`}
                          >
                            {order.order_status}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 align-top text-right font-semibold text-white tabular-nums whitespace-nowrap">
                          {formatINR(order.total_inr)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Responsive Order Cards */}
            <div className="md:hidden divide-y divide-white/[0.06]">
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
                    className={`p-4 space-y-2.5 transition-colors ${
                      checked ? 'bg-amber-500/[0.08]' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <label className="inline-flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOrderSelection(order.id)}
                          className="accent-amber-500 w-4 h-4 mt-0.5"
                        />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-bold text-white tabular-nums">
                              {order.order_number}
                            </p>
                            {order.is_test_order && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] tracking-[0.12em] uppercase font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                TEST
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400">
                            {formatOrderTimestamp(order.created_at)}
                          </p>
                        </div>
                      </label>

                      <span
                        className={`px-2 py-0.5 rounded-lg text-[10px] tracking-[0.1em] uppercase font-semibold border ${statusBadgeClass(
                          order.order_status
                        )}`}
                      >
                        {order.order_status}
                      </span>
                    </div>

                    <div className="pl-6 space-y-1.5 text-xs">
                      <p className="font-medium text-slate-100">
                        {order.customer_name} &middot;{' '}
                        <span className="tabular-nums text-slate-400">
                          {order.customer_phone}
                        </span>
                      </p>

                      <p className="text-[11px] text-slate-400">
                        <MapPin className="w-3 h-3 inline mr-1 text-amber-400" />
                        {[...streetLines, cityStatePin].filter(Boolean).join(', ') ||
                          'Address incomplete'}
                      </p>

                      {!addrValidation.valid && (
                        <p className="text-[11px] rounded-lg text-rose-300 bg-rose-500/12 border border-rose-500/25 px-2.5 py-1">
                          Incomplete: {addrValidation.issues.join(', ')}
                        </p>
                      )}

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[11px] text-slate-400 tabular-nums">
                          {totalQty} {totalQty === 1 ? 'item' : 'items'} &middot;{' '}
                          <strong className="text-slate-200">{paymentInfo.mode}</strong> &middot;{' '}
                          <strong className="text-white">{formatINR(order.total_inr)}</strong>
                        </span>
                        <button
                          type="button"
                          onClick={() => onInspectOrder(order)}
                          className="text-[10px] tracking-[0.12em] uppercase font-semibold text-amber-400 hover:text-amber-300 cursor-pointer"
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
      <AnimatePresence>
        {validationModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setValidationModal(null)}
            role="dialog"
            aria-modal="true"
            aria-label="Address validation warning"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.22, ease: ADMIN_EASE }}
              className="w-full max-w-xl rounded-2xl bg-[#0e1520] border border-white/[0.1] p-6 shadow-2xl max-h-[88vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 pb-4 border-b border-white/[0.07]">
                <div>
                  <p className="text-[11px] tracking-[0.18em] uppercase text-rose-400 font-semibold">
                    Pre-Print Address Validation
                  </p>
                  <h3 className="text-xl font-semibold text-white mt-1">
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
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-xs text-slate-400 mt-3 leading-relaxed">
                The orders below are missing required recipient or delivery details (name, 10-digit phone, street address, city, state, or 6-digit PIN code). Review them before printing or exclude them from this batch.
              </p>

              <div className="mt-4 overflow-y-auto space-y-2.5 pr-1 flex-1">
                {validationModal.invalidEntries.map(({ order, issues }) => (
                  <div
                    key={order.id}
                    className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                  >
                    <div>
                      <p className="text-xs font-bold text-white tabular-nums">
                        {order.order_number} &middot;{' '}
                        <span className="font-medium text-slate-200">
                          {order.customer_name || 'Unnamed customer'}
                        </span>
                      </p>
                      <p className="text-[11px] text-rose-300 mt-1">
                        {issues.join(' · ')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setValidationModal(null);
                        onInspectOrder(order);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.12] hover:bg-white/[0.12] text-[10px] tracking-[0.12em] uppercase font-semibold text-white shrink-0 cursor-pointer"
                    >
                      <span>Open Order Details</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-5 pt-4 border-t border-white/[0.07] flex flex-col-reverse sm:flex-row justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setValidationModal(null)}
                  className="px-5 py-2.5 rounded-xl border border-white/[0.1] text-[11px] tracking-[0.12em] uppercase font-semibold text-slate-300 hover:text-white hover:bg-white/[0.05] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={validationModal.validOrders.length === 0}
                  onClick={handleConfirmExcludeAndExport}
                  className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] tracking-[0.12em] uppercase font-bold transition-colors cursor-pointer disabled:opacity-40"
                >
                  {validationModal.validOrders.length === 0
                    ? 'No Valid Orders Remaining'
                    : `Exclude ${validationModal.invalidEntries.length} & Download (${validationModal.validOrders.length} valid)`}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Manual Mark Shipped Confirmation Modal */}
      <AnimatePresence>
        {shipConfirmOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => !markingShipped && setShipConfirmOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Confirm marking selected orders as shipped"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.22, ease: ADMIN_EASE }}
              className="w-full max-w-lg rounded-2xl bg-[#0e1520] border border-white/[0.1] p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 pb-4 border-b border-white/[0.07]">
                <div>
                  <p className="text-[11px] tracking-[0.18em] uppercase text-amber-400 font-semibold">
                    Confirm Dispatch Status Update
                  </p>
                  <h3 className="text-xl font-semibold text-white mt-1">
                    Mark {shipBreakdown.eligible.length} of {selectedOrders.length}{' '}
                    Selected as Shipped?
                  </h3>
                </div>
                <button
                  type="button"
                  disabled={markingShipped}
                  onClick={() => setShipConfirmOpen(false)}
                  aria-label="Close modal"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-4 space-y-3 text-xs text-slate-300">
                <p className="leading-relaxed">
                  This will permanently update eligible orders (
                  <strong className="text-white">pending</strong>,{' '}
                  <strong className="text-white">confirmed</strong>, or{' '}
                  <strong className="text-white">packed</strong>) to{' '}
                  <strong className="text-teal-300">Shipped</strong> in Supabase.
                </p>

                <div className="p-4 rounded-xl bg-[#080d14] border border-white/[0.08] space-y-1.5 tabular-nums">
                  <p className="text-white font-semibold">
                    Selected Orders: {selectedOrders.length}
                  </p>
                  <p>
                    Eligible to mark Shipped:{' '}
                    <strong className="text-emerald-400">
                      {shipBreakdown.eligible.length}
                    </strong>
                  </p>
                  {shipBreakdown.alreadyShipped.length > 0 && (
                    <p>
                      Already Shipped (unchanged):{' '}
                      <strong className="text-slate-200">
                        {shipBreakdown.alreadyShipped.length}
                      </strong>
                    </p>
                  )}
                  {shipBreakdown.delivered.length > 0 && (
                    <p>
                      Delivered (protected):{' '}
                      <strong className="text-slate-200">
                        {shipBreakdown.delivered.length}
                      </strong>
                    </p>
                  )}
                  {shipBreakdown.cancelled.length > 0 && (
                    <p className="text-rose-300">
                      Cancelled (strictly protected — will NOT be marked shipped):{' '}
                      <strong>{shipBreakdown.cancelled.length}</strong>
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-white/[0.07] flex flex-col-reverse sm:flex-row justify-end gap-2.5">
                <button
                  type="button"
                  disabled={markingShipped}
                  onClick={() => setShipConfirmOpen(false)}
                  className="px-5 py-2.5 rounded-xl border border-white/[0.1] text-[11px] tracking-[0.12em] uppercase font-semibold text-slate-300 hover:text-white hover:bg-white/[0.05] cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={markingShipped || shipBreakdown.eligible.length === 0}
                  onClick={handleConfirmMarkShipped}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] tracking-[0.12em] uppercase font-bold transition-colors cursor-pointer disabled:opacity-40"
                >
                  <Truck className="w-3.5 h-3.5" />
                  <span>
                    {markingShipped
                      ? 'Updating Orders...'
                      : `Confirm Mark ${shipBreakdown.eligible.length} Shipped`}
                  </span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
