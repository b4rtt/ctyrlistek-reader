/** App mark: a stylised four-leaf clover with a small play triangle. */
export function Logo({ size = 36 }: { size?: number }): React.JSX.Element {
  const leaf = 'M32 32c-9-2-17-9-15-17 2-6 9-7 13-2 1-1 2-2 2-2s1 1 2 2c4-5 11-4 13 2 2 8-6 15-15 17Z'
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Čtyřlístek Reader">
      <defs>
        <linearGradient id="lg-leaf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7ef0a6" />
          <stop offset="1" stopColor="#16a34a" />
        </linearGradient>
      </defs>
      {[0, 90, 180, 270].map((r) => (
        <path
          key={r}
          d={leaf}
          fill="url(#lg-leaf)"
          stroke="#0c1410"
          strokeWidth={1.6}
          strokeLinejoin="round"
          transform={`rotate(${r} 32 32)`}
        />
      ))}
      <circle cx="32" cy="32" r="9" fill="#0c1410" />
      <path d="M29.5 27.5v9l7-4.5-7-4.5Z" fill="#7ef0a6" />
    </svg>
  )
}
