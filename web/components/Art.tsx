// The hand-drawn pieces, inline so they inherit the page's colours and scale with the type.
// Every one is decorative: aria-hidden, focusable={false}, and never the only carrier of meaning.

import { useId } from 'react';
import art from './Art.module.css';

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

/**
 * The shark fin lurking behind a wave: the underline for the second headline line. Home only.
 *
 * Paint order is fin, ripples, wave, so the wave line is drawn over the fin. The fin sits in a group
 * clipped at the waterline (y 27.5, just under the wave's lowest point), so whatever part of it
 * drops below the surface is simply not drawn. The design did this with a page-coloured cover
 * rect; a clip does the same without depending on the colour behind it and without a 50px rect
 * spilling out of the SVG over the search field under it.
 *
 * On Home the fin rises, rocks while it cruises, and sinks again; the two ripple strokes fade in
 * and out with it (Art.module.css). Under prefers-reduced-motion none of that runs and this is the
 * drawing as it stands: fin up, ripples showing.
 */
export function FinUnderline({ className }: ArtProps) {
  // SVG ids are document-wide, so the clip gets a per-instance id. React's id is stable across the
  // server render and hydration; the replace keeps it to plain id characters so url(#…) resolves.
  const clipId = `tv-fin-waterline${useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg
      className={className}
      viewBox="0 0 430 40"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <rect x="-40" y="-80" width="510" height="107.5" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <path
          className={art.finBody}
          d="M236 24c3-19 13-32 31-40-3 16 2 29 12 40z"
          fill="#87867f"
          stroke="var(--ink)"
          strokeWidth="2.6"
          strokeLinejoin="round"
        />
      </g>
      <path
        className={art.finRipple}
        d="M300 22c8 4 14 4 22 0M196 22c-8 4-14 4-22 0"
        stroke="var(--ink)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M6 26q22-12 44 0t44 0 44 0 44 0 44 0 44 0 44 0 44 0 44 0"
        stroke="var(--sky)"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Bubbles and weed on the sea floor, sat behind the bottom of the page. Home only. The three blades
 * sway from their bases and the bubbles rise and fade, on staggered clocks (Art.module.css); under
 * prefers-reduced-motion it is the still drawing.
 *
 * Three layers in one box, all in the same 1440x150 drawing units. The sand stretches to whatever
 * width the page is. The weed and bubbles at each end are their own SVGs that scale evenly with the
 * box's height and keep their place as a share of the width: on a laptop that is the drawing as
 * designed, and on a phone the blades and bubbles keep their shape instead of being squeezed to a
 * quarter of their width with the sand.
 */
export function SeaFloor({ className }: ArtProps) {
  return (
    <div className={`${art.sea} ${className ?? ''}`} aria-hidden="true">
      <svg
        className={art.sand}
        viewBox="0 0 1440 150"
        preserveAspectRatio="none"
        fill="none"
        focusable="false"
      >
        <path
          d="M0 92q60-26 120 0t120 0 120 0 120 0 120 0 120 0 120 0 120 0 120 0 120 0 120 0 120 0v58H0z"
          fill="var(--sand)"
        />
      </svg>
      {/* x 80-230: two blades and a bubble at the left end. */}
      <svg className={art.seaLeft} viewBox="80 0 150 150" fill="none" focusable="false">
        <path
          className={art.weed}
          d="M186 92c-10-30 6-46 2-66-14 20-24 40-18 66"
          fill="var(--mint)"
          stroke="var(--ink)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          className={`${art.weed} ${art.later}`}
          d="M214 92c-6-22 10-34 8-50-12 14-20 30-16 50"
          fill="var(--mint)"
          stroke="var(--ink)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <circle
          className={`${art.bubble} ${art.latest}`}
          cx="96"
          cy="46"
          r="7"
          fill="none"
          stroke="var(--dust)"
          strokeWidth="2"
        />
      </svg>
      {/* x 1160-1285: a blade and two bubbles at the right end. */}
      <svg className={art.seaRight} viewBox="1160 0 125 150" fill="none" focusable="false">
        <path
          className={`${art.weed} ${art.latest}`}
          d="M1262 92c-12-34 8-52 4-76-16 24-28 46-22 76"
          fill="var(--mint)"
          stroke="var(--ink)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <circle className={art.bubble} cx="1180" cy="60" r="9" fill="none" stroke="var(--dust)" strokeWidth="2" />
        <circle
          className={`${art.bubble} ${art.later}`}
          cx="1212"
          cy="34"
          r="5.5"
          fill="none"
          stroke="var(--dust)"
          strokeWidth="2"
        />
      </svg>
    </div>
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
