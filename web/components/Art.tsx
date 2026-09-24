// The hand-drawn pieces, inline so they inherit the page's colours and scale with the type.
// Every one is decorative: aria-hidden, focusable={false}, and never the only carrier of meaning.

type ArtProps = { className?: string };

/** The clownfish in the wordmark. Thick ink outline, white stripe, coral body. */
export function LogoFish({ className }: ArtProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 132 84"
      width="46"
      height="30"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M10 44C24 18 62 8 88 20c10 4.6 18 12 23 22-5 10-13 17.4-23 22-26 12-64 2-78-20z"
        fill="var(--coral)"
      />
      <path d="M112 42l16-15v32z" fill="var(--blush)" />
      <path d="M48 18c-5 17-5 33 1 45" stroke="var(--sheet)" strokeWidth="9" />
      <path d="M48 18c-5 17-5 33 1 45" strokeWidth="2.2" />
      <circle cx="28" cy="37" r="3.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** A bigger clownfish, mirrored, for the corner of the Home artwork. */
export function Clownfish({ className }: ArtProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 132 84"
      width="132"
      height="84"
      fill="none"
      stroke="var(--ink)"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M10 44C24 18 62 8 88 20c10 4.6 18 12 23 22-5 10-13 17.4-23 22-26 12-64 2-78-20z"
        fill="var(--coral)"
      />
      <path d="M112 42l16-15v32z" fill="var(--blush)" />
      <path d="M48 18c-5 17-5 33 1 45" stroke="var(--sheet)" strokeWidth="9" />
      <path d="M48 18c-5 17-5 33 1 45" strokeWidth="2.2" />
      <path d="M74 16c-4 16-4 32 1 43" stroke="var(--sheet)" strokeWidth="7" />
      <path d="M74 16c-4 16-4 32 1 43" strokeWidth="2" />
      <circle cx="28" cy="37" r="3.6" fill="var(--ink)" stroke="none" />
    </svg>
  );
}

/** The fishing lure: a line, a bulb and its glow. Hangs beside the peek card. */
export function Lure({ className }: ArtProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 150 230"
      width="150"
      height="230"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M96 0c2 40-40 48-44 88-3 28 14 44 34 50"
        stroke="var(--ink)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="52" cy="112" r="17" fill="var(--butter)" stroke="var(--ink)" strokeWidth="2.6" />
      <path
        d="M52 82v-9M28 92l-7-6M76 92l7-6M26 124l-8 5M78 124l8 5"
        stroke="var(--coral)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The wobbly shark fin cutting through a wave: the underline for the second headline line. */
export function FinUnderline({ className }: ArtProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 430 40"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M6 26q22-12 44 0t44 0 44 0 44 0 44 0 44 0 44 0 44 0 44 0"
        stroke="var(--sky)"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M236 24c3-19 13-32 31-40-3 16 2 29 12 40z"
        fill="#87867f"
        stroke="var(--ink)"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path
        d="M300 22c8 4 14 4 22 0M196 22c-8 4-14 4-22 0"
        stroke="var(--ink)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Bubbles and weed on the sea floor, sat behind the bottom of the page. */
export function SeaFloor({ className }: ArtProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 1440 150"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M0 92q60-26 120 0t120 0 120 0 120 0 120 0 120 0 120 0 120 0 120 0 120 0 120 0 120 0v58H0z"
        fill="var(--sand)"
      />
      <path
        d="M186 92c-10-30 6-46 2-66-14 20-24 40-18 66"
        fill="var(--mint)"
        stroke="var(--ink)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M214 92c-6-22 10-34 8-50-12 14-20 30-16 50"
        fill="var(--mint)"
        stroke="var(--ink)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M1262 92c-12-34 8-52 4-76-16 24-28 46-22 76"
        fill="var(--mint)"
        stroke="var(--ink)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="1180" cy="60" r="9" fill="none" stroke="var(--dust)" strokeWidth="2" />
      <circle cx="1212" cy="34" r="5.5" fill="none" stroke="var(--dust)" strokeWidth="2" />
      <circle cx="96" cy="46" r="7" fill="none" stroke="var(--dust)" strokeWidth="2" />
    </svg>
  );
}

/** A few free-floating bubbles, for the 404 card. */
export function Bubbles({ className }: ArtProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 150 120"
      width="150"
      height="120"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M14 104c-14-40 8-62 4-92-20 30-34 56-26 92"
        fill="var(--mint)"
        stroke="var(--ink)"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="M52 104c-10-30 8-46 6-68-16 22-26 42-20 68"
        fill="var(--mint)"
        stroke="var(--ink)"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <circle cx="104" cy="44" r="10" fill="none" stroke="var(--dust)" strokeWidth="2.2" />
      <circle cx="128" cy="76" r="6" fill="none" stroke="var(--dust)" strokeWidth="2.2" />
      <circle cx="92" cy="14" r="4.5" fill="none" stroke="var(--dust)" strokeWidth="2.2" />
    </svg>
  );
}

/** The hand-drawn arrow that points at the peek card. */
export function CurvedArrow({ className }: ArtProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 64"
      width="112"
      height="60"
      fill="none"
      stroke="var(--coral-ink)"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M112 56C80 52 48 38 28 10" />
      <path d="M44 8L24 6l4 20" />
    </svg>
  );
}

/** A small wave rule, used either side of a quiet line. */
export function WaveRule({ className }: ArtProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 90 11"
      width="80"
      height="11"
      fill="none"
      stroke="var(--hairline)"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 6q7.5-6 15 0t15 0 15 0 15 0 15 0" />
    </svg>
  );
}

export function SearchIcon({ className }: ArtProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="11" cy="11" r="6.6" />
      <path d="M16 16l4.6 4.6" />
    </svg>
  );
}

export function ArrowRight({ className }: ArtProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="21"
      height="21"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

export function Chevron({ className, up = false }: ArtProps & { up?: boolean }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={up ? 'M6 14l6-6 6 6' : 'M6 10l6 6 6-6'} />
    </svg>
  );
}

export function FilterIcon({ className }: ArtProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.6 6.4h16.8M6.6 12h10.8M9.6 17.6h4.8" />
    </svg>
  );
}
