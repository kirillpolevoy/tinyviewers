import { ImageResponse } from 'next/og';
import { getFilm, getFilmScenes } from '@/lib/queries';
import { Brand, OG, OG_SIZE, SeaFloor, ogFonts } from '@/lib/og';

// A film's link preview: its poster, title, and how many scenes a parent should know about, by
// strength for ages 5-7 (the page's default band). Falls back to the plain site card for an unknown film.

export const alt = 'A Tiny Viewers scene guide';
export const size = OG_SIZE;
export const contentType = 'image/png';

const LEVELS: [number, string][] = [
  [3, 'very strong'],
  [2, 'strong'],
  [1, 'mild'],
];

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [film, scenes] = await Promise.all([getFilm(slug), getFilmScenes(slug)]);
  const title = film?.title ?? 'Scene guides for kids’ movies';
  const counts = LEVELS.map(([level, word]) => [scenes.filter((s) => s.severity57 === level).length, word] as const).filter(
    ([n]) => n > 0,
  );
  const poster = film?.posterUrl && /^https:\/\/image\.tmdb\.org\//.test(film.posterUrl) ? film.posterUrl : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: OG.page,
          padding: '56px 72px',
          fontFamily: 'Baloo',
          color: OG.ink,
          gap: 56,
        }}
      >
        {poster && (
          // eslint-disable-next-line @next/next/no-img-element -- next/og renders plain <img>
          <img
            src={poster}
            width={300}
            height={450}
            style={{ borderRadius: 22, border: `4px solid ${OG.ink}`, boxShadow: `10px 12px 0 ${OG.ink}`, objectFit: 'cover' }}
          />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <Brand size={30} />
          <div style={{ display: 'flex', marginTop: 34, fontSize: title.length > 22 ? 64 : 76, fontWeight: 800, lineHeight: 1.05 }}>{title}</div>
          {film?.year ? <div style={{ display: 'flex', marginTop: 6, fontSize: 30, fontWeight: 600, color: OG.body }}>{film.year}</div> : null}
          {scenes.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 30 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                <span style={{ fontSize: 92, fontWeight: 800, lineHeight: 1 }}>{scenes.length}</span>
                <span style={{ fontSize: 36, fontWeight: 600 }}>{`${scenes.length === 1 ? 'scene' : 'scenes'} to know about`}</span>
              </div>
              {counts.length > 0 && (
                <div style={{ display: 'flex', marginTop: 16, gap: 12 }}>
                  {counts.map(([n, word]) => (
                    <div
                      key={word}
                      style={{
                        display: 'flex',
                        padding: '6px 18px',
                        borderRadius: 999,
                        border: `3px solid ${OG.ink}`,
                        background: word === 'very strong' ? OG.coral : word === 'strong' ? OG.butter : OG.sheet,
                        fontSize: 26,
                        fontWeight: 600,
                      }}
                    >
                      {`${n} ${word}`}
                    </div>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', fontSize: 24, fontWeight: 600, color: OG.body }}>ages 5–7</div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', marginTop: 30, fontSize: 36, fontWeight: 600, color: OG.body }}>
              Every scary or sad scene, when it happens, and what’s in it.
            </div>
          )}
        </div>
        <SeaFloor />
      </div>
    ),
    { ...size, fonts: await ogFonts() },
  );
}
