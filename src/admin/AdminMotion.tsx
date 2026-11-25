import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { formatINR } from '../data/catalog';
import type { OrderStatus, PaymentStatus } from '../types';

export const ADMIN_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const ADMIN_PAGE_VARIANTS = {
  initial: { opacity: 0, y: 10 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.28, ease: ADMIN_EASE },
  },
  exit: {
    opacity: 0,
    y: -6,
    transition: { duration: 0.16, ease: ADMIN_EASE },
  },
};

interface AnimatedCounterProps {
  value: number;
  format?: 'inr' | 'integer' | 'percent';
  durationMs?: number;
  className?: string;
}

export function AnimatedCounter({
  value,
  format = 'integer',
  durationMs = 680,
  className = '',
}: AnimatedCounterProps) {
  const prefersReducedMotion = useReducedMotion();
  const [displayValue, setDisplayValue] = useState<number>(() =>
    prefersReducedMotion ? value : 0
  );
  const prevValueRef = useRef<number>(prefersReducedMotion ? value : 0);

  useEffect(() => {
    const safeTarget = Number.isFinite(value) ? value : 0;

    if (prefersReducedMotion) {
      prevValueRef.current = safeTarget;
      setDisplayValue(safeTarget);
      return;
    }

    const startVal = prevValueRef.current;
    const diff = safeTarget - startVal;

    if (diff === 0) {
      setDisplayValue(safeTarget);
      return;
    }

    let frameId = 0;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      // Cubic ease-out for crisp, smooth settling on mid-range mobile devices
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = startVal + diff * eased;

      setDisplayValue(progress < 1 ? Math.round(current) : safeTarget);

      if (progress < 1) {
        frameId = requestAnimationFrame(tick);
      } else {
        prevValueRef.current = safeTarget;
      }
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [value, durationMs, prefersReducedMotion]);

  const formatted =
    format === 'inr'
      ? formatINR(displayValue)
      : format === 'percent'
        ? `${displayValue}%`
        : new Intl.NumberFormat('en-IN').format(displayValue);

  return <span className={`tabular-nums ${className}`}>{formatted}</span>;
}

export function orderStatusBadgeV2(status: OrderStatus): string {
  switch (status) {
    case 'delivered':
      return 'bg-emerald-500/12 text-emerald-300 border-emerald-500/25';
    case 'cancelled':
      return 'bg-rose-500/12 text-rose-300 border-rose-500/25';
    case 'shipped':
      return 'bg-teal-500/12 text-teal-300 border-teal-500/25';
    case 'packed':
      return 'bg-amber-500/14 text-amber-300 border-amber-500/30';
    case 'confirmed':
      return 'bg-sky-500/12 text-sky-300 border-sky-500/25';
    default:
      return 'bg-slate-500/15 text-slate-300 border-slate-500/25';
  }
}

export function paymentStatusBadgeV2(status: PaymentStatus): string {
  switch (status) {
    case 'paid':
    case 'refunded':
      return 'bg-emerald-500/12 text-emerald-300 border-emerald-500/25';
    case 'refund_pending':
      return 'bg-amber-500/14 text-amber-300 border-amber-500/30';
    case 'failed':
    case 'cancelled':
      return 'bg-rose-500/12 text-rose-300 border-rose-500/25';
    case 'cod_due':
      return 'bg-orange-500/12 text-orange-300 border-orange-500/25';
    default:
      return 'bg-slate-500/15 text-slate-300 border-slate-500/25';
  }
}

export function AdminTableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="p-5 space-y-3" aria-busy="true" aria-label="Loading records">
      {Array.from({ length: rows }).map((_, idx) => (
        <div
          key={idx}
          className="h-12 rounded-xl bg-white/[0.03] border border-white/[0.05] animate-pulse"
        />
      ))}
    </div>
  );
}

export function AdminDashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div
            key={idx}
            className="h-36 rounded-2xl bg-[#111924]/80 border border-white/[0.07] p-5 animate-pulse flex flex-col justify-between"
          >
            <div className="flex items-center justify-between">
              <div className="h-3.5 w-24 rounded bg-white/[0.08]" />
              <div className="h-8 w-8 rounded-xl bg-white/[0.06]" />
            </div>
            <div className="space-y-2">
              <div className="h-8 w-32 rounded bg-white/[0.1]" />
              <div className="h-3 w-40 rounded bg-white/[0.05]" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8 h-80 rounded-2xl bg-[#111924]/80 border border-white/[0.07] p-6 animate-pulse" />
        <div className="lg:col-span-4 h-80 rounded-2xl bg-[#111924]/80 border border-white/[0.07] p-6 animate-pulse" />
      </div>

      <div className="h-64 rounded-2xl bg-[#111924]/80 border border-white/[0.07] p-6 animate-pulse" />
    </div>
  );
}
