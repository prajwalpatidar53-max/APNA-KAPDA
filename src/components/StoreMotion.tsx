import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

export const STORE_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const STORE_PAGE_VARIANTS = {
  initial: { opacity: 0, y: 12 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.32, ease: STORE_EASE },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.18, ease: STORE_EASE },
  },
};

interface RevealSectionProps {
  children: ReactNode;
  className?: string;
  delay?: number;
}

export function RevealSection({
  children,
  className = '',
  delay = 0,
}: RevealSectionProps) {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ duration: 0.48, delay, ease: STORE_EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
