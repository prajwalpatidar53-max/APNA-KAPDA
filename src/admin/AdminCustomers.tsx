import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { MapPin, Search, ShoppingBag, User, X } from 'lucide-react';
import { formatINR } from '../data/catalog';
import type { Order, UserProfile } from '../types';
import {
  ADMIN_EASE,
  AdminTableSkeleton,
  orderStatusBadgeV2,
  paymentStatusBadgeV2,
} from './AdminMotion';

interface AdminCustomersProps {
  customers: UserProfile[];
  orders: Order[];
  loading: boolean;
  onInspectOrder: (order: Order) => void;
}

function formatShortDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return '—';
  }
}

function getInitials(name?: string, email?: string): string {
  const source = (name || email || 'AK').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function AdminCustomers({
  customers,
  orders,
  loading,
  onInspectOrder,
}: AdminCustomersProps) {
  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<UserProfile | null>(null);

  const ordersByUser = useMemo(() => {
    const map = new Map<string, Order[]>();
    for (const order of orders) {
      if (order.is_test_order || !order.user_id) continue;
      const list = map.get(order.user_id) ?? [];
      list.push(order);
      map.set(order.user_id, list);
    }
    return map;
  }, [orders]);

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (!q) return true;
      return (
        c.full_name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q)
      );
    });
  }, [customers, search]);

  const selectedCustomerOrders = useMemo(() => {
    if (!selectedCustomer) return [];
    return ordersByUser.get(selectedCustomer.id) ?? [];
  }, [selectedCustomer, ordersByUser]);

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="rounded-[22px] bg-white/88 backdrop-blur-sm border border-white shadow-[0_8px_28px_-14px_rgba(15,36,48,0.12)] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-[#7c94a0] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer name, email, phone..."
            className="w-full pl-10 pr-3.5 py-2.5 rounded-xl text-xs bg-[#f4f8fa] border border-slate-200/90 focus:border-[#0e7490] focus:bg-white outline-none text-[#0f2430] placeholder:text-[#7c94a0] transition-colors"
          />
        </div>
        <p className="text-xs text-[#546e7a] tabular-nums">
          Registered profiles:{' '}
          <strong className="text-[#0f2430] font-semibold">
            {filteredCustomers.length}
          </strong>
        </p>
      </div>

      {/* Customers Table & Mobile Cards */}
      <div className="rounded-[22px] bg-white/88 backdrop-blur-sm border border-white shadow-[0_8px_28px_-14px_rgba(15,36,48,0.12)] overflow-hidden">
        {loading ? (
          <AdminTableSkeleton rows={5} />
        ) : filteredCustomers.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-base font-semibold text-[#0f2430]">
              No matching profiles
            </p>
            <p className="text-xs text-[#546e7a] mt-1.5">
              Registered APNA KAPDA customers appear here automatically upon signup.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200/80 bg-[#f6fafb] text-[11px] font-semibold text-[#607b87]">
                    <th className="py-3.5 px-5">Customer</th>
                    <th className="py-3.5 px-3">Phone</th>
                    <th className="py-3.5 px-3">City</th>
                    <th className="py-3.5 px-3">Role</th>
                    <th className="py-3.5 px-3">Joined</th>
                    <th className="py-3.5 px-3 text-right">Orders</th>
                    <th className="py-3.5 px-5 text-right">Paid Spend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70 text-xs">
                  {filteredCustomers.map((customer) => {
                    const userOrders = ordersByUser.get(customer.id) ?? [];
                    const paidSpend = userOrders
                      .filter(
                        (o) =>
                          o.payment_status === 'paid' &&
                          o.order_status !== 'cancelled'
                      )
                      .reduce((sum, o) => sum + Number(o.total_inr || 0), 0);

                    return (
                      <tr
                        key={customer.id}
                        onClick={() => setSelectedCustomer(customer)}
                        className="hover:bg-[#f2f8fa] transition-colors cursor-pointer group"
                      >
                        <td className="py-3.5 px-5">
                          <div className="flex items-center gap-3">
                            <span className="w-9 h-9 rounded-full bg-gradient-to-br from-[#0e7490]/15 to-cyan-500/20 border border-[#0e7490]/20 text-[#0e7490] text-[11px] font-bold flex items-center justify-center shrink-0">
                              {getInitials(customer.full_name, customer.email)}
                            </span>
                            <div className="min-w-0">
                              <p className="font-semibold text-[#0f2430] group-hover:text-[#0e7490] transition-colors truncate">
                                {customer.full_name || 'Unnamed Customer'}
                              </p>
                              <p className="text-[11px] text-[#607b87] truncate">
                                {customer.email || '—'}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-3 text-[#3c5662] tabular-nums whitespace-nowrap">
                          {customer.phone || '—'}
                        </td>
                        <td className="py-3.5 px-3 text-[#3c5662] whitespace-nowrap">
                          {customer.default_address?.city
                            ? `${customer.default_address.city}, ${customer.default_address.state}`
                            : '—'}
                        </td>
                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border capitalize ${
                              customer.role === 'admin'
                                ? 'border-cyan-200 bg-cyan-50 text-[#0e7490]'
                                : 'border-slate-200 bg-slate-50 text-[#546e7a]'
                            }`}
                          >
                            {customer.role}
                          </span>
                        </td>
                        <td className="py-3.5 px-3 text-[#607b87] tabular-nums whitespace-nowrap">
                          {formatShortDate(customer.created_at)}
                        </td>
                        <td className="py-3.5 px-3 text-right font-semibold text-[#0f2430] tabular-nums">
                          {userOrders.length}
                        </td>
                        <td className="py-3.5 px-5 text-right font-semibold text-[#0e7490] tabular-nums whitespace-nowrap">
                          {formatINR(paidSpend)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Customer Cards */}
            <div className="md:hidden divide-y divide-slate-200/70">
              {filteredCustomers.map((customer) => {
                const userOrders = ordersByUser.get(customer.id) ?? [];
                const paidSpend = userOrders
                  .filter(
                    (o) =>
                      o.payment_status === 'paid' &&
                      o.order_status !== 'cancelled'
                  )
                  .reduce((sum, o) => sum + Number(o.total_inr || 0), 0);

                return (
                  <button
                    key={customer.id}
                    type="button"
                    onClick={() => setSelectedCustomer(customer)}
                    className="w-full text-left p-4 hover:bg-[#f2f8fa] transition-colors cursor-pointer space-y-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-8 h-8 rounded-full bg-cyan-50 border border-cyan-200 text-[#0e7490] text-[11px] font-bold flex items-center justify-center shrink-0">
                          {getInitials(customer.full_name, customer.email)}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#0f2430] truncate">
                            {customer.full_name || 'Unnamed Customer'}
                          </p>
                          <p className="text-[11px] text-[#607b87] truncate">
                            {customer.email || '—'}
                          </p>
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-[#0e7490] tabular-nums shrink-0">
                        {formatINR(paidSpend)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#546e7a] pl-10">
                      <span className="tabular-nums">{customer.phone || 'No phone'}</span>
                      <span className="tabular-nums">
                        {userOrders.length} {userOrders.length === 1 ? 'order' : 'orders'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Customer Detail Drawer */}
      <AnimatePresence>
        {selectedCustomer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-[#071c27]/55 backdrop-blur-[3px] flex justify-end"
            onClick={() => setSelectedCustomer(null)}
          >
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.28, ease: ADMIN_EASE }}
              className="w-full max-w-xl bg-[#f4f8fa] text-[#0f2430] h-full overflow-y-auto border-l border-white shadow-2xl flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-5 border-b border-slate-200/80 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur-md z-10">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-10 h-10 rounded-full bg-gradient-to-br from-[#0e7490] to-[#0f2430] text-white text-xs font-bold flex items-center justify-center shrink-0">
                    {getInitials(selectedCustomer.full_name, selectedCustomer.email)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0e7490]">
                      Customer Profile
                    </p>
                    <h3 className="font-sans text-lg font-semibold text-[#0f2430] mt-0.5 truncate">
                      {selectedCustomer.full_name || 'Customer Account'}
                    </h3>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCustomer(null)}
                  aria-label="Close customer profile"
                  className="p-2 rounded-full text-[#546e7a] hover:text-[#0f2430] hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-2xl bg-white border border-slate-200/80 p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-[#0e7490] mb-2">
                      <User className="w-3.5 h-3.5" />
                      <span className="text-xs font-semibold">Contact Details</span>
                    </div>
                    <p className="text-xs font-semibold text-[#0f2430] break-all">
                      {selectedCustomer.email || 'No email on profile'}
                    </p>
                    <p className="text-xs text-[#4a6470] mt-1 tabular-nums">
                      Phone: {selectedCustomer.phone || 'Not provided'}
                    </p>
                    <p className="text-[11px] text-[#708a96] mt-2 tabular-nums">
                      Joined {formatShortDate(selectedCustomer.created_at)}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-white border border-slate-200/80 p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-[#0e7490] mb-2">
                      <MapPin className="w-3.5 h-3.5" />
                      <span className="text-xs font-semibold">Default Address</span>
                    </div>
                    {selectedCustomer.default_address?.line1 ? (
                      <p className="text-xs text-[#334e5a] leading-relaxed">
                        {selectedCustomer.default_address.line1}
                        {selectedCustomer.default_address.line2
                          ? `, ${selectedCustomer.default_address.line2}`
                          : ''}
                        <br />
                        {selectedCustomer.default_address.city},{' '}
                        {selectedCustomer.default_address.state} &ndash;{' '}
                        <span className="tabular-nums font-medium">
                          {selectedCustomer.default_address.pincode}
                        </span>
                      </p>
                    ) : (
                      <p className="text-xs text-[#708a96]">
                        No saved shipping address yet.
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl bg-white border border-slate-200/80 overflow-hidden shadow-sm">
                  <div className="px-4 py-3 bg-[#f6fafb] border-b border-slate-200/80 flex items-center gap-2">
                    <ShoppingBag className="w-3.5 h-3.5 text-[#0e7490]" />
                    <span className="text-xs font-semibold text-[#0f2430]">
                      Order History ({selectedCustomerOrders.length})
                    </span>
                  </div>

                  {selectedCustomerOrders.length === 0 ? (
                    <p className="p-6 text-center text-xs text-[#607b87]">
                      This customer has not placed any orders yet.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-200/70">
                      {selectedCustomerOrders.map((order) => (
                        <div
                          key={order.id}
                          className="p-4 flex items-center justify-between gap-4 hover:bg-[#f6fafb] transition-colors"
                        >
                          <div className="space-y-1">
                            <p className="text-xs font-semibold text-[#0f2430] tabular-nums">
                              {order.order_number}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#607b87] tabular-nums">
                              <span>{formatShortDate(order.created_at)}</span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-medium border capitalize ${orderStatusBadgeV2(
                                  order.order_status
                                )}`}
                              >
                                {order.order_status}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-medium border capitalize ${paymentStatusBadgeV2(
                                  order.payment_status
                                )}`}
                              >
                                {order.payment_status.replace('_', ' ')}
                              </span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs font-semibold text-[#0f2430] tabular-nums">
                              {formatINR(order.total_inr)}
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCustomer(null);
                                onInspectOrder(order);
                              }}
                              className="text-xs text-[#0e7490] hover:text-[#0f2430] font-semibold mt-1 cursor-pointer transition-colors"
                            >
                              Inspect Order &rarr;
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
