function SkeletonText({ width = '100%', height = '1rem' }: { width?: string; height?: string }) {
  return (
    <div
      className="skeleton-shimmer rounded bg-bg-2"
      style={{ width, height }}
    />
  )
}

function SkeletonCard() {
  return (
    <div className="space-y-2">
      <div className="skeleton-shimmer aspect-[2/3] rounded-card bg-bg-2" />
      <SkeletonText width="80%" height="0.875rem" />
      <SkeletonText width="50%" height="0.75rem" />
    </div>
  )
}

function SkeletonGrid({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}

export { SkeletonCard, SkeletonText, SkeletonGrid }
