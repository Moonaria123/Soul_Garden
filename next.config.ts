import type { NextConfig } from "next";

// SU-ITER-092-batch1 · baseline security response headers.
// Scope: single-user local-first installs today; prod/dev unified per user
// decision (see ITERATION-LOG §SU-092 csp-relaxations table for rationale
// per directive).  All relaxations are documented RLX-CSP-01~04.  Re-tighten
// trigger: deployment shape moves to multi-user / public-internet / proxied
// (see §SU-093 R-093-03).

// Keep CSP readable by building it per-directive; spaces join by default.
const CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  // RLX-CSP-01 (unsafe-inline) + RLX-CSP-02 (unsafe-eval).
  "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
  // RLX-CSP-03 (unsafe-inline for style).
  "style-src": ["'self'", "'unsafe-inline'"],
  // RLX-CSP-04 (data: + blob: for avatar / chat-bg preview).
  "img-src": ["'self'", "data:", "blob:"],
  // Fonts: inline data URLs are common for glyph subsets.
  "font-src": ["'self'", "data:"],
  // XHR / fetch — local LLM providers typically resolved at runtime, so we
  // restrict to 'self' here and allow user-configured providers through the
  // Node proxy rather than loosening the browser CSP.
  "connect-src": ["'self'"],
  // Media (audio preview / speech synthesis output) stays local+blob only.
  "media-src": ["'self'", "blob:"],
  "worker-src": ["'self'", "blob:"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
};

const CSP_VALUE = Object.entries(CSP_DIRECTIVES)
  .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
  .join("; ");

const SECURITY_HEADERS = [
  // Transport-agnostic hardening — applied to every response.
  { key: "Content-Security-Policy", value: CSP_VALUE },
  // Do not leak full referrer to cross-origin (e.g. in screenshots / image
  // hotlinks); origin is enough for provider attribution.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Deny MIME-sniffing; we always set `Content-Type` explicitly.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Backwards-compat with older browsers that ignore CSP frame-ancestors.
  { key: "X-Frame-Options", value: "DENY" },
  // Deny every sensitive browser capability unless/until we opt in per page.
  // Matches the local-first profile: no camera/mic/geolocation at the edge.
  {
    key: "Permissions-Policy",
    value: [
      "accelerometer=()",
      "autoplay=()",
      "camera=()",
      "clipboard-read=(self)",
      "clipboard-write=(self)",
      "cross-origin-isolated=()",
      "display-capture=()",
      "encrypted-media=()",
      "fullscreen=(self)",
      "geolocation=()",
      "gyroscope=()",
      "hid=()",
      "idle-detection=()",
      "magnetometer=()",
      "microphone=(self)",
      "midi=()",
      "payment=()",
      "picture-in-picture=()",
      "publickey-credentials-get=()",
      "screen-wake-lock=()",
      "serial=()",
      "sync-xhr=()",
      "usb=()",
      "xr-spatial-tracking=()",
    ].join(", "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@libsql/client"],
  async headers() {
    return [
      // SU-ITER-092-batch1 · baseline security headers applied site-wide.
      // Any path-specific override below can still add its own entries.
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        // Login-page background: `import` now bundles with a content hash; if
        // the legacy `/login-bg.png` URL is still hit, avoid caching stale bits.
        source: "/login-bg.png",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
