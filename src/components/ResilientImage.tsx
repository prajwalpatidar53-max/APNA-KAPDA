import { useEffect, useMemo, useState } from 'react';
import { Shirt } from 'lucide-react';
import { resolveProductImageUrl } from '../utils/imageUrl';

interface ResilientImageProps {
  src: string;
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
}

export function ResilientImage({
  src,
  alt,
  className = '',
  loading = 'lazy',
}: ResilientImageProps) {
  const resolvedSrc = useMemo(() => resolveProductImageUrl(src), [src]);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [resolvedSrc]);

  if (hasError || !resolvedSrc) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#ede7db] to-[#dfd5c5] text-[#817b70] p-6 text-center ${className}`}
        role="img"
        aria-label={alt}
      >
        <Shirt className="w-8 h-8 mb-2 opacity-60 stroke-[1.25]" />
        <span className="text-[11px] tracking-[0.14em] uppercase font-medium text-[#5f594f] line-clamp-2">
          {alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      loading={loading}
      referrerPolicy="no-referrer"
      onError={() => {
        console.warn('[APNA KAPDA Image Load Failed]', {
          alt,
          attemptedSrc: resolvedSrc,
          originalSrc: src,
        });
        setHasError(true);
      }}
      className={className}
    />
  );
}
