import React from "react";

interface SkeletonCardProps {
  /** Height of the thumbnail placeholder */
  imageHeight?: string;
  /** Show category pill placeholders */
  showPills?: boolean;
  /** Number of text line placeholders */
  lines?: number;
}

/**
 * Shimmer skeleton card for masonry grids (Websites, Media, Memes).
 * Uses CSS animate-pulse with staggered widths for a natural feel.
 */
export const SkeletonCard: React.FC<SkeletonCardProps> = ({
  imageHeight = "h-32",
  showPills = true,
  lines = 2,
}) => (
  <div className="break-inside-avoid mb-4">
    <div className="overflow-hidden rounded-xl bg-surface-2 border border-border-default">
      <div className={`${imageHeight} w-full animate-pulse bg-surface-3`} />
      <div className="p-3 space-y-2">
        <div className="h-4 w-3/4 animate-pulse rounded bg-surface-3" />
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="h-3 animate-pulse rounded bg-surface-3"
            style={{ width: `${70 - i * 15}%` }}
          />
        ))}
        {showPills && (
          <div className="flex gap-1 pt-1">
            <div className="h-5 w-14 animate-pulse rounded-full bg-surface-3" />
            <div className="h-5 w-10 animate-pulse rounded-full bg-surface-3" />
          </div>
        )}
      </div>
    </div>
  </div>
);

/**
 * Grid of skeleton cards for loading states.
 */
export const SkeletonGrid: React.FC<{
  count?: number;
  columns?: string;
  heights?: string[];
}> = ({
  count = 8,
  columns = "columns-1 sm:columns-2 md:columns-3 lg:columns-4",
  heights,
}) => {
  const defaultHeights = ["h-32", "h-44", "h-36", "h-52", "h-40", "h-48"];
  const hs = heights ?? defaultHeights;
  return (
    <div className={`${columns} gap-4`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} imageHeight={hs[i % hs.length]} />
      ))}
    </div>
  );
};
