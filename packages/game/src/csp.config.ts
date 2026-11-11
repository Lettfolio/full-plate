/**
 * Round 13 (E, red-team S12): the Content-Security-Policy the GitHub Pages build runs under, as a `<meta http-equiv>`
 * (Pages can't set response headers). Build-time only: vite.config.ts injects it when `FP_TARGET=pages`
 * (.github/workflows/pages.yml sets it). Nothing in the app imports this file.
 *
 * Why every source is what it is (UI-NOTES "Round 13 — E"):
 *  - script-src 'self': the build emits no inline script (Vite's module entry and modulepreload links only), and
 *    nothing calls eval / new Function (round13.csp.test.ts checks the built chunks).
 *  - style-src 'self': one stylesheet per chunk, linked. React's `style={…}` sets properties through the CSSOM, which
 *    a policy doesn't cover, so no 'unsafe-inline' is needed; there is no `style=""` attribute in the built HTML.
 *  - img-src 'self' data: blob: — the favicon and the brand logo are data: SVGs; the postcard preview is a data: PNG
 *    (canvas.toDataURL); the save file and the postcard download through a blob: URL.
 *  - font-src 'self' (the @fontsource files are in assets/), connect-src 'self' (no fetch leaves the page),
 *    media-src 'self' (the music and sounds are synthesised), worker-src 'self' (none today).
 *  - object-src 'none', base-uri 'self', form-action 'none'. `frame-ancestors` is ignored in a meta policy, so it isn't
 *    listed.
 *
 * Not in the artifact build: claude.ai serves the page inside its own document and injects its runtime
 * (`window.claude`, whose capability modules load later from the platform, after any meta in our <head>). A
 * script-src/connect-src of 'self' would apply to those too, and the host already applies its own policy to the frame.
 * So the plain `pnpm build` (what the artifact is published from) carries no meta CSP.
 */
export const CSP_DIRECTIVES: readonly (readonly [string, string])[] = [
  ["default-src", "'self'"],
  ["script-src", "'self'"],
  ["style-src", "'self'"],
  ["img-src", "'self' data: blob:"],
  ["font-src", "'self'"],
  ["connect-src", "'self'"],
  ["media-src", "'self'"],
  ["worker-src", "'self'"],
  ["object-src", "'none'"],
  ["base-uri", "'self'"],
  ["form-action", "'none'"],
];
export const CSP_POLICY = CSP_DIRECTIVES.map(([k, v]) => `${k} ${v}`).join("; ");

/** Puts the policy straight after `<meta charset>` (before any script, link or style), or throws if there's none. */
export function injectCsp(html: string, policy = CSP_POLICY): string {
  const at = /<meta charset="[^"]*"\s*\/?>/i.exec(html);
  if (!at) throw new Error("csp: index.html has no <meta charset> to anchor the policy after");
  const end = at.index + at[0].length;
  return `${html.slice(0, end)}\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />${html.slice(end)}`;
}

/** True when a build should carry the policy (the Pages build). */
export const wantsCsp = (env: Record<string, string | undefined>): boolean => env.FP_TARGET === "pages";
