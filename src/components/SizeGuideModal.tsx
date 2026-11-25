import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Ruler, X } from 'lucide-react';
import { BOTTOMS_SIZE_CHART, TOPS_SIZE_CHART } from '../data/catalog';
import { STORE_EASE } from './StoreMotion';

interface SizeGuideModalProps {
  open: boolean;
  onClose: () => void;
  defaultTab?: 'tops' | 'bottoms';
}

export function SizeGuideModal({
  open,
  onClose,
  defaultTab = 'tops',
}: SizeGuideModalProps) {
  const [unit, setUnit] = useState<'in' | 'cm'>('in');
  const [tab, setTab] = useState<'tops' | 'bottoms'>(defaultTab);

  const formatMeasure = (inches: number) => {
    if (unit === 'in') return `${inches.toFixed(1)}"`;
    return `${Math.round(inches * 2.54)} cm`;
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="APNA KAPDA Size Guide"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.24, ease: STORE_EASE }}
            className="w-full max-w-2xl rounded-[28px] bg-[#fffdf9] border border-[#e8e1d5] p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 pb-5 border-b border-[#ece5d9]">
              <div>
                <p className="text-[10px] tracking-[0.26em] uppercase text-[#8d5b3c] font-bold flex items-center gap-2">
                  <Ruler className="w-3.5 h-3.5" />
                  <span>Fit &amp; Measurements</span>
                </p>
                <h2 className="font-serif-display text-2xl sm:text-3xl text-[#1f1d1a] mt-1.5">
                  APNA KAPDA Size Guide
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close size guide"
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#7c756b] hover:text-[#1f1d1a] hover:bg-[#f2ece0] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Category & Unit Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 my-5">
              <div className="inline-flex rounded-full border border-[#e5ddd0] p-1 bg-[#f8f4ed]">
                <button
                  type="button"
                  onClick={() => setTab('tops')}
                  className={`px-4 py-1.5 rounded-full text-[10px] tracking-[0.12em] uppercase font-medium transition-colors cursor-pointer ${
                    tab === 'tops'
                      ? 'bg-[#1f1d1a] text-white'
                      : 'text-[#1f1d1a] hover:text-[#8d5b3c]'
                  }`}
                >
                  Tops, Shirts &amp; Dresses
                </button>
                <button
                  type="button"
                  onClick={() => setTab('bottoms')}
                  className={`px-4 py-1.5 rounded-full text-[10px] tracking-[0.12em] uppercase font-medium transition-colors cursor-pointer ${
                    tab === 'bottoms'
                      ? 'bg-[#1f1d1a] text-white'
                      : 'text-[#1f1d1a] hover:text-[#8d5b3c]'
                  }`}
                >
                  Trousers &amp; Denim
                </button>
              </div>

              <div className="inline-flex rounded-full border border-[#e5ddd0] p-1 bg-[#f8f4ed]">
                <button
                  type="button"
                  onClick={() => setUnit('in')}
                  className={`px-3.5 py-1.5 rounded-full text-[10px] tracking-[0.12em] uppercase font-medium transition-colors cursor-pointer ${
                    unit === 'in'
                      ? 'bg-[#8d5b3c] text-white'
                      : 'text-[#1f1d1a] hover:text-[#8d5b3c]'
                  }`}
                >
                  Inches
                </button>
                <button
                  type="button"
                  onClick={() => setUnit('cm')}
                  className={`px-3.5 py-1.5 rounded-full text-[10px] tracking-[0.12em] uppercase font-medium transition-colors cursor-pointer ${
                    unit === 'cm'
                      ? 'bg-[#8d5b3c] text-white'
                      : 'text-[#1f1d1a] hover:text-[#8d5b3c]'
                  }`}
                >
                  CM
                </button>
              </div>
            </div>

            {/* Measurement Table */}
            <div className="overflow-x-auto rounded-2xl border border-[#e8e1d5]">
              {tab === 'tops' ? (
                <table className="w-full text-left text-xs tabular-nums">
                  <thead className="bg-[#f8f4ed] text-[#1f1d1a] border-b border-[#e8e1d5] text-[10px] tracking-[0.14em] uppercase">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Size</th>
                      <th className="py-3 px-4 font-semibold">Chest</th>
                      <th className="py-3 px-4 font-semibold">Waist</th>
                      <th className="py-3 px-4 font-semibold">Shoulder</th>
                      <th className="py-3 px-4 font-semibold">Garment Length</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ece5d9]">
                    {TOPS_SIZE_CHART.map((row) => (
                      <tr key={row.size} className="hover:bg-[#faf7f2]">
                        <td className="py-3 px-4 font-semibold text-[#1f1d1a]">
                          {row.size}
                        </td>
                        <td className="py-3 px-4 text-[#5d564c]">
                          {formatMeasure(row.chestIn)}
                        </td>
                        <td className="py-3 px-4 text-[#5d564c]">
                          {formatMeasure(row.waistIn)}
                        </td>
                        <td className="py-3 px-4 text-[#5d564c]">
                          {formatMeasure(row.shoulderIn)}
                        </td>
                        <td className="py-3 px-4 text-[#5d564c]">
                          {formatMeasure(row.lengthIn)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-left text-xs tabular-nums">
                  <thead className="bg-[#f8f4ed] text-[#1f1d1a] border-b border-[#e8e1d5] text-[10px] tracking-[0.14em] uppercase">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Size</th>
                      <th className="py-3 px-4 font-semibold">Indian Waist</th>
                      <th className="py-3 px-4 font-semibold">Garment Waist</th>
                      <th className="py-3 px-4 font-semibold">Hip</th>
                      <th className="py-3 px-4 font-semibold">Inseam</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ece5d9]">
                    {BOTTOMS_SIZE_CHART.map((row) => (
                      <tr key={row.size} className="hover:bg-[#faf7f2]">
                        <td className="py-3 px-4 font-semibold text-[#1f1d1a]">
                          {row.size}
                        </td>
                        <td className="py-3 px-4 text-[#5d564c]">
                          {row.indianWaist}
                        </td>
                        <td className="py-3 px-4 text-[#5d564c]">
                          {formatMeasure(row.waistIn)}
                        </td>
                        <td className="py-3 px-4 text-[#5d564c]">
                          {formatMeasure(row.hipIn)}
                        </td>
                        <td className="py-3 px-4 text-[#5d564c]">
                          {formatMeasure(row.inseamIn)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="mt-5 p-4 rounded-2xl bg-[#f8f4ed] border border-[#e8e1d5] text-xs text-[#645d53] leading-relaxed">
              <strong className="text-[#1f1d1a] font-semibold">Fit Guidance:</strong>{' '}
              Our oversized tees and unisex layers are designed with a relaxed
              shoulder drop. Choose your regular Indian size for the intended
              effortless drape, or size down one step for a closer tailored fit.
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
