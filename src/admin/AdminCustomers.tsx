import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { MapPin, Search, ShoppingBag, User, X } from 'lucide-react';
import { formatINR } from '../data/catalog';
import type { Order, UserProfile } from '../types';
import { ADMIN_EASE, AdminTableSkeleton } from './AdminMotion';

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
      <div className="rounded-2xl bg-[#0e1622]/85 border border-white/[0.08] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer name, email, phone..."
            className="w-full pl-10 pr-3.5 py-2.5 rounded-xl text-xs bg-[#080d14] border border-white/[0.09] focus:border-amber-400/60 outline-none text-slate-100 placeholder:text-slate-500"
          />
        </div>
        <p className="text-xs text-slate-400 tabular-nums">
          Registered profiles:{' '}
          <strong className="text-white">{filteredCustomers.length}</strong>
        </p>
      </div>

      {/* Customers Table */}
      <div className="rounded-2xl bg-[#0e1622]/85 border border-white/[0.08] overflow-hidden">
        {loading ? (
          <AdminTableSkeleton rows={5} />
        ) : filteredCustomers.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-base font-semibold text-white">
              No matching profiles
            </p>
            <p className="text-xs text-slate-400 mt-1.5">
              Registered APNA KAPDA customers appear here automatically upon signup.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.07] bg-white/[0.02] text-[11px] font-medium text-slate-400">
                  <th className="py-3.5 px-5">Customer</th>
                  <th className="py-3.5 px-3">Phone</th>
                  <th className="py-3.5 px-3">City</th>
                  <th className="py-3.5 px-3">Role</th>
                  <th className="py-3.5 px-3">Joined</th>
                  <th className="py-3.5 px-3 text-right">Orders</th>
                  <th className="py-3.5 px-5 text-right">Paid Spend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-xs">
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
                      className="hover:bg-white/[0.04] transition-colors cursor-pointer"
                    >
                      <td className="py-3.5 px-5">
                        <p className="font-semibold text-white">
                          {customer.full_name || 'Unnamed Customer'}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {customer.email || '—'}
                        </p>
                      </td>
                      <td className="py-3.5 px-3 text-slate-300 tabular-nums whitespace-nowrap">
                        {customer.phone || '—'}
                      </td>
                      <td className="py-3.5 px-3 text-slate-300 whitespace-nowrap">
                        {customer.default_address?.city
                          ? `${customer.default_address.city}, ${customer.default_address.state}`
                          : '—'}
                      </td>
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-medium border capitalize ${
                            customer.role === 'admin'
                              ? 'border-amber-400/30 bg-amber-500/15 text-amber-300'
                              : 'border-white/[0.08] bg-white/[0.04] text-slate-300'
                          }`}
                        >
                          {customer.role}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-slate-400 tabular-nums whitespace-nowrap">
                        {formatShortDate(customer.created_at)}
                      </td>
                      <td className="py-3.5 px-3 text-right font-semibold text-white tabular-nums">
                        {userOrders.length}
                      </td>
                      <td className="py-3.5 px-5 text-right font-semibold text-teal-300 tabular-nums whitespace-nowrap">
                        {formatINR(paidSpend)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex justify-end"
            onClick={() => setSelectedCustomer(null)}
          >
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.28, ease: ADMIN_EASE }}
              className="w-full max-w-xl bg-[#0d141f] h-full overflow-y-auto border-l border-white/[0.1] shadow-2xl flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-5 border-b border-white/[0.08] flex items-center justify-between sticky top-0 bg-[#0d141f]/95 backdrop-blur-md z-10">
                <div>
                  <p className="text-xs font-medium text-amber-400">
                    Customer Profile
                  </p>
                  <h3 className="font-sans text-xl font-semibold text-white mt-0.5">
                    {selectedCustomer.full_name || 'Customer Account'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCustomer(null)}
                  aria-label="Close customer profile"
                  className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-4">
                    <div className="flex items-center gap-2 text-amber-400 mb-2">
                      <User className="w-3.5 h-3.5" />
                      <span className="text-xs font-medium">Contact Details</span>
                    </div>
                    <p className="text-xs font-semibold text-white break-all">
                      {selectedCustomer.email || 'No email on profile'}
                    </p>
                    <p className="text-xs text-slate-300 mt-1 tabular-nums">
                      Phone: {selectedCustomer.phone || 'Not provided'}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-2 tabular-nums">
                      Joined {formatShortDate(selectedCustomer.created_at)}
                    </p>
                  </div>

                  <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-4">
                    <div className="flex items-center gap-2 text-teal-400 mb-2">
                      <MapPin className="w-3.5 h-3.5" />
                      <span className="text-xs font-medium">Default Address</span>
                    </div>
                    {selectedCustomer.default_address?.line1 ? (
                      <p className="text-xs text-slate-200 leading-relaxed">
                        {selectedCustomer.default_address.line1}
                        {selectedCustomer.default_address.line2
                          ? `, ${selectedCustomer.default_address.line2}`
                          : ''}
                        <br />
                        {selectedCustomer.default_address.city},{' '}
                        {selectedCustomer.default_address.state} &ndash;{' '}
                        <span className="tabular-nums">
                          {selectedCustomer.default_address.pincode}
                        </span>
                      </p>
                    ) : (
                      <p className="text-xs text-slate-400">
                        No saved shipping address yet.
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-white/[0.08] overflow-hidden">
                  <div className="px-4 py-3 bg-white/[0.03] border-b border-white/[0.07] flex items-center gap-2">
                    <ShoppingBag className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs font-semibold text-white">
                      Order History ({selectedCustomerOrders.length})
                    </span>
                  </div>

                  {selectedCustomerOrders.length === 0 ? (
                    <p className="p-6 text-center text-xs text-slate-400">
                      This customer has not placed any orders yet.
                    </p>
                  ) : (
                    <div className="divide-y divide-white/[0.06]">
                      {selectedCustomerOrders.map((order) => (
                        <div
                          key={order.id}
                          className="p-4 flex items-center justify-between gap-4 hover:bg-white/[0.04] transition-colors"
                        >
                          <div>
                            <p className="text-xs font-semibold text-white tabular-nums">
                              {order.order_number}
                            </p>
                            <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                              {formatShortDate(order.created_at)} &middot;{' '}
                              <span className="capitalize">
                                {order.order_status}
                              </span>{' '}
                              &middot; {order.payment_status.replace('_', ' ')}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-semibold text-white tabular-nums">
                              {formatINR(order.total_inr)}
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCustomer(null);
                                onInspectOrder(order);
                              }}
                              className="text-xs text-amber-400 hover:text-amber-300 font-medium mt-1 cursor-pointer"
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
