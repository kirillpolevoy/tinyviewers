/**
 * Content-Security-Policy.
 *
 * `script-src` deliberately includes 'unsafe-inline'. Next's App Router streams the RSC payload
 * and its bootstrap through inline <script> tags; the only way to drop 'unsafe-inline' is a
 * per-request nonce from middleware, which forces every page to be dynamic. Modern browsers ignore
 * 'unsafe-inline' when a hash or nonce is present and honour it otherwise, so this is the honest
 * description of what the app needs today. Revisit with a nonce-issuing middleware.
 *
 * `style-src` also allows 'unsafe-inline': the CSS modules are external files, but a handful of
 * genuine inline styles remain (marker positions on the timeline, the shelf's tilts) and those are
 * computed from database values, not from anything a visitor controls.
 *
 * Fonts are self-hosted by next/font — nothing is fetched from Google at runtime — so font-src and
 * style-src need no external host. Images allow TMDB, which is the only remote host the app loads
 * anything from, plus data: and blob: for the image optimizer's own output.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  // React's dev tooling needs eval() to rebuild call stacks; production never gets it.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob: https://image.tmdb.org",
  "connect-src 'self'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The app asks for no device capability at all.
  {
    key: 'Permissions-Policy',
    value: 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // This app has its own lockfile; without this, Next walks up and picks the old app's root.
  turbopack: { root: import.meta.dirname },
  // Do not write AGENTS.md / CLAUDE.md into this directory.
  agentRules: false,
  // The floating dev badge sits on top of the page; it is noise in review screenshots.
  devIndicators: false,
  // Nothing gains from announcing the framework and its version.
  poweredByHeader: false,
  // `pg` opens real sockets and must not be bundled. PGlite is not listed because nothing in the
  // build imports it any more: the development database lives in lib/db-pglite.dev.mjs, which is
  // loaded by absolute path at runtime and can only be reached when NODE_ENV is not production.
  serverExternalPackages: ['pg'],
  // The file tracer still spots that literal path string and would otherwise ship the development
  // module with every function. Excluding it means a deployment carries no development-only code —
  // and nothing it reaches (PGlite, the scene-api loader) is traced in the first place, because the
  // import is built at runtime rather than written as a specifier.
  outputFileTracingExcludes: {
    '*': ['lib/db-pglite.dev.mjs'],
  },
  images: {
    // Posters come from TMDB and nowhere else. Poster and the Home shelf both render next/image,
    // so this allowlist is enforced rather than decorative.
    remotePatterns: [{ protocol: 'https', hostname: 'image.tmdb.org', pathname: '/t/p/**' }],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
