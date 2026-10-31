// The TownAnt assistant mark: a conversation bubble holding a location pin — "ask about local
// services". Original geometric vector drawn on the 24 px Lucide grid with matching 1.75 strokes,
// so it sits naturally beside the interface icons. Strokes use currentColor; the pin's dot takes
// `accent` (amber by default) so it reads on light and dark surfaces.
export function AssistantMark({ size = 24, accent = '#F5A623', title, className, strokeWidth = 1.75 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d="M6.5 3.75h11a3 3 0 0 1 3 3v7.5a3 3 0 0 1-3 3h-5l-4.25 3.25v-3.25H6.5a3 3 0 0 1-3-3v-7.5a3 3 0 0 1 3-3Z" />
      <path d="M12 6.9a2.85 2.85 0 0 0-2.85 2.85c0 2.05 2.85 4.5 2.85 4.5s2.85-2.45 2.85-4.5A2.85 2.85 0 0 0 12 6.9Z" />
      <circle cx="12" cy="9.75" r="0.95" fill={accent} stroke="none" />
    </svg>
  );
}

// The mark on its navy badge, used for the launcher, panel header and homepage label.
export function AssistantBadge({ size = 36, className = '' }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-navy text-white ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <AssistantMark size={Math.round(size * 0.56)} />
    </span>
  );
}
