interface Props {
  /** 0..5; halves are drawn. */
  rating: number;
  size?: number;
}

const STAR = "M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z";

export function Stars({ rating, size = 16 }: Props) {
  const r = Math.max(0, Math.min(5, Math.round(rating * 2) / 2));
  return (
    <span className="stars" role="img" aria-label={`${r} out of 5 stars`} title={`${rating.toFixed(1)} / 5`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = r >= i + 1 ? 1 : r >= i + 0.5 ? 0.5 : 0;
        const id = `half-${i}-${size}`;
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            {fill === 0.5 && (
              <defs>
                <linearGradient id={id}>
                  <stop offset="50%" stopColor="var(--star)" />
                  <stop offset="50%" stopColor="var(--star-empty)" />
                </linearGradient>
              </defs>
            )}
            <path d={STAR} fill={fill === 1 ? "var(--star)" : fill === 0.5 ? `url(#${id})` : "var(--star-empty)"} stroke="var(--star-edge)" strokeWidth="1" strokeLinejoin="round" />
          </svg>
        );
      })}
    </span>
  );
}
