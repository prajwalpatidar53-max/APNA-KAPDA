import { useState } from 'react';
import { Ruler, X } from 'lucide-react';
import { BOTTOMS_SIZE_CHART, TOPS_SIZE_CHART } from '../data/catalog';

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

  if (!open) return null;

  const formatMeasure = (inches: number) => {
    if (unit === 'in') return `${inches.toFixed(1)}"`;
    return `${Math.round(inches * 2.54)} cm`;
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="APNA KAPDA Size Guide"
    >
      <div
        className="w-full max-w-2xl bg-[#fffdf8] border border-[#e5dfd3] p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 pb-5 border-b border-[#e5dfd3]">
          <div>
            <p className="text-[10px] tracking-[0.28em] uppercase text-[#9a6746] font-bold flex items-center gap-2">
              <Ruler className="w-3.5 h-3.5" />
              <span>Fit &amp; Measurements</span>
            </p>
            <h2 className="font-serif-display text-2xl sm:text-3xl text-[#211f1b] mt-1.5">
              APNA KAPDA Size Guide
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close size guide"
            className="p-1.5 text-[#817b70] hover:text-[#211f1b] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Category & Unit Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 my-5">
          <div className="inline-flex border border-[#e5dfd3] p-1 bg-[#f5f2eb]">
            <button
              type="button"
              onClick={() => setTab('tops')}
              className={`px-4 py-1.5 text-[10px] tracking-[0.14em] uppercase transition-colors ${
                tab === 'tops' ? 'bg-[#24231f] text-white' : 'text-[#211f1b]'
              }`}
            >
              Tops, Shirts &amp; Dresses
            </button>
            <button
              type="button"
              onClick={() => setTab('bottoms')}
              className={`px-4 py-1.5 text-[10px] tracking-[0.14em] uppercase transition-colors ${
                tab === 'bottoms' ? 'bg-[#24231f] text-white' : 'text-[#211f1b]'
              }`}
            >
              Trousers &amp; Denim
            </button>
          </div>

          <div className="inline-flex border border-[#e5dfd3] p-1 bg-[#f5f2eb]">
            <button
              type="button"
              onClick={() => setUnit('in')}
              className={`px-3 py-1.5 text-[10px] tracking-[0.14em] uppercase transition-colors ${
                unit === 'in' ? 'bg-[#9a6746] text-white' : 'text-[#211f1b]'
              }`}
            >
              Inches
            </button>
            <button
              type="button"
              onClick={() => setUnit('cm')}
              className={`px-3 py-1.5 text-[10px] tracking-[0.14em] uppercase transition-colors ${
                unit === 'cm' ? 'bg-[#9a6746] text-white' : 'text-[#211f1b]'
              }`}
            >
              CM
            </button>
          </div>
        </div>

        {/* Measurement Table */}
        <div className="overflow-x-auto border border-[#e5dfd3]">
          {tab === 'tops' ? (
            <table className="w-full text-left text-xs tabular-nums">
              <thead className="bg-[#f5f2eb] text-[#211f1b] border-b border-[#e5dfd3] text-[10px] tracking-[0.14em] uppercase">
                <tr>
                  <th className="py-3 px-4 font-semibold">Size</th>
                  <th className="py-3 px-4 font-semibold">Chest</th>
                  <th className="py-3 px-4 font-semibold">Waist</th>
                  <th className="py-3 px-4 font-semibold">Shoulder</th>
                  <th className="py-3 px-4 font-semibold">Garment Length</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5dfd3]">
                {TOPS_SIZE_CHART.map((row) => (
                  <tr key={row.size} className="hover:bg-[#f5f2eb]/50">
                    <td className="py-3 px-4 font-semibold text-[#211f1b]">{row.size}</td>
                    <td className="py-3 px-4 text-[#5f594f]">{formatMeasure(row.chestIn)}</td>
                    <td className="py-3 px-4 text-[#5f594f]">{formatMeasure(row.waistIn)}</td>
                    <td className="py-3 px-4 text-[#5f594f]">{formatMeasure(row.shoulderIn)}</td>
                    <td className="py-3 px-4 text-[#5f594f]">{formatMeasure(row.lengthIn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left text-xs tabular-nums">
              <thead className="bg-[#f5f2eb] text-[#211f1b] border-b border-[#e5dfd3] text-[10px] tracking-[0.14em] uppercase">
                <tr>
                  <th className="py-3 px-4 font-semibold">Size</th>
                  <th className="py-3 px-4 font-semibold">Indian Waist</th>
                  <th className="py-3 px-4 font-semibold">Garment Waist</th>
                  <th className="py-3 px-4 font-semibold">Hip</th>
                  <th className="py-3 px-4 font-semibold">Inseam</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5dfd3]">
                {BOTTOMS_SIZE_CHART.map((row) => (
                  <tr key={row.size} className="hover:bg-[#f5f2eb]/50">
                    <td className="py-3 px-4 font-semibold text-[#211f1b]">{row.size}</td>
                    <td className="py-3 px-4 text-[#5f594f]">{row.indianWaist}</td>
                    <td className="py-3 px-4 text-[#5f594f]">{formatMeasure(row.waistIn)}</td>
                    <td className="py-3 px-4 text-[#5f594f]">{formatMeasure(row.hipIn)}</td>
                    <td className="py-3 px-4 text-[#5f594f]">{formatMeasure(row.inseamIn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-5 p-4 bg-[#f5f2eb] border border-[#e5dfd3] text-xs text-[#69645b] leading-relaxed">
          <strong className="text-[#211f1b] font-semibold">Fit Guidance:</strong> Our
          oversized tees and unisex layers are designed with a relaxed shoulder drop.
          Choose your regular Indian size for the intended effortless drape, or size
          down one step for a closer tailored fit.
        </div>
      </div>
    </div>
  );
}
