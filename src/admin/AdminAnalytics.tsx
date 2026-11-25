import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  IndianRupee,
  Landmark,
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
        Math.max(max, chartMetric === 'revenue' ? b.totalValue : b.orderCount),
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

  const statusBreakdown = useMemo(() => {
    const total = metrics.totalOrders;
    const segments = [
      {
        id: 'delivered',
        label: 'Delivered',
        count: metrics.deliveredOrdersCount,
        color: '#10b981',
        textClass: 'text-emerald-700',
      },
      {
        id: 'fulfillment',
        label: 'In Fulfillment',
        count: metrics.inFulfillmentCount,
        color: '#0891b2',
        textClass: 'text-cyan-800',
      },
      {
        id: 'pending',
        label: 'Pending',
        count: metrics.pendingOrdersCount,
        color: '#f59e0b',
        textClass: 'text-amber-700',
      },
      {
        id: 'cancelled',
        label: 'Cancelled',
        count: metrics.cancelledOrdersCount,
        color: '#f43f5e',
        textClass: 'text-rose-700',
      },
    ];

    const radius = 54;
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

  const recentActivity = useMemo(() => {
    return liveOrders.slice(0, 5).map((o) => {
      if (o.order_status === 'cancelled') {
        return {
          id: `${o.id}-cancel`,
          title: `${o.order_number} cancelled`,
          detail: `${o.customer_name} · By ${o.cancelled_by || 'system'}`,
          time: o.cancelled_at || o.created_at,
          tone: 'text-rose-700',
          order: o,
        };
      }
      if (o.order_status === 'delivered') {
        return {
          id: `${o.id}-delivered`,
          title: `${o.order_number} delivered`,
          detail: `${o.customer_name} · ${formatINR(o.total_inr)}`,
          time: o.created_at,
          tone: 'text-emerald-700',
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
        tone: 'text-[#0e7490]',
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
      trend: null as number | null,
      trendContext: '',
      subtext:
        metrics.totalOrders > 0
          ? `${metrics.completionRate}% delivered · Cancelled ${metrics.cancelledOrdersCount}`
          : `Cancelled ${metrics.cancelledOrdersCount} · No completed orders yet`,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="font-sans text-2xl sm:text-[28px] font-semibold text-[#0f2430] tracking-tight">
            Store Overview
          </h2>
          <p className="text-xs sm:text-sm text-[#546e7a] mt-0.5">
            Live revenue, fulfillment queue, and inventory health from Supabase.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigateTab('finance')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white hover:bg-slate-50 border border-slate-200/90 text-xs font-semibold text-[#0f2430] shadow-xs transition-colors cursor-pointer whitespace-nowrap min-h-[38px]"
          >
            <Landmark className="w-3.5 h-3.5 text-[#0e7490]" />
            <span>Finance</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigateTab('bulk-shipping')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white hover:bg-slate-50 border border-slate-200/90 text-xs font-semibold text-[#0f2430] shadow-xs transition-colors cursor-pointer whitespace-nowrap min-h-[38px]"
          >
            <Truck className="w-3.5 h-3.5 text-[#0e7490]" />
            <span>Shipping Center</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigateTab('products')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#0f2430] hover:bg-[#0e7490] text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap min-h-[38px] shadow-xs"
          >
            <Package className="w-3.5 h-3.5" />
            <span>Manage Products</span>
          </button>
        </div>
      </div>

      {/* QA Test Isolation Banner */}
      {testOrdersCount > 0 && (
        <div className="rounded-2xl bg-amber-50/90 border border-amber-200 px-4 py-3 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2">
          <span>
            <strong className="tabular-nums">{testOrdersCount}</strong> Shipping QA
            test {testOrdersCount === 1 ? 'order is' : 'orders are'} excluded from
            revenue, charts, and customer metrics.
          </span>
          <button
            type="button"
            onClick={() => onNavigateTab('bulk-shipping')}
            className="text-amber-800 hover:text-amber-950 font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <span>Open Shipping Center</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Row 1: 4 Animated Frosted KPI Cards */}
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
                delay: index * 0.05,
                ease: ADMIN_EASE,
              }}
              whileHover={{ y: -3 }}
              className="rounded-[22px] bg-white/88 backdrop-blur-sm border border-white p-5 shadow-[0_8px_28px_-14px_rgba(15,36,48,0.12)] flex flex-col justify-between min-h-[144px]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="w-9 h-9 rounded-full bg-[#e6f3f6] border border-[#cde6ec] flex items-center justify-center text-[#0e7490] shrink-0">
                  <Icon className="w-4 h-4" />
                </div>

                {card.trend !== null && (
                  <span
                    title={`${card.trend > 0 ? '+' : ''}${card.trend}% ${card.trendContext}`}
                    className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full ${
                      card.trend >= 0
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-rose-50 text-rose-700'
                    }`}
                  >
                    {card.trend >= 0 ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : (
                      <TrendingDown className="w-3 h-3" />
                    )}
                    {card.trend > 0 ? '+' : ''}
                    {card.trend}%
                  </span>
                )}
              </div>

              <div className="mt-4">
                <p className="text-2xl sm:text-[28px] font-bold text-[#0f2430] tracking-tight leading-none">
                  <AnimatedCounter value={card.value} format={card.format} />
                </p>
                <p className="text-xs font-medium text-[#3c5663] mt-2">
                  {card.label}
                </p>
                <p className="text-[11px] text-[#6d8490] mt-0.5 leading-relaxed tabular-nums">
                  {card.subtext}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Secondary Real Metrics Strip */}
      <div className="rounded-[20px] bg-white/82 border border-white px-5 py-3.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/70 shadow-xs">
        <div className="pt-1 sm:pt-0">
          <p className="text-[11px] text-[#647d89]">Today&apos;s Sales</p>
          <p className="text-sm font-bold text-[#0f2430] mt-0.5 tabular-nums">
            {formatINR(metrics.todaySalesAmount)}
            <span className="text-[#647d89] font-normal ml-1.5">
              ({metrics.todayOrdersCount})
            </span>
          </p>
        </div>
        <div className="pt-2 sm:pt-0 sm:pl-4">
          <p className="text-[11px] text-[#647d89]">Monthly Active Volume</p>
          <p className="text-sm font-bold text-[#0f2430] mt-0.5 tabular-nums">
            {formatINR(metrics.monthlyActiveOrderValue)}
          </p>
        </div>
        <div className="pt-2 sm:pt-0 sm:pl-4">
          <p className="text-[11px] text-[#647d89]">COD Due</p>
          <p className="text-sm font-bold text-amber-700 mt-0.5 tabular-nums">
            {formatINR(metrics.codAmountDue)}
          </p>
        </div>
        <div className="pt-2 sm:pt-0 sm:pl-4">
          <p className="text-[11px] text-[#647d89]">Cancelled Orders</p>
          <p className="text-sm font-bold text-rose-700 mt-0.5 tabular-nums">
            {metrics.cancelledOrdersCount}
          </p>
        </div>
        <div className="pt-2 sm:pt-0 sm:pl-4 col-span-2 sm:col-span-1">
          <p className="text-[11px] text-[#647d89]">Catalog Active</p>
          <p className="text-sm font-bold text-[#0f2430] mt-0.5 tabular-nums">
            {metrics.activeProductsCount} / {metrics.totalProducts}
            {metrics.lowStockProducts.length > 0 && (
              <span className="text-amber-700 font-semibold ml-1.5">
                · {metrics.lowStockProducts.length} low
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Row 2: Sales Analytics (8 cols) + Order Status Donut (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, delay: 0.14, ease: ADMIN_EASE }}
          className="lg:col-span-8 rounded-[24px] bg-white/88 backdrop-blur-sm border border-white p-5 sm:p-6 shadow-[0_8px_28px_-14px_rgba(15,36,48,0.12)] flex flex-col"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-[#0f2430]">
                Sales Analytics
              </h3>
              <p className="text-xs text-[#647d89] mt-0.5 tabular-nums">
                {activeBucket ? (
                  <>
                    <span className="text-[#0f2430] font-semibold">
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
                    onClick={() => {
                      setChartMetric(m.id);
                      setHoveredBucketKey(null);
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      chartMetric === m.id
                        ? 'bg-white text-[#0f2430] shadow-xs'
                        : 'text-[#5b7480] hover:text-[#0f2430]'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <div className="inline-flex items-center p-1 rounded-full bg-[#edf4f6] border border-slate-200/70">
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
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      chartRange === r.id
                        ? 'bg-[#0f2430] text-white'
                        : 'text-[#5b7480] hover:text-[#0f2430]'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center justify-between gap-2 mt-4 text-xs text-[#647d89]">
            <div className="flex items-center gap-4">
              {chartMetric === 'revenue' ? (
                <>
                  <span className="inline-flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#0e7490] inline-block" />
                    Verified Paid
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm bg-[#67e8f9] inline-block" />
                    COD / Awaiting Payment
                  </span>
                </>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#0891b2] inline-block" />
                  Live Orders Placed (Non-Cancelled)
                </span>
              )}
            </div>
            <span className="text-[11px] text-[#7c94a0]">
              Tap or hover a bar to inspect
            </span>
          </div>

          {!chartSummary.hasData ? (
            <div className="flex-1 min-h-[230px] flex flex-col items-center justify-center text-center py-10">
              <div className="w-11 h-11 rounded-full bg-[#eef5f7] border border-slate-200 flex items-center justify-center text-[#0e7490] mb-3">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <p className="text-sm font-semibold text-[#0f2430]">
                No live orders in this period
              </p>
              <p className="text-xs text-[#647d89] mt-1 max-w-xs">
                Try switching to 90D or 6M, or wait for new customer orders to be
                recorded in Supabase.
              </p>
            </div>
          ) : (
            <div className="mt-5 flex-1 flex flex-col justify-end">
              <div className="relative h-56 flex items-end gap-2 sm:gap-3 pt-6 pb-2 border-b border-slate-100">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-6 bottom-2 flex flex-col justify-between"
                >
                  <div className="border-t border-dashed border-slate-200/70" />
                  <div className="border-t border-dashed border-slate-200/70" />
                  <div className="border-t border-dashed border-slate-200/70" />
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
                      <span
                        className={`text-[10px] tabular-nums mb-1.5 transition-opacity whitespace-nowrap ${
                          isActive
                            ? 'opacity-100 text-[#0f2430] font-semibold'
                            : totalMetric > 0 && chartSeries.length <= 7
                              ? 'opacity-75 text-[#647d89] group-hover:opacity-100'
                              : 'opacity-0 group-hover:opacity-100 text-[#4d6774]'
                        }`}
                      >
                        {totalMetric > 0
                          ? chartMetric === 'revenue'
                            ? formatINR(totalMetric)
                            : `${totalMetric}`
                          : ''}
                      </span>

                      <div
                        className={`w-full max-w-[38px] h-full rounded-t-xl bg-[#eef5f7] flex items-end overflow-hidden transition-all ${
                          isActive ? 'ring-2 ring-[#0891b2]/45' : ''
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
                            className="w-full flex flex-col justify-end rounded-t-xl overflow-hidden"
                          >
                            {chartMetric === 'revenue' ? (
                              <>
                                {bucket.codAndPending > 0 && (
                                  <div
                                    style={{ height: `${100 - paidSharePct}%` }}
                                    className="w-full bg-gradient-to-t from-[#67e8f9] to-[#a5f3fc] min-h-[3px]"
                                  />
                                )}
                                {bucket.paidRevenue > 0 && (
                                  <div
                                    style={{ height: `${paidSharePct}%` }}
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
                            ? 'text-[#0e7490] font-semibold'
                            : 'text-[#647d89]'
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

        {/* Order Status Breakdown Donut */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, delay: 0.2, ease: ADMIN_EASE }}
          className="lg:col-span-4 rounded-[24px] bg-white/88 backdrop-blur-sm border border-white p-5 sm:p-6 shadow-[0_8px_28px_-14px_rgba(15,36,48,0.12)] flex flex-col justify-between"
        >
          <div className="pb-4 border-b border-slate-100">
            <h3 className="text-base sm:text-lg font-semibold text-[#0f2430]">
              Order Status Breakdown
            </h3>
            <p className="text-xs text-[#647d89] mt-0.5">
              Distribution across all live customer orders
            </p>
          </div>

          {statusBreakdown.total === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
              <p className="text-sm font-semibold text-[#0f2430]">
                No order data yet
              </p>
              <p className="text-xs text-[#647d89] mt-1">
                Order fulfillment ratios will populate automatically.
              </p>
            </div>
          ) : (
            <>
              <div className="my-5 flex items-center justify-center">
                <div className="relative w-40 h-40">
                  <svg
                    viewBox="0 0 136 136"
                    className="w-full h-full -rotate-90"
                    role="img"
                    aria-label="Order status distribution chart"
                  >
                    <circle
                      cx="68"
                      cy="68"
                      r={statusBreakdown.radius}
                      fill="none"
                      stroke="#e6eff2"
                      strokeWidth="14"
                    />
                    {statusBreakdown.segments.map((seg) =>
                      seg.count > 0 ? (
                        <motion.circle
                          key={seg.id}
                          cx="68"
                          cy="68"
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
                    <span className="text-2xl font-bold text-[#0f2430] tabular-nums">
                      <AnimatedCounter
                        value={metrics.completionRate}
                        format="percent"
                      />
                    </span>
                    <span className="text-[11px] text-[#647d89] mt-0.5">
                      Delivered
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-3 border-t border-slate-100">
                {statusBreakdown.segments.map((seg) => (
                  <div
                    key={seg.id}
                    className="rounded-2xl bg-[#f3f8fa] border border-slate-200/60 px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        style={{ backgroundColor: seg.color }}
                        className="w-2 h-2 rounded-full shrink-0"
                      />
                      <span className="text-[11px] text-[#546e7a] truncate">
                        {seg.label}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between mt-1 tabular-nums">
                      <span className={`text-sm font-bold ${seg.textClass}`}>
                        {seg.count}
                      </span>
                      <span className="text-[11px] text-[#7c94a0]">
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

      {/* Row 3: Recent Orders Table */}
      <section className="rounded-[24px] bg-white/88 backdrop-blur-sm border border-white shadow-[0_8px_28px_-14px_rgba(15,36,48,0.12)] overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-[#0f2430]">
                Recent Orders
              </h3>
              <p className="text-xs text-[#647d89] mt-0.5">
                Latest live customer orders. Click any row to open order details.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('orders')}
              className="lg:hidden text-xs font-semibold text-[#0e7490] inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
            >
              <span>All Orders</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 sm:flex-none sm:w-56">
              <Search className="w-3.5 h-3.5 text-[#6d8490] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={recentSearch}
                onChange={(e) => setRecentSearch(e.target.value)}
                placeholder="Order #, name, phone..."
                className="w-full pl-8 pr-3 py-2 rounded-full text-xs bg-[#f2f7f9] border border-slate-200/80 focus:border-[#0e7490] outline-none text-[#0f2430] placeholder:text-[#7c94a0]"
              />
            </div>

            <button
              type="button"
              onClick={() => onNavigateTab('orders')}
              className="hidden lg:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#eef5f7] hover:bg-[#e1eff3] text-xs font-semibold text-[#0e7490] transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>View All Orders</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-1.5 overflow-x-auto bg-[#f7fafb]">
          {RECENT_ORDER_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setRecentStatusFilter(f.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                recentStatusFilter === f.id
                  ? 'bg-[#0f2430] text-white'
                  : 'text-[#546e7a] hover:bg-white hover:text-[#0f2430]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {filteredRecentOrders.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-semibold text-[#0f2430]">
              No matching live orders
            </p>
            <p className="text-xs text-[#647d89] mt-1">
              {liveOrders.length === 0
                ? 'Customer orders placed on the storefront will appear here.'
                : 'Try clearing your search or selecting another status tab.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#f4f8fa] text-[#5c7683] border-b border-slate-100 text-[11px] font-medium">
                <tr>
                  <th className="py-3 px-5">Order</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Payment</th>
                  <th className="py-3 px-5 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRecentOrders.map((order) => (
                  <tr
                    key={order.id}
                    onClick={() => onInspectOrder(order)}
                    className="hover:bg-[#f2f8fa] transition-colors cursor-pointer"
                  >
                    <td className="py-3.5 px-5">
                      <p className="font-mono text-[11px] font-semibold text-[#0f2430]">
                        {order.order_number}
                      </p>
                      <p className="text-[11px] text-[#6d8490] mt-0.5 tabular-nums">
                        {formatShortDate(order.created_at)}
                      </p>
                    </td>
                    <td className="py-3.5 px-4">
                      <p className="font-semibold text-[#0f2430] truncate max-w-[180px]">
                        {order.customer_name}
                      </p>
                      <p className="text-[11px] text-[#6d8490]">
                        {order.shipping_address.city} &middot; {order.customer_phone}
                      </p>
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
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border capitalize whitespace-nowrap ${paymentStatusBadgeV2(
                          order.payment_status
                        )}`}
                      >
                        {order.payment_status.replace('_', ' ')}
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

      {/* Row 4: Top Selling Products + Low Stock Watch + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Top Selling Products */}
        <section className="rounded-[24px] bg-white/88 backdrop-blur-sm border border-white p-5 shadow-[0_8px_28px_-14px_rgba(15,36,48,0.12)]">
          <div className="flex items-center justify-between pb-3.5 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-[#0f2430]">
              Top Selling Pieces
            </h3>
            <button
              type="button"
              onClick={() => onNavigateTab('products')}
              className="text-xs font-medium text-[#0e7490] hover:underline cursor-pointer"
            >
              Catalog
            </button>
          </div>
          {topSellingProducts.length === 0 ? (
            <p className="text-xs text-[#647d89] py-8 text-center">
              Top products will appear as live orders come in.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 mt-2">
              {topSellingProducts.map((item) => (
                <div
                  key={item.key}
                  className="py-3 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-10 h-12 rounded-xl object-cover bg-slate-100 shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                        <Package className="w-4 h-4" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#0f2430] truncate">
                        {item.name}
                      </p>
                      <p className="text-[11px] text-[#647d89] tabular-nums">
                        {item.units} {item.units === 1 ? 'unit' : 'units'} sold
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-[#0f2430] tabular-nums shrink-0">
                    {formatINR(item.revenue)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Low Stock Watch (Manual Stock Management) */}
        <section className="rounded-[24px] bg-white/88 backdrop-blur-sm border border-white p-5 shadow-[0_8px_28px_-14px_rgba(15,36,48,0.12)]">
          <div className="flex items-center justify-between pb-3.5 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-[#0f2430] inline-flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span>Low Stock Watch</span>
            </h3>
            <span className="text-[11px] text-[#647d89] tabular-nums">
              &le; 5 units
            </span>
          </div>

          {metrics.lowStockProducts.length === 0 ? (
            <p className="text-xs text-emerald-700 py-8 text-center">
              All published products currently have healthy stock levels.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 mt-2">
              {metrics.lowStockProducts.slice(0, 5).map((p) => (
                <div
                  key={p.id}
                  className="py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#0f2430] truncate">
                      {p.name}
                    </p>
                    <p className="text-[11px] text-[#647d89]">
                      {p.category} &middot; {p.garment_type}
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold tabular-nums shrink-0 ${
                      p.stock_count === 0
                        ? 'bg-rose-50 text-rose-700 border border-rose-200'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {p.stock_count} left
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Recent Order Activity + Quick Shortcuts */}
        <section className="rounded-[24px] bg-white/88 backdrop-blur-sm border border-white p-5 shadow-[0_8px_28px_-14px_rgba(15,36,48,0.12)] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-[#0f2430]">
                Recent Activity
              </h3>
              <button
                type="button"
                onClick={() => onNavigateTab('offers')}
                className="text-xs font-medium text-[#0e7490] inline-flex items-center gap-1 hover:underline cursor-pointer"
              >
                <Tag className="w-3 h-3" />
                <span>Offers</span>
              </button>
            </div>

            {recentActivity.length === 0 ? (
              <p className="text-xs text-[#647d89] py-8 text-center">
                Order activity timeline will appear here.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 mt-2">
                {recentActivity.map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => onInspectOrder(ev.order)}
                    className="w-full py-2.5 text-left hover:bg-[#f2f8fa] -mx-2 px-2 rounded-xl transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-xs font-semibold truncate ${ev.tone}`}>
                        {ev.title}
                      </p>
                      <span className="text-[10px] text-[#7c94a0] tabular-nums shrink-0">
                        {formatCompactTime(ev.time)}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#546e7a] truncate mt-0.5">
                      {ev.detail}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
