import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  IndianRupee,
  Package,
  Search,
  ShoppingBag,
  Tag,
  TrendingDown,
  TrendingUp,
  Truck,
} from 'lucide-react';
import { formatINR } from '../data/catalog';
import type { Order, OrderStatus, Product, UserProfile } from '../types';
import {
  ADMIN_EASE,
  AdminDashboardSkeleton,
  AnimatedCounter,
  orderStatusBadgeV2,
  paymentStatusBadgeV2,
} from './AdminMotion';
import type { AdminTab } from './AdminPortal';
import { computeShippingStats } from './shipping/shippingUtils';

interface AdminAnalyticsProps {
  orders: Order[];
  products: Product[];
  customers?: UserProfile[];
  loading: boolean;
  onNavigateTab: (tab: AdminTab) => void;
  onInspectOrder: (order: Order) => void;
}

type ChartMetric = 'revenue' | 'orders';
type ChartRange = '7d' | '30d' | '90d' | '6m';

interface ChartBucket {
  key: string;
  label: string;
  rangeLabel: string;
  paidRevenue: number;
  codAndPending: number;
  totalValue: number;
  orderCount: number;
}

interface TopProductRow {
  key: string;
  name: string;
  image: string | null;
  units: number;
  revenue: number;
}

const RECENT_ORDER_FILTERS: { id: 'all' | OrderStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'packed', label: 'Packed' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'cancelled', label: 'Cancelled' },
];

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

function formatCompactTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDayShort(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
  }).format(d);
}

function computePercentTrend(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function AdminAnalytics({
  orders,
  products,
  customers = [],
  loading,
  onNavigateTab,
  onInspectOrder,
}: AdminAnalyticsProps) {
  const [chartMetric, setChartMetric] = useState<ChartMetric>('revenue');
  const [chartRange, setChartRange] = useState<ChartRange>('30d');
  const [hoveredBucketKey, setHoveredBucketKey] = useState<string | null>(null);

  const [recentSearch, setRecentSearch] = useState('');
  const [recentStatusFilter, setRecentStatusFilter] = useState<'all' | OrderStatus>('all');

  const { liveOrders, testOrdersCount } = useMemo(() => {
    const live = orders.filter((o) => !o.is_test_order);
    return {
      liveOrders: live,
      testOrdersCount: orders.length - live.length,
    };
  }, [orders]);

  const metrics = useMemo(() => {
    const now = new Date();
    const todayStart = startOfLocalDay(now).getTime();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();

    const dayMs = 24 * 60 * 60 * 1000;
    const last30Start = todayStart - 29 * dayMs;
    const prev30Start = last30Start - 30 * dayMs;

    const activeOrders = liveOrders.filter((o) => o.order_status !== 'cancelled');

    const verifiedPaidRevenue = activeOrders
      .filter((o) => o.payment_status === 'paid')
      .reduce((sum, o) => sum + Number(o.total_inr || 0), 0);

    const codAmountDue = activeOrders
      .filter((o) => o.payment_method === 'cod' && o.payment_status === 'cod_due')
      .reduce((sum, o) => sum + Number(o.total_inr || 0), 0);

    const awaitingOnlineAmount = activeOrders
      .filter((o) => o.payment_status === 'awaiting_payment')
      .reduce((sum, o) => sum + Number(o.total_inr || 0), 0);

    let todaySalesAmount = 0;
    let todayOrdersCount = 0;
    let monthlyPaidRevenue = 0;
    let monthlyActiveOrderValue = 0;
    let prevMonthPaidRevenue = 0;
    let last30Orders = 0;
    let prev30Orders = 0;

    for (const o of liveOrders) {
      const ts = new Date(o.created_at).getTime();
      if (Number.isNaN(ts)) continue;
      const amt = Number(o.total_inr || 0);
      const isCancelled = o.order_status === 'cancelled';

      if (ts >= last30Start) last30Orders += 1;
      else if (ts >= prev30Start && ts < last30Start) prev30Orders += 1;

      if (!isCancelled) {
        if (ts >= todayStart) {
          todayOrdersCount += 1;
          todaySalesAmount += amt;
        }
        if (ts >= thisMonthStart) {
          monthlyActiveOrderValue += amt;
          if (o.payment_status === 'paid') {
            monthlyPaidRevenue += amt;
          }
        } else if (ts >= prevMonthStart && ts < thisMonthStart) {
          if (o.payment_status === 'paid') {
            prevMonthPaidRevenue += amt;
          }
        }
      }
    }

    const pendingOrdersCount = liveOrders.filter(
      (o) => o.order_status === 'pending'
    ).length;
    const inFulfillmentCount = liveOrders.filter(
      (o) =>
        o.order_status === 'confirmed' ||
        o.order_status === 'packed' ||
        o.order_status === 'shipped'
    ).length;
    const deliveredOrdersCount = liveOrders.filter(
      (o) => o.order_status === 'delivered'
    ).length;
    const cancelledOrdersCount = liveOrders.filter(
      (o) => o.order_status === 'cancelled'
    ).length;

    const readyToShipLive = computeShippingStats(liveOrders).readyToShipOrders;
    const lowStockProducts = [...products]
      .filter((p) => p.stock_count <= 5)
      .sort((a, b) => a.stock_count - b.stock_count);
    const activeProductsCount = products.filter((p) => p.is_active).length;

    const completionRate =
      liveOrders.length > 0
        ? Math.round((deliveredOrdersCount / liveOrders.length) * 100)
        : 0;

    return {
      totalOrders: liveOrders.length,
      verifiedPaidRevenue,
      codAmountDue,
      awaitingOnlineAmount,
      todaySalesAmount,
      todayOrdersCount,
      monthlyPaidRevenue,
      monthlyActiveOrderValue,
      revenueTrendPct: computePercentTrend(monthlyPaidRevenue, prevMonthPaidRevenue),
      ordersTrendPct: computePercentTrend(last30Orders, prev30Orders),
      pendingOrdersCount,
      inFulfillmentCount,
      deliveredOrdersCount,
      cancelledOrdersCount,
      completionRate,
      readyToShipLive,
      totalProducts: products.length,
      activeProductsCount,
      lowStockProducts,
      totalCustomers: customers.length,
    };
  }, [liveOrders, products, customers]);

  const chartSeries = useMemo<ChartBucket[]>(() => {
    const now = new Date();
    const today = startOfLocalDay(now);
    const dayMs = 24 * 60 * 60 * 1000;
    const buckets: { start: number; end: number; bucket: ChartBucket }[] = [];

    if (chartRange === '7d') {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today.getTime() - i * dayMs);
        const start = d.getTime();
        const end = start + dayMs;
        const label = new Intl.DateTimeFormat('en-IN', { weekday: 'short' }).format(d);
        buckets.push({
          start,
          end,
          bucket: {
            key: `d-${start}`,
            label,
            rangeLabel: formatDayShort(d),
            paidRevenue: 0,
            codAndPending: 0,
            totalValue: 0,
            orderCount: 0,
          },
        });
      }
    } else if (chartRange === '30d') {
      // 10 crisp 3-day buckets covering the last 30 days
      for (let i = 9; i >= 0; i--) {
        const endDate = new Date(today.getTime() - i * 3 * dayMs + dayMs);
        const startDate = new Date(endDate.getTime() - 3 * dayMs);
        const displayEnd = new Date(endDate.getTime() - dayMs);
        buckets.push({
          start: startDate.getTime(),
          end: endDate.getTime(),
          bucket: {
            key: `3d-${startDate.getTime()}`,
            label: formatDayShort(displayEnd),
            rangeLabel: `${formatDayShort(startDate)} – ${formatDayShort(displayEnd)}`,
            paidRevenue: 0,
            codAndPending: 0,
            totalValue: 0,
            orderCount: 0,
          },
        });
      }
    } else if (chartRange === '90d') {
      // 12 weekly buckets (~84-90 days)
      for (let i = 11; i >= 0; i--) {
        const endDate = new Date(today.getTime() - i * 7 * dayMs + dayMs);
        const startDate = new Date(endDate.getTime() - 7 * dayMs);
        const displayEnd = new Date(endDate.getTime() - dayMs);
        buckets.push({
          start: startDate.getTime(),
          end: endDate.getTime(),
          bucket: {
            key: `w-${startDate.getTime()}`,
            label: formatDayShort(startDate),
            rangeLabel: `${formatDayShort(startDate)} – ${formatDayShort(displayEnd)}`,
            paidRevenue: 0,
            codAndPending: 0,
            totalValue: 0,
            orderCount: 0,
          },
        });
      }
    } else {
      for (let i = 5; i >= 0; i--) {
        const startDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const endDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        const label = new Intl.DateTimeFormat('en-IN', {
          month: 'short',
          year: '2-digit',
        }).format(startDate);
        buckets.push({
          start: startDate.getTime(),
          end: endDate.getTime(),
          bucket: {
            key: `m-${startDate.getFullYear()}-${startDate.getMonth() + 1}`,
            label,
            rangeLabel: new Intl.DateTimeFormat('en-IN', {
              month: 'long',
              year: 'numeric',
            }).format(startDate),
            paidRevenue: 0,
            codAndPending: 0,
            totalValue: 0,
            orderCount: 0,
          },
        });
      }
    }

    for (const order of liveOrders) {
      if (order.order_status === 'cancelled') continue;
      const ts = new Date(order.created_at).getTime();
      if (Number.isNaN(ts)) continue;

      const match = buckets.find((b) => ts >= b.start && ts < b.end);
      if (!match) continue;

      const amt = Number(order.total_inr || 0);
      match.bucket.orderCount += 1;
      if (order.payment_status === 'paid') {
        match.bucket.paidRevenue += amt;
      } else if (
        order.payment_status === 'cod_due' ||
        order.payment_status === 'awaiting_payment'
      ) {
        match.bucket.codAndPending += amt;
      }
      match.bucket.totalValue =
        match.bucket.paidRevenue + match.bucket.codAndPending;
    }

    return buckets.map((b) => b.bucket);
  }, [liveOrders, chartRange]);

  const chartSummary = useMemo(() => {
    const totalPaid = chartSeries.reduce((s, b) => s + b.paidRevenue, 0);
    const totalPending = chartSeries.reduce((s, b) => s + b.codAndPending, 0);
    const totalOrders = chartSeries.reduce((s, b) => s + b.orderCount, 0);
    const maxVal = chartSeries.reduce(
      (max, b) =>
        Math.max(
          max,
          chartMetric === 'revenue' ? b.totalValue : b.orderCount
        ),
      0
    );
    return {
      totalPaid,
      totalPending,
      totalOrders,
      hasData: totalOrders > 0,
      maxVal: maxVal > 0 ? maxVal : 1,
    };
  }, [chartSeries, chartMetric]);

  const activeBucket = useMemo(() => {
    if (!hoveredBucketKey) return null;
    return chartSeries.find((b) => b.key === hoveredBucketKey) ?? null;
  }, [chartSeries, hoveredBucketKey]);

  // Donut Ring segments (real live order statuses)
  const statusBreakdown = useMemo(() => {
    const total = metrics.totalOrders;
    const segments = [
      {
        id: 'delivered',
        label: 'Delivered',
        count: metrics.deliveredOrdersCount,
        color: '#34d399',
        textClass: 'text-emerald-300',
      },
      {
        id: 'fulfillment',
        label: 'In Fulfillment',
        count: metrics.inFulfillmentCount,
        color: '#2dd4bf',
        textClass: 'text-teal-300',
      },
      {
        id: 'pending',
        label: 'Pending',
        count: metrics.pendingOrdersCount,
        color: '#f59e0b',
        textClass: 'text-amber-300',
      },
      {
        id: 'cancelled',
        label: 'Cancelled',
        count: metrics.cancelledOrdersCount,
        color: '#f87171',
        textClass: 'text-rose-300',
      },
    ];

    const radius = 56;
    const circumference = 2 * Math.PI * radius;
    let cumulative = 0;

    return {
      total,
      radius,
      circumference,
      segments: segments.map((seg) => {
        const pct = total > 0 ? (seg.count / total) * 100 : 0;
        const dash = total > 0 ? (seg.count / total) * circumference : 0;
        const offset = -cumulative;
        cumulative += dash;
        return {
          ...seg,
          pct: Math.round(pct),
          dash,
          offset,
        };
      }),
    };
  }, [metrics]);

  // Top Selling Products (derived strictly from real non-cancelled live order_items)
  const topSellingProducts = useMemo<TopProductRow[]>(() => {
    const productMap = new Map<string, TopProductRow>();
    const catalogById = new Map(products.map((p) => [p.id, p]));

    for (const order of liveOrders) {
      if (order.order_status === 'cancelled') continue;
      for (const item of order.order_items ?? []) {
        const key = item.product_uuid || item.product_id || item.product_name;
        const existing = productMap.get(key);
        const lineRevenue = Number(item.unit_price_inr || 0) * Number(item.quantity || 0);
        const catalogMatch =
          (item.product_uuid ? catalogById.get(item.product_uuid) : undefined) ||
          catalogById.get(item.product_id);

        if (existing) {
          existing.units += Number(item.quantity || 0);
          existing.revenue += lineRevenue;
          if (!existing.image && (item.product_image || catalogMatch?.image_url)) {
            existing.image = item.product_image || catalogMatch?.image_url || null;
          }
        } else {
          productMap.set(key, {
            key,
            name: item.product_name,
            image: item.product_image || catalogMatch?.image_url || null,
            units: Number(item.quantity || 0),
            revenue: lineRevenue,
          });
        }
      }
    }

    return Array.from(productMap.values())
      .sort((a, b) => b.units - a.units || b.revenue - a.revenue)
      .slice(0, 5);
  }, [liveOrders, products]);

  // Recent Orders filtered
  const filteredRecentOrders = useMemo(() => {
    const q = recentSearch.trim().toLowerCase();
    return liveOrders
      .filter((o) => {
        const matchStatus =
          recentStatusFilter === 'all' || o.order_status === recentStatusFilter;
        const matchQuery =
          !q ||
          o.order_number.toLowerCase().includes(q) ||
          o.customer_name.toLowerCase().includes(q) ||
          o.customer_email.toLowerCase().includes(q) ||
          o.customer_phone.toLowerCase().includes(q);
        return matchStatus && matchQuery;
      })
      .slice(0, 8);
  }, [liveOrders, recentSearch, recentStatusFilter]);

  // Recent Activity derived from actual live order events
  const recentActivity = useMemo(() => {
    return liveOrders.slice(0, 5).map((o) => {
      if (o.order_status === 'cancelled') {
        return {
          id: `${o.id}-cancel`,
          title: `${o.order_number} cancelled`,
          detail: `${o.customer_name} · By ${o.cancelled_by || 'system'}`,
          time: o.cancelled_at || o.created_at,
          tone: 'text-rose-300',
          order: o,
        };
      }
      if (o.order_status === 'delivered') {
        return {
          id: `${o.id}-delivered`,
          title: `${o.order_number} delivered`,
          detail: `${o.customer_name} · ${formatINR(o.total_inr)}`,
          time: o.created_at,
          tone: 'text-emerald-300',
          order: o,
        };
      }
      return {
        id: `${o.id}-placed`,
        title: `New order ${o.order_number}`,
        detail: `${o.customer_name} · ${formatINR(o.total_inr)} (${
          o.payment_method === 'cod' ? 'COD' : 'Online'
        })`,
        time: o.created_at,
        tone: 'text-amber-300',
        order: o,
      };
    });
  }, [liveOrders]);

  if (loading && orders.length === 0 && products.length === 0) {
    return <AdminDashboardSkeleton />;
  }

  const kpiCards = [
    {
      id: 'revenue',
      label: 'Total Revenue',
      value: metrics.verifiedPaidRevenue,
      format: 'inr' as const,
      icon: IndianRupee,
      accent: 'from-teal-500/20 to-teal-500/5 border-teal-400/25 text-teal-300',
      trend: metrics.revenueTrendPct,
      trendContext: 'vs last month',
      subtext: `COD due ${formatINR(metrics.codAmountDue)} · Online pending ${formatINR(
        metrics.awaitingOnlineAmount
      )}`,
    },
    {
      id: 'orders',
      label: 'Total Orders',
      value: metrics.totalOrders,
      format: 'integer' as const,
      icon: ShoppingBag,
      accent: 'from-amber-500/20 to-amber-500/5 border-amber-400/25 text-amber-300',
      trend: metrics.ordersTrendPct,
      trendContext: 'vs prior 30d',
      subtext: `Today ${metrics.todayOrdersCount} (${formatINR(
        metrics.todaySalesAmount
      )}) · Month paid ${formatINR(metrics.monthlyPaidRevenue)}`,
    },
    {
      id: 'pending',
      label: 'Pending Orders',
      value: metrics.pendingOrdersCount,
      format: 'integer' as const,
      icon: Clock,
      accent: 'from-orange-500/20 to-orange-500/5 border-orange-400/25 text-orange-300',
      trend: null as number | null,
      trendContext: '',
      subtext: `In fulfillment ${metrics.inFulfillmentCount} · Ready to ship ${metrics.readyToShipLive}`,
    },
    {
      id: 'completed',
      label: 'Completed Orders',
      value: metrics.deliveredOrdersCount,
      format: 'integer' as const,
      icon: CheckCircle2,
      accent: 'from-emerald-500/20 to-emerald-500/5 border-emerald-400/25 text-emerald-300',
      trend: null as number | null,
      trendContext: '',
      subtext:
        metrics.totalOrders > 0
          ? `${metrics.completionRate}% delivered · Cancelled ${metrics.cancelledOrdersCount}`
          : `Cancelled ${metrics.cancelledOrdersCount} · No completed orders yet`,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="font-sans text-2xl sm:text-[28px] font-semibold text-white tracking-tight">
            Store Overview
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Live revenue, fulfillment queue, and inventory health from Supabase.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigateTab('bulk-shipping')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-xs font-medium text-slate-100 transition-colors cursor-pointer whitespace-nowrap min-h-[40px]"
          >
            <Truck className="w-4 h-4 text-teal-400" />
            <span>Shipping Center</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigateTab('products')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap min-h-[40px]"
          >
            <Package className="w-4 h-4" />
            <span>Manage Products</span>
          </button>
        </div>
      </div>

      {/* QA Test Isolation Banner */}
      {testOrdersCount > 0 && (
        <div className="rounded-xl bg-amber-500/[0.08] border border-amber-400/20 px-4 py-3 text-xs text-amber-200/90 flex flex-wrap items-center justify-between gap-2">
          <span>
            <strong className="text-amber-200 tabular-nums">{testOrdersCount}</strong>{' '}
            Shipping QA test {testOrdersCount === 1 ? 'order is' : 'orders are'}{' '}
            excluded from revenue, charts, and customer metrics.
          </span>
          <button
            type="button"
            onClick={() => onNavigateTab('bulk-shipping')}
            className="text-amber-300 hover:text-amber-200 font-medium inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <span>Open Shipping Center</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Row 1: 4 Animated KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpiCards.map((card, index) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.34,
                delay: index * 0.055,
                ease: ADMIN_EASE,
              }}
              whileHover={{ y: -3 }}
              className="rounded-2xl bg-[#0e1622]/85 border border-white/[0.08] hover:border-white/[0.16] p-5 shadow-[0_12px_30px_-18px_rgba(0,0,0,0.8)] transition-colors flex flex-col justify-between min-h-[146px]"
            >
              <div className="flex items-start justify-between gap-3">
                <div
                  className={`w-9 h-9 rounded-xl bg-gradient-to-br border flex items-center justify-center shrink-0 ${card.accent}`}
                >
                  <Icon className="w-4 h-4" />
                </div>

                {card.trend !== null && (
                  <span
                    title={`${card.trend > 0 ? '+' : ''}${card.trend}% ${card.trendContext}`}
                    className={`inline-flex items-center gap-1 text-xs font-medium tabular-nums ${
                      card.trend >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {card.trend >= 0 ? (
                      <TrendingUp className="w-3.5 h-3.5" />
                    ) : (
                      <TrendingDown className="w-3.5 h-3.5" />
                    )}
                    {card.trend > 0 ? '+' : ''}
                    {card.trend}%
                  </span>
                )}
              </div>

              <div className="mt-4">
                <p className="text-xs font-medium text-slate-400">{card.label}</p>
                <p className="text-2xl sm:text-[28px] font-semibold text-white tracking-tight mt-1">
                  <AnimatedCounter value={card.value} format={card.format} />
                </p>
                <p className="text-[11px] text-slate-400 mt-2 leading-relaxed tabular-nums">
                  {card.subtext}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Secondary Real Metrics Strip (unboxed hairline metrics, zero nested cards) */}
      <div className="rounded-2xl bg-[#0c131d]/75 border border-white/[0.07] px-5 py-3.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06]">
        <div className="pt-1 sm:pt-0">
          <p className="text-[11px] text-slate-400">Today&apos;s Sales</p>
          <p className="text-sm font-semibold text-white mt-0.5 tabular-nums">
            {formatINR(metrics.todaySalesAmount)}
            <span className="text-slate-500 font-normal ml-1.5">
              ({metrics.todayOrdersCount})
            </span>
          </p>
        </div>
        <div className="pt-2 sm:pt-0 sm:pl-4">
          <p className="text-[11px] text-slate-400">Monthly Active Volume</p>
          <p className="text-sm font-semibold text-white mt-0.5 tabular-nums">
            {formatINR(metrics.monthlyActiveOrderValue)}
          </p>
        </div>
        <div className="pt-2 sm:pt-0 sm:pl-4">
          <p className="text-[11px] text-slate-400">COD Due</p>
          <p className="text-sm font-semibold text-amber-300 mt-0.5 tabular-nums">
            {formatINR(metrics.codAmountDue)}
          </p>
        </div>
        <div className="pt-2 sm:pt-0 sm:pl-4">
          <p className="text-[11px] text-slate-400">Cancelled Orders</p>
          <p className="text-sm font-semibold text-rose-300 mt-0.5 tabular-nums">
            {metrics.cancelledOrdersCount}
          </p>
        </div>
        <div className="pt-2 sm:pt-0 sm:pl-4 col-span-2 sm:col-span-1">
          <p className="text-[11px] text-slate-400">Catalog Active</p>
          <p className="text-sm font-semibold text-white mt-0.5 tabular-nums">
            {metrics.activeProductsCount} / {metrics.totalProducts}
            {metrics.lowStockProducts.length > 0 && (
              <span className="text-amber-400 font-normal ml-1.5">
                · {metrics.lowStockProducts.length} low
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Row 2: Interactive Sales Analytics (8 cols) + Order Status Donut Breakdown (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Sales Analytics Chart */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, delay: 0.16, ease: ADMIN_EASE }}
          className="lg:col-span-8 rounded-2xl bg-[#0e1622]/85 border border-white/[0.08] p-5 sm:p-6 flex flex-col"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-white/[0.07]">
            <div>
              <h3 className="font-sans text-base sm:text-lg font-semibold text-white">
                Sales Analytics
              </h3>
              <p className="text-xs text-slate-400 mt-0.5 tabular-nums">
                {activeBucket ? (
                  <>
                    <span className="text-slate-200 font-medium">
                      {activeBucket.rangeLabel}:
                    </span>{' '}
                    Paid {formatINR(activeBucket.paidRevenue)} · COD/Pending{' '}
                    {formatINR(activeBucket.codAndPending)} ·{' '}
                    {activeBucket.orderCount}{' '}
                    {activeBucket.orderCount === 1 ? 'order' : 'orders'}
                  </>
                ) : (
                  <>
                    Period paid {formatINR(chartSummary.totalPaid)} · COD/Pending{' '}
                    {formatINR(chartSummary.totalPending)} ·{' '}
                    {chartSummary.totalOrders}{' '}
                    {chartSummary.totalOrders === 1 ? 'order' : 'orders'}
                  </>
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Revenue / Orders Metric Switch */}
              <div className="inline-flex items-center p-1 rounded-xl bg-[#080d14] border border-white/[0.07]">
                {(
                  [
                    { id: 'revenue', label: 'Revenue' },
                    { id: 'orders', label: 'Orders' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setChartMetric(m.id);
                      setHoveredBucketKey(null);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      chartMetric === m.id
                        ? 'bg-white/[0.12] text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Timeframe Switch */}
              <div className="inline-flex items-center p-1 rounded-xl bg-[#080d14] border border-white/[0.07]">
                {(
                  [
                    { id: '7d', label: '7D' },
                    { id: '30d', label: '30D' },
                    { id: '90d', label: '90D' },
                    { id: '6m', label: '6M' },
                  ] as const
                ).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setChartRange(r.id);
                      setHoveredBucketKey(null);
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      chartRange === r.id
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-400/25'
                        : 'text-slate-400 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center justify-between gap-2 mt-4 text-xs text-slate-400">
            <div className="flex items-center gap-4">
              {chartMetric === 'revenue' ? (
                <>
                  <span className="inline-flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm bg-teal-400 inline-block" />
                    Verified Paid
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm bg-amber-400/85 inline-block" />
                    COD / Awaiting Payment
                  </span>
                </>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm bg-gradient-to-t from-teal-500 to-amber-400 inline-block" />
                  Live Orders Placed (Non-Cancelled)
                </span>
              )}
            </div>
            <span className="text-[11px] text-slate-500">
              Tap or hover a bar to inspect
            </span>
          </div>

          {!chartSummary.hasData ? (
            <div className="flex-1 min-h-[240px] flex flex-col items-center justify-center text-center py-10">
              <div className="w-11 h-11 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-slate-400 mb-3">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <p className="text-sm font-medium text-slate-200">
                No live orders in this period
              </p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs">
                Try switching to 90D or 6M, or wait for new customer orders to be
                recorded in Supabase.
              </p>
            </div>
          ) : (
            <div className="mt-5 flex-1 flex flex-col justify-end">
              {/* Chart Canvas */}
              <div className="relative h-56 flex items-end gap-2 sm:gap-3 pt-6 pb-2 border-b border-white/[0.08]">
                {/* Subtle horizontal guide lines */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-6 bottom-2 flex flex-col justify-between"
                >
                  <div className="border-t border-dashed border-white/[0.05]" />
                  <div className="border-t border-dashed border-white/[0.05]" />
                  <div className="border-t border-dashed border-white/[0.05]" />
                  <div />
                </div>

                {chartSeries.map((bucket, idx) => {
                  const isActive = hoveredBucketKey === bucket.key;
                  const totalMetric =
                    chartMetric === 'revenue'
                      ? bucket.totalValue
                      : bucket.orderCount;

                  const totalHeightPct =
                    totalMetric > 0
                      ? Math.max(8, Math.round((totalMetric / chartSummary.maxVal) * 100))
                      : 0;

                  const paidSharePct =
                    bucket.totalValue > 0
                      ? Math.round((bucket.paidRevenue / bucket.totalValue) * 100)
                      : 0;

                  return (
                    <button
                      key={`${chartRange}-${chartMetric}-${bucket.key}`}
                      type="button"
                      onMouseEnter={() => setHoveredBucketKey(bucket.key)}
                      onMouseLeave={() => setHoveredBucketKey(null)}
                      onFocus={() => setHoveredBucketKey(bucket.key)}
                      onBlur={() => setHoveredBucketKey(null)}
                      onClick={() =>
                        setHoveredBucketKey((prev) =>
                          prev === bucket.key ? null : bucket.key
                        )
                      }
                      aria-label={`${bucket.rangeLabel}: ${formatINR(
                        bucket.totalValue
                      )}, ${bucket.orderCount} orders`}
                      className="relative z-10 flex-1 h-full flex flex-col items-center justify-end group cursor-pointer focus:outline-none"
                    >
                      {/* Top value readout on hover or single-bar highlight */}
                      <span
                        className={`text-[10px] tabular-nums mb-1.5 transition-opacity whitespace-nowrap ${
                          isActive
                            ? 'opacity-100 text-white font-semibold'
                            : totalMetric > 0 && chartSeries.length <= 7
                              ? 'opacity-75 text-slate-400 group-hover:opacity-100'
                              : 'opacity-0 group-hover:opacity-100 text-slate-300'
                        }`}
                      >
                        {totalMetric > 0
                          ? chartMetric === 'revenue'
                            ? formatINR(totalMetric)
                            : `${totalMetric}`
                          : ''}
                      </span>

                      {/* Bar Container */}
                      <div
                        className={`w-full max-w-[38px] h-full rounded-t-lg bg-white/[0.03] flex items-end overflow-hidden transition-colors ${
                          isActive ? 'ring-1 ring-amber-400/50 bg-white/[0.06]' : ''
                        }`}
                      >
                        {totalHeightPct > 0 && (
                          <motion.div
                            key={`${chartRange}-${chartMetric}-${bucket.key}-bar`}
                            initial={{ scaleY: 0, opacity: 0.4 }}
                            animate={{ scaleY: 1, opacity: 1 }}
                            transition={{
                              duration: 0.42,
                              delay: Math.min(idx * 0.03, 0.3),
                              ease: ADMIN_EASE,
                            }}
                            style={{
                              height: `${totalHeightPct}%`,
                              transformOrigin: 'bottom',
                            }}
                            className="w-full flex flex-col justify-end rounded-t-md overflow-hidden"
                          >
                            {chartMetric === 'revenue' ? (
                              <>
                                {bucket.codAndPending > 0 && (
                                  <div
                                    style={{ height: `${100 - paidSharePct}%` }}
                                    className="w-full bg-gradient-to-t from-amber-500/80 to-amber-400/95 min-h-[3px]"
                                  />
                                )}
                                {bucket.paidRevenue > 0 && (
                                  <div
                                    style={{ height: `${paidSharePct}%` }}
                                    className="w-full bg-gradient-to-t from-teal-500/90 to-teal-300/95 min-h-[3px]"
                                  />
                                )}
                              </>
                            ) : (
                              <div className="w-full h-full bg-gradient-to-t from-teal-500/85 via-teal-400/85 to-amber-300/90" />
                            )}
                          </motion.div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* X-Axis Labels */}
              <div className="flex items-start gap-2 sm:gap-3 pt-2.5">
                {chartSeries.map((bucket, idx) => {
                  const hideOnMobile =
                    chartSeries.length > 8 && idx % 2 === 1;
                  return (
                    <div
                      key={bucket.key}
                      className="flex-1 text-center min-w-0"
                    >
                      <p
                        className={`text-[10px] sm:text-[11px] font-medium truncate ${
                          hoveredBucketKey === bucket.key
                            ? 'text-amber-300'
                            : 'text-slate-400'
                        } ${hideOnMobile ? 'hidden sm:block' : ''}`}
                      >
                        {bucket.label}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </motion.section>

        {/* Order Status Breakdown (SVG Donut Ring inspired by reference screenshot) */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, delay: 0.22, ease: ADMIN_EASE }}
          className="lg:col-span-4 rounded-2xl bg-[#0e1622]/85 border border-white/[0.08] p-5 sm:p-6 flex flex-col justify-between"
        >
          <div className="pb-4 border-b border-white/[0.07]">
            <h3 className="font-sans text-base sm:text-lg font-semibold text-white">
              Order Status Breakdown
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Distribution across all live customer orders
            </p>
          </div>

          {statusBreakdown.total === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
              <p className="text-sm font-medium text-slate-200">
                No order data yet
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Order fulfillment ratios will populate automatically.
              </p>
            </div>
          ) : (
            <>
              <div className="my-5 flex items-center justify-center">
                <div className="relative w-40 h-40">
                  <svg
                    viewBox="0 0 140 140"
                    className="w-full h-full -rotate-90"
                    role="img"
                    aria-label="Order status distribution chart"
                  >
                    <circle
                      cx="70"
                      cy="70"
                      r={statusBreakdown.radius}
                      fill="none"
                      stroke="rgba(255,255,255,0.06)"
                      strokeWidth="14"
                    />
                    {statusBreakdown.segments.map((seg) =>
                      seg.count > 0 ? (
                        <motion.circle
                          key={seg.id}
                          cx="70"
                          cy="70"
                          r={statusBreakdown.radius}
                          fill="none"
                          stroke={seg.color}
                          strokeWidth="14"
                          strokeLinecap="butt"
                          strokeDasharray={`${Math.max(0, seg.dash - 2)} ${
                            statusBreakdown.circumference
                          }`}
                          initial={{ strokeDashoffset: statusBreakdown.circumference }}
                          animate={{ strokeDashoffset: seg.offset }}
                          transition={{ duration: 0.7, ease: ADMIN_EASE }}
                        />
                      ) : null
                    )}
                  </svg>

                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-2xl font-semibold text-white tabular-nums">
                      <AnimatedCounter
                        value={metrics.completionRate}
                        format="percent"
                      />
                    </span>
                    <span className="text-[11px] text-slate-400 mt-0.5">
                      Delivered
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-3 border-t border-white/[0.07]">
                {statusBreakdown.segments.map((seg) => (
                  <div
                    key={seg.id}
                    className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        style={{ backgroundColor: seg.color }}
                        className="w-2 h-2 rounded-full shrink-0"
                      />
                      <span className="text-[11px] text-slate-400 truncate">
                        {seg.label}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between mt-1 tabular-nums">
                      <span className={`text-sm font-semibold ${seg.textClass}`}>
                        {seg.count}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {seg.pct}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </motion.section>
      </div>

      {/* Row 3: Interactive Recent Orders Table */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.34, delay: 0.26, ease: ADMIN_EASE }}
        className="rounded-2xl bg-[#0e1622]/85 border border-white/[0.08] overflow-hidden"
      >
        <div className="p-5 sm:p-6 border-b border-white/[0.07] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-sans text-base sm:text-lg font-semibold text-white">
                Recent Orders
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Select any order to open full fulfillment, address, and cancellation controls.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('orders')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300 transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>View All Orders</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Search + Status Filter Controls */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={recentSearch}
                onChange={(e) => setRecentSearch(e.target.value)}
                placeholder="Search order #, customer, phone..."
                className="w-full pl-10 pr-3.5 py-2 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100 placeholder:text-slate-500 transition-colors"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
              {RECENT_ORDER_FILTERS.map((f) => {
                const active = recentStatusFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setRecentStatusFilter(f.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-400/30'
                        : 'bg-white/[0.03] text-slate-400 border border-white/[0.06] hover:text-slate-200 hover:bg-white/[0.06]'
                    }`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {filteredRecentOrders.length === 0 ? (
          <div className="py-12 px-6 text-center">
            <p className="text-sm font-medium text-slate-200">
              {liveOrders.length === 0
                ? 'No customer orders recorded yet'
                : 'No recent orders match your filter'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {liveOrders.length === 0
                ? 'Orders placed through storefront checkout will appear here immediately.'
                : 'Try clearing the search query or selecting another order status.'}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/[0.07] bg-white/[0.02] text-[11px] font-medium text-slate-400">
                    <th className="py-3.5 px-5">Order #</th>
                    <th className="py-3.5 px-4">Customer</th>
                    <th className="py-3.5 px-4">Date</th>
                    <th className="py-3.5 px-4">Payment</th>
                    <th className="py-3.5 px-4">Order Status</th>
                    <th className="py-3.5 px-5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06] text-xs">
                  {filteredRecentOrders.map((order) => (
                    <tr
                      key={order.id}
                      onClick={() => onInspectOrder(order)}
                      className="hover:bg-white/[0.04] transition-colors cursor-pointer group"
                    >
                      <td className="py-3.5 px-5 font-semibold text-white tabular-nums whitespace-nowrap">
                        <span className="group-hover:text-amber-300 transition-colors">
                          {order.order_number}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <p className="font-medium text-slate-100">
                          {order.customer_name}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {order.customer_email}
                        </p>
                      </td>
                      <td className="py-3.5 px-4 text-slate-400 tabular-nums whitespace-nowrap">
                        {formatShortDate(order.created_at)}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-medium text-slate-300 uppercase">
                            {order.payment_method === 'cod' ? 'COD' : 'Online'}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[11px] font-medium border capitalize ${paymentStatusBadgeV2(
                              order.payment_status
                            )}`}
                          >
                            {order.payment_status.replace('_', ' ')}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`px-2.5 py-1 rounded-md text-[11px] font-medium border capitalize ${orderStatusBadgeV2(
                            order.order_status
                          )}`}
                        >
                          {order.order_status}
                        </span>
                      </td>
                      <td className="py-3.5 px-5 text-right font-semibold text-white tabular-nums whitespace-nowrap">
                        {formatINR(order.total_inr)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Responsive Order List (Zero Horizontal Overflow) */}
            <div className="md:hidden divide-y divide-white/[0.06]">
              {filteredRecentOrders.map((order) => (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => onInspectOrder(order)}
                  className="w-full text-left p-4 hover:bg-white/[0.04] active:bg-white/[0.06] transition-colors cursor-pointer space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-white tabular-nums">
                      {order.order_number}
                    </span>
                    <span className="text-sm font-semibold text-white tabular-nums">
                      {formatINR(order.total_inr)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                    <span className="truncate">{order.customer_name}</span>
                    <span className="tabular-nums shrink-0">
                      {formatShortDate(order.created_at)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[11px] font-medium border capitalize ${orderStatusBadgeV2(
                        order.order_status
                      )}`}
                    >
                      {order.order_status}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[11px] font-medium border capitalize ${paymentStatusBadgeV2(
                        order.payment_status
                      )}`}
                    >
                      {order.payment_method === 'cod' ? 'COD' : 'Online'} ·{' '}
                      {order.payment_status.replace('_', ' ')}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </motion.section>

      {/* Row 4: Top Selling Products, Low Stock Watch (Manual), Quick Actions & Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Top Selling Products */}
        <section className="lg:col-span-4 rounded-2xl bg-[#0e1622]/85 border border-white/[0.08] p-5 flex flex-col">
          <div className="flex items-center justify-between pb-3.5 border-b border-white/[0.07]">
            <div>
              <h3 className="font-sans text-base font-semibold text-white">
                Top Selling Products
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                By units ordered in active live orders
              </p>
            </div>
            <ShoppingBag className="w-4 h-4 text-teal-400 shrink-0" />
          </div>

          <div className="flex-1 mt-3 divide-y divide-white/[0.06]">
            {topSellingProducts.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">
                Top selling products will appear once customer orders are placed.
              </p>
            ) : (
              topSellingProducts.map((item) => (
                <div
                  key={item.key}
                  className="py-3 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-12 rounded-lg bg-[#16202e] border border-white/[0.07] overflow-hidden shrink-0 flex items-center justify-center">
                      {item.image ? (
                        <img
                          src={item.image}
                          alt={item.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Package className="w-4 h-4 text-slate-500" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-100 truncate">
                        {item.name}
                      </p>
                      <p className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                        {item.units} {item.units === 1 ? 'unit' : 'units'} sold
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-teal-300 tabular-nums shrink-0">
                    {formatINR(item.revenue)}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Low Stock Products (Informational Only — Manual Stock) */}
        <section className="lg:col-span-4 rounded-2xl bg-[#0e1622]/85 border border-white/[0.08] p-5 flex flex-col">
          <div className="flex items-center justify-between pb-3.5 border-b border-white/[0.07]">
            <div>
              <h3 className="font-sans text-base font-semibold text-white">
                Low Stock Watch
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Informational · Stock is updated manually
              </p>
            </div>
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          </div>

          <div className="flex-1 mt-3 divide-y divide-white/[0.06]">
            {metrics.lowStockProducts.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">
                All catalog items currently have more than 5 units recorded.
              </p>
            ) : (
              metrics.lowStockProducts.slice(0, 5).map((item) => (
                <div
                  key={item.id}
                  className="py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-100 truncate">
                      {item.name}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {item.category} &middot; {item.garment_type}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-semibold tabular-nums shrink-0 ${
                      item.stock_count === 0
                        ? 'text-rose-400'
                        : 'text-amber-300'
                    }`}
                  >
                    {item.stock_count === 0
                      ? 'Out of stock'
                      : `${item.stock_count} left`}
                  </span>
                </div>
              ))
            )}
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab('products')}
            className="mt-3 pt-3 border-t border-white/[0.07] inline-flex items-center justify-between w-full text-xs font-medium text-slate-300 hover:text-amber-300 transition-colors cursor-pointer"
          >
            <span>Manage Inventory Manually</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </section>

        {/* Quick Actions + Recent Order Activity */}
        <section className="lg:col-span-4 rounded-2xl bg-[#0e1622]/85 border border-white/[0.08] p-5 flex flex-col justify-between gap-5">
          <div>
            <h3 className="font-sans text-base font-semibold text-white">
              Quick Actions
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Jump directly to core store operations
            </p>
            <div className="grid grid-cols-2 gap-2.5 mt-3.5">
              <button
                type="button"
                onClick={() => onNavigateTab('orders')}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.07] text-xs font-medium text-slate-100 transition-colors cursor-pointer text-left"
              >
                <ShoppingBag className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">Review Orders</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('bulk-shipping')}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.07] text-xs font-medium text-slate-100 transition-colors cursor-pointer text-left"
              >
                <Truck className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                <span className="truncate">Shipping Labels</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('offers')}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.07] text-xs font-medium text-slate-100 transition-colors cursor-pointer text-left"
              >
                <Tag className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">Offers &amp; Banners</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('products')}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.07] text-xs font-medium text-slate-100 transition-colors cursor-pointer text-left"
              >
                <Package className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                <span className="truncate">Catalog &amp; Stock</span>
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-white/[0.07]">
            <h4 className="font-sans text-xs font-semibold text-slate-200">
              Recent Activity
            </h4>
            <div className="mt-2.5 space-y-2.5">
              {recentActivity.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No recent store activity yet.
                </p>
              ) : (
                recentActivity.map((act) => (
                  <button
                    key={act.id}
                    type="button"
                    onClick={() => onInspectOrder(act.order)}
                    className="w-full text-left flex items-start justify-between gap-3 hover:bg-white/[0.03] -mx-2 px-2 py-1 rounded-lg transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className={`text-xs font-medium truncate ${act.tone}`}>
                        {act.title}
                      </p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {act.detail}
                      </p>
                    </div>
                    <span className="text-[10px] text-slate-500 tabular-nums shrink-0">
                      {formatCompactTime(act.time)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
