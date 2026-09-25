import { ImageResponse } from 'next/og';

// The home-screen icon (iOS and Safari): the wordmark's clownfish on the page's cream.

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f1e6' }}>
        <svg width="150" height="96" viewBox="0 0 132 84" fill="none" stroke="#33302e" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 44C24 18 62 8 88 20c10 4.6 18 12 23 22-5 10-13 17.4-23 22-26 12-64 2-78-20z" fill="#e8836b" />
          <path d="M112 42l16-15v32z" fill="#f9dcd6" />
          <path d="M48 18c-5 17-5 33 1 45" stroke="#fffcf7" strokeWidth="10" />
          <path d="M48 18c-5 17-5 33 1 45" strokeWidth="3" />
          <circle cx="28" cy="37" r="4.5" fill="#33302e" stroke="none" />
        </svg>
      </div>
    ),
    size,
  );
}
