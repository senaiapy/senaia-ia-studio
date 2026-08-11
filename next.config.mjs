// Plain ESM rather than TypeScript on purpose.
//
// The custom server loads this file at runtime, but `typescript` is a
// devDependency, so it is absent from the production image (installed with
// `npm ci --omit=dev`). A .ts config would need Next to transpile it at boot
// and crash the runner stage. Keeping it .mjs removes that dependency entirely.

import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Whether this deployment is reached over HTTPS. Read at BUILD time, because
// the headers are baked into the routes manifest by `next build`.
// Off by default so a plain-HTTP deployment works out of the box; set
// STUDIO_FORCE_HTTPS=1 when the studio sits behind a TLS-terminating proxy.
const forceHttps = process.env.STUDIO_FORCE_HTTPS === "1";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "img-src 'self' data: blob: http: https:",
      "font-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline' https:",
      // 'unsafe-eval' is required by Next.js dev mode (source maps, HMR).
      // In production it is dropped — React and Three.js do not need eval.
      ...(process.env.NODE_ENV !== "production"
        ? ["script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:"]
        : ["script-src 'self' 'unsafe-inline' blob:"]),
      // connect-src is intentionally broad: gateway URLs are user-configured
      // at runtime and cannot be enumerated at build time.
      // Restrict further when a fixed deployment target is known.
      "connect-src 'self' ws: wss: http: https:",
      "media-src 'self' blob: data: http: https:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      // Only when the deployment is actually served over TLS.
      //
      // This directive rewrites every subresource request to https://. Behind a
      // TLS proxy that is what you want. On a plain-HTTP deployment — published
      // ports, no proxy — it upgrades the app's own CSS, JS and fonts to a
      // scheme nothing is listening on, and every one fails with
      // ERR_SSL_PROTOCOL_ERROR. The page still returns 200 and renders as bare
      // unstyled HTML, so it looks like a broken build rather than a header.
      ...(forceHttps ? ["upgrade-insecure-requests"] : []),
    ].join("; "),
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), browsing-topics=()",
  },
  {
    key: "Cross-Origin-Resource-Policy",
    value: "same-origin",
  },
];

// HSTS is meaningless (and ignored) over plain HTTP, and pinning a host to
// HTTPS for a year when no TLS listener exists would lock users out.
if (process.env.NODE_ENV === "production" && forceHttps) {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  });
}

/** @type {import("next").NextConfig} */
const nextConfig = {
  turbopack: {
    root: path.resolve(dirname),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
