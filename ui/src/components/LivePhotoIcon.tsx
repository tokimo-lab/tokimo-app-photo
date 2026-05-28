/**
 * Apple-style Live Photo icon — concentric circles with dotted ring.
 * Based on the standard Apple Live Photo indicator.
 */
export function LivePhotoIcon({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const r = size / 2;
  const outerR = r * 0.88;
  const dotCount = 18;
  const dotR = r * 0.06;

  const dots: Array<{ cx: number; cy: number }> = [];
  for (let i = 0; i < dotCount; i++) {
    const angle = (2 * Math.PI * i) / dotCount - Math.PI / 2;
    dots.push({
      cx: r + outerR * Math.cos(angle),
      cy: r + outerR * Math.sin(angle),
    });
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="currentColor"
      className={className}
    >
      {/* Outer dotted ring */}
      {dots.map((d) => (
        <circle
          key={`${d.cx.toFixed(2)}-${d.cy.toFixed(2)}`}
          cx={d.cx}
          cy={d.cy}
          r={dotR}
        />
      ))}
      {/* Inner ring */}
      <circle
        cx={r}
        cy={r}
        r={r * 0.52}
        fill="none"
        stroke="currentColor"
        strokeWidth={r * 0.16}
      />
      {/* Center dot */}
      <circle cx={r} cy={r} r={r * 0.2} />
    </svg>
  );
}
