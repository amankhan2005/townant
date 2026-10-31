export function LogoMark({ className = 'size-8' }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="50" rx="26" ry="7" fill="none" stroke="#F5A623" strokeWidth="4" />
      <path d="M24 9 20 3M40 9l4-6" stroke="#147D73" strokeWidth="3" strokeLinecap="round" />
      <circle cx="20" cy="3" r="2.5" fill="#147D73" />
      <circle cx="44" cy="3" r="2.5" fill="#147D73" />
      <path d="M32 8c-11 0-19 8-19 18 0 13 19 30 19 30s19-17 19-30C51 16 43 8 32 8z" fill="#147D73" />
      <path d="M22 28l10-9 10 9v10H22z" fill="#fff" />
      <rect x="29" y="29" width="6" height="6" rx="1" fill="#14243A" />
    </svg>
  );
}

export function Logo({ suffix, inverted = false }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark />
      <span className={`text-xl font-extrabold tracking-tight ${inverted ? 'text-white' : 'text-navy'}`}>
        {/* Brand teal on light surfaces; the lighter teal keeps 5.6:1 contrast on dark navigation. */}
        Town<span className={inverted ? 'text-teal-300' : 'text-teal'}>Ant</span>
        {suffix && <span className={`ml-1.5 text-sm font-semibold ${inverted ? 'text-white/70' : 'text-muted'}`}>{suffix}</span>}
      </span>
    </span>
  );
}
