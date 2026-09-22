'use client';

import { TROUBLE } from '@/lib/copy';
import './globals.css';

/**
 * The last resort: an error in the root layout itself, where no chrome and no CSS module can be
 * relied on. It replaces <html> entirely, so the palette and the type are inlined here rather than
 * imported from a stylesheet that may be the thing that failed.
 *
 * As in app/error.tsx, `error.message` is never rendered.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: '#F7F1E6',
          color: '#33302E',
          fontFamily: 'Georgia, "Times New Roman", Times, serif',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '48px 16px',
        }}
      >
        <main
          style={{
            width: '100%',
            maxWidth: 620,
            background: '#FFFCF7',
            border: '3px solid #33302E',
            borderRadius: 34,
            boxShadow: '8px 10px 0 #EAE2D6',
            padding: '28px 28px 32px',
          }}
        >
          <h1
            style={{
              margin: 0,
              fontFamily: '"Arial Rounded MT Bold", Futura, "Trebuchet MS", sans-serif',
              fontSize: 34,
              lineHeight: 1.15,
            }}
          >
            {TROUBLE.headline}
          </h1>
          <p style={{ margin: '14px 0 0', fontSize: 18, lineHeight: 1.6, color: '#4D4C48' }}>
            {TROUBLE.body}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 22,
              minHeight: 52,
              padding: '12px 26px',
              background: '#E8836B',
              border: '3px solid #33302E',
              borderRadius: 999,
              boxShadow: '4px 5px 0 #C2614B',
              fontFamily: '"Arial Rounded MT Bold", Futura, "Trebuchet MS", sans-serif',
              fontSize: 19,
              fontWeight: 700,
              color: '#33302E',
              cursor: 'pointer',
            }}
          >
            {TROUBLE.retry}
          </button>
        </main>
      </body>
    </html>
  );
}
