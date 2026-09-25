import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Link previews (Open Graph / X cards): 1200x630, drawn with next/og in the site's own colours and
// display face. The font files live in web/assets (Baloo 2, OFL) because next/og needs the font bytes.

export const OG_SIZE = { width: 1200, height: 630 };

export const OG = {
  page: '#f7f1e6',
  sheet: '#fffcf7',
  ink: '#33302e',
  body: '#615a52',
  coral: '#e8836b',
  coralInk: '#c2614b',
  coralText: '#a94f3a',
  butter: '#fce9b8',
  sand: '#eee5d6',
  water: '#cfe3ef',
};

export async function ogFonts() {
  const [bold, semi] = await Promise.all([
    readFile(join(process.cwd(), 'assets/Baloo2-800.ttf')),
    readFile(join(process.cwd(), 'assets/Baloo2-600.ttf')),
  ]);
  return [
    { name: 'Baloo', data: bold, weight: 800 as const, style: 'normal' as const },
    { name: 'Baloo', data: semi, weight: 600 as const, style: 'normal' as const },
  ];
}

/** The clownfish from the site header. */
export function Fish({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round((size * 26) / 40)} viewBox="0 0 40 26">
      <path d="M3 13c6-11 22-11 28 0-6 11-22 11-28 0z" fill={OG.coral} stroke={OG.ink} strokeWidth="2.5" />
      <path d="M31 13l7-7v14z" fill={OG.coral} stroke={OG.ink} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M14 5.5c-2 4.5-2 10.5 0 15" fill="none" stroke="#fff" strokeWidth="2.5" />
      <circle cx="9" cy="11" r="1.8" fill={OG.ink} />
    </svg>
  );
}

/** The sea floor along the bottom edge, as on the home page. */
export function SeaFloor() {
  return (
    <svg width="1200" height="90" viewBox="0 0 1200 90" style={{ position: 'absolute', left: 0, bottom: 0 }}>
      <path d="M0 40 C 150 20, 250 60, 400 40 S 650 20, 800 40 S 1050 60, 1200 36 L1200 90 L0 90 Z" fill={OG.sand} />
      <path d="M86 44 C 80 24, 88 10, 96 4 C 92 18, 92 30, 98 42" fill="#d8eee4" stroke={OG.ink} strokeWidth="2" />
      <path d="M112 46 C 110 34, 116 26, 124 20 C 120 30, 120 38, 122 46" fill="#d8eee4" stroke={OG.ink} strokeWidth="2" />
      <path d="M1098 42 C 1094 24, 1102 12, 1112 4 C 1106 18, 1106 30, 1110 42" fill="#d8eee4" stroke={OG.ink} strokeWidth="2" />
    </svg>
  );
}

/** "Tiny Viewers" with the fish, top left. */
export function Brand({ size = 34 }: { size?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <Fish size={Math.round(size * 1.35)} />
      <div style={{ display: 'flex', fontSize: size, fontWeight: 800, color: OG.ink }}>Tiny Viewers</div>
    </div>
  );
}
