import { useMemo, useState } from 'react';
import { MapPin, Search, ShoppingBag, User, X } from 'lucide-react';
import { formatINR } from '../data/catalog';
import type { Order, UserProfile } from '../types';

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
      <div className="bg-[#fffdf8] border border-[#e5dfd3] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-[#817b70] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer name, email, phone..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
          />
        </div>
        <p className="text-[11px] text-[#817b70] tabular-nums">
          Registered profiles:{' '}
          <strong className="text-[#211f1b]">{filteredCustomers.length}</strong>
        </p>
      </div>

      {/* Customers Table */}
      <div className="bg-[#fffdf8] border border-[#e5dfd3] overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs text-[#817b70]">
            Loading customer directory...
          </div>
        ) : filteredCustomers.length === 0 ? (
          <div className="p-12 text-center">
            <p className="font-serif-display text-2xl text-[#211f1b]">
              No matching profiles
            </p>
            <p className="text-xs text-[#817b70] mt-1.5">
              Registered APNA KAPDA customers appear here automatically upon signup.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#e5dfd3] bg-[#f5f2eb]/50 text-[10px] tracking-[0.16em] uppercase text-[#817b70]">
                  <th className="py-3.5 px-4 font-semibold">Customer</th>
                  <th className="py-3.5 px-3 font-semibold">Phone</th>
                  <th className="py-3.5 px-3 font-semibold">City</th>
                  <th className="py-3.5 px-3 font-semibold">Role</th>
                  <th className="py-3.5 px-3 font-semibold">Joined</th>
                  <th className="py-3.5 px-3 font-semibold text-right">Orders</th>
                  <th className="py-3.5 px-4 font-semibold text-right">
                    Paid Spend
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5dfd3] text-xs">
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
                      className="hover:bg-[#f5f2eb]/50 transition-colors cursor-pointer"
                    >
                      <td className="py-3.5 px-4">
                        <p className="font-semibold text-[#211f1b]">
                          {customer.full_name || 'Unnamed Customer'}
                        </p>
                        <p className="text-[11px] text-[#817b70]">
                          {customer.email || '—'}
                        </p>
                      </td>
                      <td className="py-3.5 px-3 text-[#5f594f] tabular-nums whitespace-nowrap">
                        {customer.phone || '—'}
                      </td>
                      <td className="py-3.5 px-3 text-[#5f594f] whitespace-nowrap">
                        {customer.default_address?.city
                          ? `${customer.default_address.city}, ${customer.default_address.state}`
                          : '—'}
                      </td>
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 text-[10px] tracking-[0.12em] uppercase font-semibold border ${
                            customer.role === 'admin'
                              ? 'border-[#24231f] bg-[#24231f] text-white'
                              : 'border-[#e5dfd3] bg-[#f5f2eb] text-[#5f594f]'
                          }`}
                        >
                          {customer.role}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-[#5f594f] tabular-nums whitespace-nowrap">
                        {formatShortDate(customer.created_at)}
                      </td>
                      <td className="py-3.5 px-3 text-right font-semibold text-[#211f1b] tabular-nums">
                        {userOrders.length}
                      </td>
                      <td className="py-3.5 px-4 text-right font-semibold text-[#211f1b] tabular-nums whitespace-nowrap">
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
      {selectedCustomer && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex justify-end"
          onClick={() => setSelectedCustomer(null)}
        >
          <aside
            className="w-full max-w-xl bg-[#fffdf8] h-full overflow-y-auto border-l border-[#e5dfd3] shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-5 border-b border-[#e5dfd3] flex items-center justify-between sticky top-0 bg-[#fffdf8] z-10">
              <div>
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#9a6746] font-bold">
                  Customer Profile
                </p>
                <h3 className="font-serif-display text-2xl text-[#211f1b]">
                  {selectedCustomer.full_name || 'Customer Account'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                aria-label="Close customer profile"
                className="p-2 text-[#817b70] hover:text-[#211f1b] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="border border-[#e5dfd3] p-4">
                  <div className="flex items-center gap-2 text-[#9a6746] mb-2">
                    <User className="w-3.5 h-3.5" />
                    <span className="text-[10px] tracking-[0.16em] uppercase font-bold">
                      Contact Details
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-[#211f1b]">
                    {selectedCustomer.email || 'No email on profile'}
                  </p>
                  <p className="text-xs text-[#5f594f] mt-1 tabular-nums">
                    Phone: {selectedCustomer.phone || 'Not provided'}
                  </p>
                  <p className="text-[11px] text-[#817b70] mt-2 tabular-nums">
                    Joined {formatShortDate(selectedCustomer.created_at)}
                  </p>
                </div>

                <div className="border border-[#e5dfd3] p-4">
                  <div className="flex items-center gap-2 text-[#9a6746] mb-2">
                    <MapPin className="w-3.5 h-3.5" />
                    <span className="text-[10px] tracking-[0.16em] uppercase font-bold">
                      Default Address
                    </span>
                  </div>
                  {selectedCustomer.default_address?.line1 ? (
                    <p className="text-xs text-[#211f1b] leading-relaxed">
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
                    <p className="text-xs text-[#817b70]">
                      No saved shipping address yet.
                    </p>
                  )}
                </div>
              </div>

              <div className="border border-[#e5dfd3]">
                <div className="px-4 py-3 bg-[#f5f2eb]/60 border-b border-[#e5dfd3] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShoppingBag className="w-3.5 h-3.5 text-[#9a6746]" />
                    <span className="text-[10px] tracking-[0.16em] uppercase font-bold text-[#211f1b]">
                      Order History ({selectedCustomerOrders.length})
                    </span>
                  </div>
                </div>

                {selectedCustomerOrders.length === 0 ? (
                  <p className="p-6 text-center text-xs text-[#817b70]">
                    This customer has not placed any orders yet.
                  </p>
                ) : (
                  <div className="divide-y divide-[#e5dfd3]">
                    {selectedCustomerOrders.map((order) => (
                      <div
                        key={order.id}
                        className="p-4 flex items-center justify-between gap-4 hover:bg-[#f5f2eb]/50 transition-colors"
                      >
                        <div>
                          <p className="text-xs font-semibold text-[#211f1b] tabular-nums">
                            {order.order_number}
                          </p>
                          <p className="text-[11px] text-[#817b70] mt-0.5 tabular-nums">
                            {formatShortDate(order.created_at)} &middot;{' '}
                            <span className="capitalize">
                              {order.order_status}
                            </span>{' '}
                            &middot; {order.payment_status.replace('_', ' ')}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-semibold text-[#211f1b] tabular-nums">
                            {formatINR(order.total_inr)}
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCustomer(null);
                              onInspectOrder(order);
                            }}
                            className="text-[10px] tracking-[0.12em] uppercase text-[#9a6746] hover:text-[#211f1b] font-semibold mt-1 cursor-pointer"
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
          </aside>
        </div>
      )}
    </div>
  );
}
