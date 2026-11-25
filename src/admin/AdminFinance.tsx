import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  CheckCircle2,
  Clock,
  Download,
  IndianRupee,
  Search,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { formatINR } from '../data/catalog';
import type { Order } from '../types';
import {
  ADMIN_EASE,
  AdminDashboardSkeleton,
  AnimatedCounter,
  orderStatusBadgeV2,
  paymentStatusBadgeV2,
} from './AdminMotion';

interface AdminFinanceProps {
  orders: Order[];
  loading: boolean;
  onInspectOrder: (order: Order) => void;
}

type FinanceRange = 'all' | '6m' | '90d' | '30d' | 'month';
type FinanceLedgerFilter = 'all' | 'paid' | 'cod_due' | 'awaiting' | 'cancelled';

function formatShortDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function getInitials(name: string): string {
  const parts = (name || 'AK').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return (name || 'AK').slice(0, 2).toUpperCase();
}

function csvEscape(val: unknown): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function AdminFinance({
  orders,
  loading,
  onInspectOrder,
}: AdminFinanceProps) {
  const [dateRange, setDateRange] = useState<FinanceRange>('6m');
  const [chartMode, setChartMode] = useState<'revenue' | 'orders'>('revenue');
  const [hoveredMonthKey, setHoveredMonthKey] = useState<string | null>(null);
  const [ledgerFilter, setLedgerFilter] = useState<FinanceLedgerFilter>('all');
  const [ledgerSearch, setLedgerSearch] = useState('');

  const liveOrders = useMemo(
    () => orders.filter((o) => !o.is_test_order),
    [orders]
  );

  const rangedOrders = useMemo(() => {
    if (dateRange === 'all') return liveOrders;
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    let cutoff = 0;

    if (dateRange === 'month') {
      cutoff = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    } else if (dateRange === '30d') {
      cutoff = now.getTime() - 30 * dayMs;
    } else if (dateRange === '90d') {
      cutoff = now.getTime() - 90 * dayMs;
    } else {
      cutoff = new Date(now.getFullYear(), now.getMonth() - 5, 1).getTime();
    }

    return liveOrders.filter((o) => {
      const ts = new Date(o.created_at).getTime();
      return !Number.isNaN(ts) && ts >= cutoff;
    });
  }, [liveOrders, dateRange]);

  const summary = useMemo(() => {
    const active = rangedOrders.filter((o) => o.order_status !== 'cancelled');
    const paid = active
      .filter((o) => o.payment_status === 'paid')
      .reduce((s, o) => s + Number(o.total_inr || 0), 0);
    const codDue = active
      .filter((o) => o.payment_status === 'cod_due')
      .reduce((s, o) => s + Number(o.total_inr || 0), 0);
    const awaiting = active
      .filter((o) => o.payment_status === 'awaiting_payment')
      .reduce((s, o) => s + Number(o.total_inr || 0), 0);
    const grossActive = active.reduce((s, o) => s + Number(o.total_inr || 0), 0);
    const discountsTotal = active.reduce(
      (s, o) => s + Number(o.discount_inr || 0),
      0
    );
    const aov = active.length > 0 ? Math.round(grossActive / active.length) : 0;
    const paidSharePct =
      grossActive > 0 ? Math.round((paid / grossActive) * 100) : 0;

    return {
      activeCount: active.length,
      cancelledCount: rangedOrders.length - active.length,
      paid,
      codDue,
      awaiting,
      uncollected: codDue + awaiting,
      grossActive,
      discountsTotal,
      aov,
      paidSharePct,
    };
  }, [rangedOrders]);

  // 8-month monthly revenue & order chart matching the reference screenshot
  const monthlySeries = useMemo(() => {
    const now = new Date();
    const months: {
      key: string;
      label: string;
      fullLabel: string;
      start: number;
      end: number;
      paid: number;
      codPending: number;
      total: number;
      orders: number;
    }[] = [];

    for (let i = 7; i >= 0; i--) {
      const startDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const endDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      months.push({
        key: `${startDate.getFullYear()}-${startDate.getMonth() + 1}`,
        label: new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(
          startDate
        ),
        fullLabel: new Intl.DateTimeFormat('en-IN', {
          month: 'long',
          year: 'numeric',
        }).format(startDate),
        start: startDate.getTime(),
        end: endDate.getTime(),
        paid: 0,
        codPending: 0,
        total: 0,
        orders: 0,
      });
    }

    for (const o of liveOrders) {
      if (o.order_status === 'cancelled') continue;
      const ts = new Date(o.created_at).getTime();
      if (Number.isNaN(ts)) continue;
      const bucket = months.find((m) => ts >= m.start && ts < m.end);
      if (!bucket) continue;

      const amt = Number(o.total_inr || 0);
      bucket.orders += 1;
      if (o.payment_status === 'paid') {
        bucket.paid += amt;
      } else {
        bucket.codPending += amt;
      }
      bucket.total = bucket.paid + bucket.codPending;
    }

    const maxVal = months.reduce(
      (max, m) => Math.max(max, chartMode === 'revenue' ? m.total : m.orders),
      0
    );

    return {
      months,
      maxVal: maxVal > 0 ? maxVal : 1,
      hasData: months.some((m) => m.orders > 0),
    };
  }, [liveOrders, chartMode]);

  const activeMonth = useMemo(
    () => monthlySeries.months.find((m) => m.key === hoveredMonthKey) ?? null,
    [monthlySeries.months, hoveredMonthKey]
  );

  // Payment split donut segments
  const donut = useMemo(() => {
    const total = summary.paid + summary.codDue + summary.awaiting;
    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    const parts = [
      { id: 'paid', label: 'Verified Paid', value: summary.paid, color: '#0891b2' },
      { id: 'cod', label: 'COD Receivable', value: summary.codDue, color: '#67e8f9' },
      {
        id: 'awaiting',
        label: 'Awaiting Online',
        value: summary.awaiting,
        color: '#cbd5e1',
      },
    ];

    let cumulative = 0;
    return {
      total,
      radius,
      circumference,
      segments: parts.map((p) => {
        const dash = total > 0 ? (p.value / total) * circumference : 0;
        const offset = -cumulative;
        cumulative += dash;
        return { ...p, dash, offset };
      }),
    };
  }, [summary]);

  const filteredLedger = useMemo(() => {
    const q = ledgerSearch.trim().toLowerCase();
    return rangedOrders.filter((o) => {
      const matchTab =
        ledgerFilter === 'all' ||
        (ledgerFilter === 'paid' &&
          o.payment_status === 'paid' &&
          o.order_status !== 'cancelled') ||
        (ledgerFilter === 'cod_due' &&
          o.payment_status === 'cod_due' &&
          o.order_status !== 'cancelled') ||
        (ledgerFilter === 'awaiting' &&
          o.payment_status === 'awaiting_payment' &&
          o.order_status !== 'cancelled') ||
        (ledgerFilter === 'cancelled' && o.order_status === 'cancelled');

      const matchQuery =
        !q ||
        o.order_number.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        o.customer_phone.toLowerCase().includes(q) ||
        o.shipping_address.city.toLowerCase().includes(q);

      return matchTab && matchQuery;
    });
  }, [rangedOrders, ledgerFilter, ledgerSearch]);

  const handleExportCsv = () => {
    const headers = [
      'Order Number',
      'Date',
      'Customer',
      'Phone',
      'City',
      'Payment Method',
      'Payment Status',
      'Order Status',
      'Subtotal INR',
      'Discount INR',
      'Shipping INR',
      'Total INR',
    ];

    const rows = filteredLedger.map((o) => [
      o.order_number,
      new Date(o.created_at).toISOString(),
      o.customer_name,
      o.customer_phone,
      o.shipping_address.city,
      o.payment_method,
      o.payment_status,
      o.order_status,
      o.subtotal_inr,
      o.discount_inr ?? 0,
      o.shipping_inr,
      o.total_inr,
    ]);

    const csv = [headers, ...rows]
      .map((r) => r.map(csvEscape).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `apna-kapda-finance-${dateRange}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading && orders.length === 0) {
    return <AdminDashboardSkeleton />;
  }

  const kpiCards = [
    {
      id: 'paid',
      label: 'Verified Paid Revenue',
      value: summary.paid,
      subtext: `${summary.paidSharePct}% of gross active volume`,
      icon: IndianRupee,
    },
    {
      id: 'gross',
      label: 'Gross Active Orders',
      value: summary.grossActive,
      subtext: `${summary.activeCount} active · ${summary.cancelledCount} cancelled`,
      icon: TrendingUp,
    },
    {
      id: 'cod',
      label: 'COD Receivable',
      value: summary.codDue,
      subtext: `Online awaiting ${formatINR(summary.awaiting)}`,
      icon: Clock,
    },
    {
      id: 'aov',
      label: 'Average Order Value',
      value: summary.aov,
      subtext:
        summary.discountsTotal > 0
          ? `Discounts granted ${formatINR(summary.discountsTotal)}`
          : 'Across live non-cancelled orders',
      icon: Wallet,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header Row matching reference screenshot */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-sans text-2xl sm:text-[28px] font-semibold text-[#0f2430] tracking-tight">
            Finance
          </h2>
          <p className="text-xs sm:text-sm text-[#546e7a] mt-0.5">
            Live revenue ledger, payment splits, and monthly volume from Supabase.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center p-1 rounded-full bg-white/80 border border-slate-200/80 shadow-xs">
            {(
              [
                { id: 'month', label: 'Month' },
                { id: '30d', label: '30D' },
                { id: '90d', label: '90D' },
                { id: '6m', label: '6M' },
                { id: 'all', label: 'All' },
              ] as const
            ).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setDateRange(r.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  dateRange === r.id
                    ? 'bg-[#0f2430] text-white shadow-xs'
                    : 'text-[#546e7a] hover:text-[#0f2430]'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filteredLedger.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white hover:bg-slate-50 border border-slate-200/90 text-xs font-semibold text-[#0f2430] shadow-xs transition-colors cursor-pointer disabled:opacity-45 whitespace-nowrap min-h-[38px]"
          >
            <Download className="w-3.5 h-3.5 text-[#0e7490]" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* 4 Rounded Frosted KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpiCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.34, delay: idx * 0.05, ease: ADMIN_EASE }}
              whileHover={{ y: -3 }}
              className="rounded-[22px] bg-white/88 backdrop-blur-sm border border-white p-5 shadow-[0_8px_28px_-14px_rgba(15,36,48,0.12)] flex flex-col justify-between min-h-[142px]"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="w-8 h-8 rounded-full bg-[#e6f3f6] border border-[#cde6ec] flex items-center justify-center text-[#0e7490]">
                  <Icon className="w-4 h-4" />
                </div>
                <CheckCircle2 className="w-4 h-4 text-slate-300" />
              </div>

              <div className="mt-4">
                <p className="text-2xl sm:text-[28px] font-bold text-[#0f2430] tracking-tight leading-none">
                  <AnimatedCounter value={card.value} format="inr" />
                </p>
                <p className="text-xs font-medium text-[#3c5663] mt-2">
                  {card.label}
                </p>
                <p className="text-[11px] text-[#6d8490] mt-0.5 tabular-nums">
                  {card.subtext}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Middle Charts Row: 8-col Monthly Revenue Bar Chart + 4-col Payment Split Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, delay: 0.14, ease: ADMIN_EASE }}
          className="lg:col-span-8 rounded-[24px] bg-white/88 backdrop-blur-sm border border-white p-5 sm:p-6 shadow-[0_8px_28px_-14px_rgba(15,36,48,0.12)] flex flex-col"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-[#0f2430]">
                {chartMode === 'revenue' ? 'Revenue by month' : 'Orders by month'}
              </h3>
              <p className="text-xs text-[#647d89] mt-0.5 tabular-nums">
                {activeMonth ? (
                  <>
                    <span className="font-semibold text-[#0f2430]">
                      {activeMonth.fullLabel}:
                    </span>{' '}
                    Paid {formatINR(activeMonth.paid)} · COD/Pending{' '}
                    {formatINR(activeMonth.codPending)} · {activeMonth.orders}{' '}
                    {activeMonth.orders === 1 ? 'order' : 'orders'}
                  </>
                ) : (
                  'Last 8 months · Hover or tap any bar to inspect breakdown'
                )}
              </p>
            </div>

            <div className="inline-flex items-center p-1 rounded-full bg-[#edf4f6] border border-slate-200/70">
              {(
                [
                  { id: 'revenue', label: 'Revenue' },
                  { id: 'orders', label: 'Orders' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setChartMode(m.id)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                    chartMode === m.id
                      ? 'bg-white text-[#0f2430] shadow-xs'
                      : 'text-[#5b7480] hover:text-[#0f2430]'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {!monthlySeries.hasData ? (
            <div className="flex-1 min-h-[230px] flex flex-col items-center justify-center text-center py-8">
              <p className="text-sm font-semibold text-[#0f2430]">
                No live monthly order revenue yet
              </p>
              <p className="text-xs text-[#647d89] mt-1">
                Verified customer orders will plot here automatically.
              </p>
            </div>
          ) : (
            <div className="mt-5 flex-1 flex flex-col justify-end">
              <div className="relative h-52 flex items-end gap-2.5 sm:gap-4 pt-6 pb-2 border-b border-slate-100">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-6 bottom-2 flex flex-col justify-between"
                >
                  <div className="border-t border-dashed border-slate-200/70" />
                  <div className="border-t border-dashed border-slate-200/70" />
                  <div className="border-t border-dashed border-slate-200/70" />
                  <div />
                </div>

                {monthlySeries.months.map((m, idx) => {
                  const metricVal = chartMode === 'revenue' ? m.total : m.orders;
                  const heightPct =
                    metricVal > 0
                      ? Math.max(10, Math.round((metricVal / monthlySeries.maxVal) * 100))
                      : 0;
                  const paidPct =
                    m.total > 0 ? Math.round((m.paid / m.total) * 100) : 0;
                  const isActive = hoveredMonthKey === m.key;

                  return (
                    <button
                      key={`${chartMode}-${m.key}`}
                      type="button"
                      onMouseEnter={() => setHoveredMonthKey(m.key)}
                      onMouseLeave={() => setHoveredMonthKey(null)}
                      onClick={() =>
                        setHoveredMonthKey((prev) => (prev === m.key ? null : m.key))
                      }
                      className="relative z-10 flex-1 h-full flex flex-col items-center justify-end group cursor-pointer focus:outline-none"
                    >
                      <span
                        className={`text-[10px] tabular-nums mb-1.5 transition-opacity whitespace-nowrap ${
                          isActive
                            ? 'opacity-100 text-[#0f2430] font-semibold'
                            : 'opacity-0 group-hover:opacity-100 text-[#4d6774]'
                        }`}
                      >
                        {metricVal > 0
                          ? chartMode === 'revenue'
                            ? formatINR(metricVal)
                            : `${metricVal}`
                          : ''}
                      </span>

                      <div
                        className={`w-full max-w-[44px] h-full rounded-t-xl bg-[#eef5f7] flex items-end overflow-hidden transition-all ${
                          isActive ? 'ring-2 ring-[#0891b2]/45' : ''
                        }`}
                      >
                        {heightPct > 0 && (
                          <motion.div
                            initial={{ scaleY: 0, opacity: 0.45 }}
                            animate={{ scaleY: 1, opacity: 1 }}
                            transition={{
                              duration: 0.45,
                              delay: idx * 0.04,
                              ease: ADMIN_EASE,
                            }}
                            style={{
                              height: `${heightPct}%`,
                              transformOrigin: 'bottom',
                            }}
                            className="w-full flex flex-col justify-end rounded-t-xl overflow-hidden"
                          >
                            {chartMode === 'revenue' ? (
                              <>
                                {m.codPending > 0 && (
                                  <div
                                    style={{ height: `${100 - paidPct}%` }}
                                    className="w-full bg-gradient-to-t from-[#67e8f9] to-[#a5f3fc] min-h-[3px]"
                                  />
                                )}
                                {m.paid > 0 && (
                                  <div
                                    style={{ height: `${paidPct}%` }}
                                    className="w-full bg-gradient-to-t from-[#0e7490] to-[#22d3ee] min-h-[3px]"
                                  />
                                )}
                              </>
                            ) : (
                              <div className="w-full h-full bg-gradient-to-t from-[#0e7490] via-[#06b6d4] to-[#67e8f9]" />
                            )}
                          </motion.div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2.5 sm:gap-4 pt-2.5">
                {monthlySeries.months.map((m) => (
                  <p
                    key={m.key}
                    className={`flex-1 text-center text-[11px] font-medium ${
                      hoveredMonthKey === m.key
                        ? 'text-[#0e7490] font-semibold'
                        : 'text-[#647d89]'
                    }`}
                  >
                    {m.label}
                  </p>
                ))}
              </div>
            </div>
          )}
        </motion.section>

        {/* Right 4-col Donut Breakdown (mirrors "Who keeps what" from reference) */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, delay: 0.2, ease: ADMIN_EASE }}
          className="lg:col-span-4 rounded-[24px] bg-white/88 backdrop-blur-sm border border-white p-5 sm:p-6 shadow-[0_8px_28px_-14px_rgba(15,36,48,0.12)] flex flex-col justify-between"
        >
          <div className="pb-4 border-b border-slate-100">
            <h3 className="text-base sm:text-lg font-semibold text-[#0f2430]">
              Payment Collection Split
            </h3>
            <p className="text-xs text-[#647d89] mt-0.5">
              Verified paid vs COD &amp; awaiting online payment
            </p>
          </div>

          <div className="my-5 flex items-center justify-center">
            <div className="relative w-40 h-40">
              <svg
                viewBox="0 0 132 132"
                className="w-full h-full -rotate-90"
                role="img"
                aria-label="Payment collection split donut chart"
              >
                <circle
                  cx="66"
                  cy="66"
                  r={donut.radius}
                  fill="none"
                  stroke="#e6eff2"
                  strokeWidth="14"
                />
                {donut.segments.map((seg) =>
                  seg.value > 0 ? (
                    <motion.circle
                      key={seg.id}
                      cx="66"
                      cy="66"
                      r={donut.radius}
                      fill="none"
                      stroke={seg.color}
                      strokeWidth="14"
                      strokeLinecap="butt"
                      strokeDasharray={`${Math.max(0, seg.dash - 2)} ${
                        donut.circumference
                      }`}
                      initial={{ strokeDashoffset: donut.circumference }}
                      animate={{ strokeDashoffset: seg.offset }}
                      transition={{ duration: 0.72, ease: ADMIN_EASE }}
                    />
                  ) : null
                )}
              </svg>

              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-2xl font-bold text-[#0f2430] tabular-nums">
                  <AnimatedCounter value={summary.paidSharePct} format="percent" />
                </span>
                <span className="text-[11px] text-[#647d89]">Paid online</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 pt-3 border-t border-slate-100">
            <div className="rounded-2xl bg-[#f2f7f9] border border-slate-200/60 p-3">
              <p className="text-sm font-bold text-[#0f2430] tabular-nums">
                {formatINR(summary.paid)}
              </p>
              <p className="text-[11px] text-[#647d89] mt-0.5">Collected Paid</p>
            </div>
            <div className="rounded-2xl bg-[#f2f7f9] border border-slate-200/60 p-3">
              <p className="text-sm font-bold text-[#0e7490] tabular-nums">
                {formatINR(summary.uncollected)}
              </p>
              <p className="text-[11px] text-[#647d89] mt-0.5">COD &amp; Pending</p>
            </div>
          </div>
        </motion.section>
      </div>

      {/* Bottom Financial Ledger Table (mirrors "Agent payouts" from reference) */}
      <section className="rounded-[24px] bg-white/88 backdrop-blur-sm border border-white shadow-[0_8px_28px_-14px_rgba(15,36,48,0.12)] overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h3 className="text-base sm:text-lg font-semibold text-[#0f2430]">
              Order Payment Ledger
            </h3>
            <p className="text-xs text-[#647d89] mt-0.5">
              Click any order row to open full fulfillment and payment controls.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#6d8490] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={ledgerSearch}
                onChange={(e) => setLedgerSearch(e.target.value)}
                placeholder="Search order or customer..."
                className="pl-8 pr-3 py-2 rounded-full text-xs bg-[#f2f7f9] border border-slate-200/80 focus:border-[#0e7490] outline-none text-[#0f2430] placeholder:text-[#7c94a0] w-52"
              />
            </div>

            <div className="inline-flex flex-wrap items-center gap-1 p-1 rounded-full bg-[#eef5f7] border border-slate-200/70">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'paid', label: 'Paid' },
                  { id: 'cod_due', label: 'COD Due' },
                  { id: 'awaiting', label: 'Awaiting' },
                  { id: 'cancelled', label: 'Cancelled' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setLedgerFilter(tab.id)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    ledgerFilter === tab.id
                      ? 'bg-[#0f2430] text-white'
                      : 'text-[#546e7a] hover:text-[#0f2430]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filteredLedger.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-semibold text-[#0f2430]">
              No matching financial records
            </p>
            <p className="text-xs text-[#647d89] mt-1">
              Try clearing your filter or expanding the date range.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#f4f8fa] text-[#5c7683] border-b border-slate-100 text-[11px] font-medium">
                <tr>
                  <th className="py-3 px-5">Customer</th>
                  <th className="py-3 px-4">Order</th>
                  <th className="py-3 px-4">Payment</th>
                  <th className="py-3 px-4">Fulfillment</th>
                  <th className="py-3 px-5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLedger.slice(0, 25).map((order) => (
                  <tr
                    key={order.id}
                    onClick={() => onInspectOrder(order)}
                    className="hover:bg-[#f2f8fa] transition-colors cursor-pointer"
                  >
                    <td className="py-3.5 px-5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-[#dff0f4] text-[#0e7490] font-semibold text-[11px] flex items-center justify-center shrink-0">
                          {getInitials(order.customer_name)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-[#0f2430] truncate max-w-[180px]">
                            {order.customer_name}
                          </p>
                          <p className="text-[11px] text-[#6d8490] truncate">
                            {order.shipping_address.city} &middot;{' '}
                            {formatShortDate(order.created_at)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px] font-semibold text-[#0f2430] whitespace-nowrap">
                      {order.order_number}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border capitalize whitespace-nowrap ${paymentStatusBadgeV2(
                          order.payment_status
                        )}`}
                      >
                        {order.payment_status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border capitalize whitespace-nowrap ${orderStatusBadgeV2(
                          order.order_status
                        )}`}
                      >
                        {order.order_status}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 text-right font-bold text-[#0f2430] tabular-nums whitespace-nowrap">
                      {formatINR(order.total_inr)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
