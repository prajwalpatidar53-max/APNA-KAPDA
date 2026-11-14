import { useState } from 'react';
import { Shirt } from 'lucide-react';

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
  const [hasError, setHasError] = useState(false);

  if (hasError || !src) {
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
      src={src}
      alt={alt}
      loading={loading}
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={className}
    />
  );
}
