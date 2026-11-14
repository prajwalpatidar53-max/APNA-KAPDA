import { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  IndianRupee,
  Package,
  ShoppingBag,
  Truck,
} from 'lucide-react';
import { formatINR } from '../data/catalog';
import type { Order, Product } from '../types';

interface AdminAnalyticsProps {
  orders: Order[];
  products: Product[];
  loading: boolean;
  onNavigateTab: (tab: 'orders' | 'products') => void;
  onInspectOrder: (order: Order) => void;
}

interface MonthBucket {
  key: string;
  label: string;
  paidRevenue: number;
  codAndPending: number;
  orderCount: number;
}

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

export function AdminAnalytics({
  orders,
  products,
  loading,
  onNavigateTab,
  onInspectOrder,
}: AdminAnalyticsProps) {
  const metrics = useMemo(() => {
    const activeOrders = orders.filter((o) => o.order_status !== 'cancelled');

    const verifiedPaidRevenue = activeOrders
      .filter((o) => o.payment_status === 'paid')
      .reduce((sum, o) => sum + Number(o.total_inr || 0), 0);

    const codAmountDue = activeOrders
      .filter(
        (o) => o.payment_method === 'cod' && o.payment_status === 'cod_due'
      )
      .reduce((sum, o) => sum + Number(o.total_inr || 0), 0);

    const awaitingOnlineAmount = activeOrders
      .filter((o) => o.payment_status === 'awaiting_payment')
      .reduce((sum, o) => sum + Number(o.total_inr || 0), 0);

    const pendingOrdersCount = orders.filter(
      (o) => o.order_status === 'pending'
    ).length;
    const deliveredOrdersCount = orders.filter(
      (o) => o.order_status === 'delivered'
    ).length;

    const lowStockProducts = products.filter((p) => p.stock_count <= 5);
    const activeProductsCount = products.filter((p) => p.is_active).length;

    return {
      totalOrders: orders.length,
      verifiedPaidRevenue,
      codAmountDue,
      awaitingOnlineAmount,
      pendingOrdersCount,
      deliveredOrdersCount,
      totalProducts: products.length,
      activeProductsCount,
      lowStockProducts,
    };
  }, [orders, products]);

  const monthlySeries = useMemo<MonthBucket[]>(() => {
    const now = new Date();
    const buckets: MonthBucket[] = [];

    for (let i = 5; i >= 0; i--) {
      const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(
        2,
        '0'
      )}`;
      const label = new Intl.DateTimeFormat('en-IN', {
        month: 'short',
        year: '2-digit',
      }).format(dt);
      buckets.push({
        key,
        label,
        paidRevenue: 0,
        codAndPending: 0,
        orderCount: 0,
      });
    }

    const bucketMap = new Map(buckets.map((b) => [b.key, b]));

    for (const order of orders) {
      if (order.order_status === 'cancelled') continue;
      const dt = new Date(order.created_at);
      if (Number.isNaN(dt.getTime())) continue;
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(
        2,
        '0'
      )}`;
      const bucket = bucketMap.get(key);
      if (!bucket) continue;

      bucket.orderCount += 1;
      if (order.payment_status === 'paid') {
        bucket.paidRevenue += Number(order.total_inr || 0);
      } else if (
        order.payment_status === 'cod_due' ||
        order.payment_status === 'awaiting_payment'
      ) {
        bucket.codAndPending += Number(order.total_inr || 0);
      }
    }

    return buckets;
  }, [orders]);

  const maxChartValue = useMemo(() => {
    const maxVal = monthlySeries.reduce(
      (max, b) => Math.max(max, b.paidRevenue + b.codAndPending),
      0
    );
    return maxVal > 0 ? maxVal : 1;
  }, [monthlySeries]);

  const recentOrders = useMemo(() => orders.slice(0, 6), [orders]);

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-[#fffdf8] border border-[#e5dfd3] p-5">
          <div className="flex items-center justify-between text-[#817b70]">
            <span className="text-[10px] tracking-[0.18em] uppercase font-semibold">
              Verified Paid Revenue
            </span>
            <IndianRupee className="w-4 h-4 text-[#9a6746]" />
          </div>
          <p className="font-serif-display text-3xl text-[#211f1b] mt-3 tabular-nums">
            {loading ? '—' : formatINR(metrics.verifiedPaidRevenue)}
          </p>
          <p className="text-[11px] text-[#5f594f] mt-2">
            Counted strictly from orders with status <strong>paid</strong>
          </p>
        </div>

        <div className="bg-[#fffdf8] border border-[#e5dfd3] p-5">
          <div className="flex items-center justify-between text-[#817b70]">
            <span className="text-[10px] tracking-[0.18em] uppercase font-semibold">
              COD Amount Due
            </span>
            <Truck className="w-4 h-4 text-[#9a6746]" />
          </div>
          <p className="font-serif-display text-3xl text-[#211f1b] mt-3 tabular-nums">
            {loading ? '—' : formatINR(metrics.codAmountDue)}
          </p>
          <p className="text-[11px] text-[#5f594f] mt-2 tabular-nums">
            Awaiting online: {formatINR(metrics.awaitingOnlineAmount)}
          </p>
        </div>

        <div className="bg-[#fffdf8] border border-[#e5dfd3] p-5">
          <div className="flex items-center justify-between text-[#817b70]">
            <span className="text-[10px] tracking-[0.18em] uppercase font-semibold">
              Orders Overview
            </span>
            <ShoppingBag className="w-4 h-4 text-[#9a6746]" />
          </div>
          <p className="font-serif-display text-3xl text-[#211f1b] mt-3 tabular-nums">
            {loading ? '—' : metrics.totalOrders}
          </p>
          <p className="text-[11px] text-[#5f594f] mt-2 tabular-nums">
            Pending: <strong className="text-[#211f1b]">{metrics.pendingOrdersCount}</strong>{' '}
            &middot; Delivered:{' '}
            <strong className="text-[#211f1b]">{metrics.deliveredOrdersCount}</strong>
          </p>
        </div>

        <div className="bg-[#fffdf8] border border-[#e5dfd3] p-5">
          <div className="flex items-center justify-between text-[#817b70]">
            <span className="text-[10px] tracking-[0.18em] uppercase font-semibold">
              Catalog &amp; Stock
            </span>
            <Package className="w-4 h-4 text-[#9a6746]" />
          </div>
          <p className="font-serif-display text-3xl text-[#211f1b] mt-3 tabular-nums">
            {loading ? '—' : metrics.totalProducts}
          </p>
          <p className="text-[11px] text-[#5f594f] mt-2 tabular-nums">
            Active: <strong className="text-[#211f1b]">{metrics.activeProductsCount}</strong>{' '}
            &middot; Low stock (&le;5):{' '}
            <strong
              className={
                metrics.lowStockProducts.length > 0
                  ? 'text-[#b91c1c]'
                  : 'text-[#211f1b]'
              }
            >
              {metrics.lowStockProducts.length}
            </strong>
          </p>
        </div>
      </div>

      {/* Monthly Sales Chart + Low Stock Watch */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="lg:col-span-8 bg-[#fffdf8] border border-[#e5dfd3] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[#e5dfd3]">
            <div>
              <p className="text-[10px] tracking-[0.2em] uppercase text-[#9a6746] font-bold">
                6-Month Sales Ledger
              </p>
              <h2 className="font-serif-display text-xl text-[#211f1b] mt-1">
                Verified Paid Revenue vs. COD &amp; Pending
              </h2>
            </div>
            <div className="flex items-center gap-4 text-[11px] text-[#5f594f]">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-[#24231f] inline-block" />
                Verified Paid
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-[#c9b79c] inline-block" />
                COD / Awaiting Payment
              </span>
            </div>
          </div>

          {orders.length === 0 ? (
            <div className="py-16 text-center">
              <p className="font-serif-display text-xl text-[#211f1b]">
                No orders recorded yet
              </p>
              <p className="text-xs text-[#817b70] mt-1.5">
                Monthly revenue and COD receivables will chart automatically as
                customers place orders.
              </p>
            </div>
          ) : (
            <div className="mt-6">
              <div className="grid grid-cols-6 gap-3 sm:gap-5 items-end h-56 pt-4 border-b border-[#e5dfd3] pb-3">
                {monthlySeries.map((bucket) => {
                  const total = bucket.paidRevenue + bucket.codAndPending;
                  const paidPct = Math.round(
                    (bucket.paidRevenue / maxChartValue) * 100
                  );
                  const pendingPct = Math.round(
                    (bucket.codAndPending / maxChartValue) * 100
                  );
                  return (
                    <div
                      key={bucket.key}
                      className="flex flex-col items-center justify-end h-full group"
                    >
                      <span className="text-[10px] text-[#5f594f] tabular-nums mb-2 opacity-90">
                        {total > 0 ? formatINR(total) : '₹0'}
                      </span>
                      <div className="w-full max-w-[44px] flex-1 flex flex-col justify-end bg-[#f5f2eb]/70 overflow-hidden">
                        {pendingPct > 0 && (
                          <div
                            style={{ height: `${Math.max(4, pendingPct)}%` }}
                            title={`COD / Pending: ${formatINR(bucket.codAndPending)}`}
                            className="w-full bg-[#c9b79c] transition-all"
                          />
                        )}
                        {paidPct > 0 && (
                          <div
                            style={{ height: `${Math.max(4, paidPct)}%` }}
                            title={`Verified Paid: ${formatINR(bucket.paidRevenue)}`}
                            className="w-full bg-[#24231f] transition-all"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-6 gap-3 sm:gap-5 pt-2.5">
                {monthlySeries.map((bucket) => (
                  <div key={bucket.key} className="text-center">
                    <p className="text-[11px] font-semibold text-[#211f1b]">
                      {bucket.label}
                    </p>
                    <p className="text-[10px] text-[#817b70] tabular-nums">
                      {bucket.orderCount} {bucket.orderCount === 1 ? 'order' : 'orders'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="lg:col-span-4 bg-[#fffdf8] border border-[#e5dfd3] p-6 flex flex-col">
          <div className="flex items-center justify-between pb-4 border-b border-[#e5dfd3]">
            <div>
              <p className="text-[10px] tracking-[0.2em] uppercase text-[#9a6746] font-bold">
                Inventory Watch
              </p>
              <h2 className="font-serif-display text-xl text-[#211f1b] mt-1">
                Low Stock Alerts
              </h2>
            </div>
            <AlertTriangle className="w-4 h-4 text-[#9a6746]" />
          </div>

          <div className="flex-1 mt-4 space-y-2.5">
            {metrics.lowStockProducts.length === 0 ? (
              <p className="text-xs text-[#817b70] py-8 text-center">
                All catalog items currently hold more than 5 units in stock.
              </p>
            ) : (
              metrics.lowStockProducts.slice(0, 5).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 py-2.5 border-b border-[#e5dfd3] last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#211f1b] truncate">
                      {item.name}
                    </p>
                    <p className="text-[11px] text-[#817b70]">
                      {item.category} &middot; {item.garment_type}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-semibold tabular-nums shrink-0 ${
                      item.stock_count === 0 ? 'text-[#b91c1c]' : 'text-[#9a6746]'
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
            className="mt-4 pt-3 border-t border-[#e5dfd3] inline-flex items-center justify-between w-full text-[11px] tracking-[0.14em] uppercase font-semibold text-[#211f1b] hover:text-[#9a6746] transition-colors cursor-pointer"
          >
            <span>Manage Inventory</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </section>
      </div>

      {/* Recent Orders */}
      <section className="bg-[#fffdf8] border border-[#e5dfd3] p-6">
        <div className="flex items-center justify-between pb-4 border-b border-[#e5dfd3]">
          <div>
            <p className="text-[10px] tracking-[0.2em] uppercase text-[#9a6746] font-bold">
              Fulfillment Queue
            </p>
            <h2 className="font-serif-display text-xl text-[#211f1b] mt-1">
              Recent Customer Orders
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('orders')}
            className="text-[11px] tracking-[0.14em] uppercase font-semibold text-[#9a6746] hover:text-[#211f1b] transition-colors inline-flex items-center gap-1.5 cursor-pointer"
          >
            <span>View All Orders</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {recentOrders.length === 0 ? (
          <p className="text-xs text-[#817b70] py-10 text-center">
            No customer orders found in the database yet.
          </p>
        ) : (
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#e5dfd3] text-[10px] tracking-[0.16em] uppercase text-[#817b70]">
                  <th className="py-3 pr-4 font-semibold">Order #</th>
                  <th className="py-3 pr-4 font-semibold">Customer</th>
                  <th className="py-3 pr-4 font-semibold">Date</th>
                  <th className="py-3 pr-4 font-semibold">Payment</th>
                  <th className="py-3 pr-4 font-semibold">Order Status</th>
                  <th className="py-3 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5dfd3] text-xs">
                {recentOrders.map((order) => (
                  <tr
                    key={order.id}
                    onClick={() => onInspectOrder(order)}
                    className="hover:bg-[#f5f2eb]/60 transition-colors cursor-pointer"
                  >
                    <td className="py-3.5 pr-4 font-semibold text-[#211f1b] tabular-nums">
                      {order.order_number}
                    </td>
                    <td className="py-3.5 pr-4">
                      <p className="font-medium text-[#211f1b]">
                        {order.customer_name}
                      </p>
                      <p className="text-[11px] text-[#817b70]">
                        {order.customer_email}
                      </p>
                    </td>
                    <td className="py-3.5 pr-4 text-[#5f594f] tabular-nums">
                      {formatShortDate(order.created_at)}
                    </td>
                    <td className="py-3.5 pr-4 text-[#5f594f]">
                      <span className="uppercase text-[10px] tracking-[0.08em] font-semibold text-[#211f1b]">
                        {order.payment_method === 'cod' ? 'COD' : 'Online'}
                      </span>{' '}
                      &middot;{' '}
                      <span className="capitalize">
                        {order.payment_status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3.5 pr-4 capitalize font-medium text-[#211f1b]">
                      {order.order_status}
                    </td>
                    <td className="py-3.5 text-right font-semibold text-[#211f1b] tabular-nums">
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
