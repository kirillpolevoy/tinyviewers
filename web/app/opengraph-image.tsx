import { ImageResponse } from 'next/og';
import { Brand, OG, OG_SIZE, SeaFloor, ogFonts } from '@/lib/og';

// The site's link preview: the home page's promise, in its own type and colours.

export const alt = 'Tiny Viewers: every kids’ movie has that scene. We’ll tell you when.';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          background: OG.page,
          padding: '56px 72px',
          fontFamily: 'Baloo',
          color: OG.ink,
        }}
      >
        <Brand />
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 44, fontSize: 84, fontWeight: 800, lineHeight: 1.08 }}>
          <div>Every kids’ movie</div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span>has</span>
            <span
              style={{
                margin: '0 18px',
                padding: '0 22px 6px',
                color: OG.coralText,
                border: `5px solid ${OG.coralInk}`,
                borderRadius: 999,
                transform: 'rotate(-3deg)',
              }}
            >
              that
            </span>
            <span>scene.</span>
          </div>
          <div>We’ll tell you when.</div>
        </div>
        <div style={{ display: 'flex', marginTop: 26, fontSize: 32, fontWeight: 600, color: OG.body }}>
          Every scary or sad scene, when it happens, and what’s in it.
        </div>
        <SeaFloor />
      </div>
    ),
    { ...size, fonts: await ogFonts() },
  );
}
