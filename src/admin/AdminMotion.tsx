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
  durationMs = 660,
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
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'cancelled':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'shipped':
      return 'bg-cyan-50 text-cyan-800 border-cyan-200';
    case 'packed':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'confirmed':
      return 'bg-sky-50 text-sky-800 border-sky-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

export function paymentStatusBadgeV2(status: PaymentStatus): string {
  switch (status) {
    case 'paid':
    case 'refunded':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'refund_pending':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'failed':
    case 'cancelled':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'cod_due':
      return 'bg-orange-50 text-orange-800 border-orange-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

export function AdminTableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="p-5 space-y-3" aria-busy="true" aria-label="Loading records">
      {Array.from({ length: rows }).map((_, idx) => (
        <div
          key={idx}
          className="h-12 rounded-xl bg-slate-200/60 border border-white animate-pulse"
        />
      ))}
    </div>
  );
}

export function AdminDashboardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div
            key={idx}
            className="h-36 rounded-2xl bg-white/80 border border-white p-5 animate-pulse flex flex-col justify-between shadow-xs"
          >
            <div className="flex items-center justify-between">
              <div className="h-8 w-8 rounded-full bg-slate-200/80" />
              <div className="h-4 w-12 rounded bg-slate-200/70" />
            </div>
            <div className="space-y-2">
              <div className="h-7 w-28 rounded bg-slate-200/90" />
              <div className="h-3 w-36 rounded bg-slate-200/60" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8 h-80 rounded-2xl bg-white/80 border border-white p-6 animate-pulse" />
        <div className="lg:col-span-4 h-80 rounded-2xl bg-white/80 border border-white p-6 animate-pulse" />
      </div>

      <div className="h-64 rounded-2xl bg-white/80 border border-white p-6 animate-pulse" />
    </div>
  );
}
