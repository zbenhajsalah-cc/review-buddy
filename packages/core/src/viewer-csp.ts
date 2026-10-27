/**
 * Content-Security-Policy for every app that shows the viewer (the plugin's
 * loopback server, the desktop renderer). Self-only sources: the viewer is
 * fully self-contained (no CDN/remote fetch), so this blocks any exfiltration
 * of rendered agent/diff content to a remote host while keeping the app
 * working. 'unsafe-inline' is limited to styles (Shiki/Tailwind emit inline
 * styles); scripts fall back to default-src 'self' (external hashed modules
 * OK, inline script blocked).
 */
export const VIEWER_CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
