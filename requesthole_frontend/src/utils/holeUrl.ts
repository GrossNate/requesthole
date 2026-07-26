import holeService from "../services";

/** The address format the backend validates against, mirrored client-side. */
const HOLE_ADDRESS = /^[a-zA-Z0-9]{6}$/;

/**
 * The absolute URL an HTTP client should be pointed at to be captured by a
 * hole. This is the string users copy into curl, Postman or a webhook config,
 * so it must always carry a scheme and host — never a bare path.
 *
 * `BASE_URL` is `""` in production (single origin behind Nginx); there the
 * browser's own origin is the capture origin. In dev the page is served by Vite
 * on :5173 while capture only answers on the backend's origin, so an explicit
 * base wins.
 *
 * Returns `null` for anything that is not a bare six-character address. The
 * address arrives from the route, so it is whatever the visitor typed, and this
 * string is built to be pasted into a shell — a link crafted with an embedded
 * newline would otherwise put a second command on the clipboard behind a URL
 * that looks ordinary on screen.
 */
export function holeCaptureUrl(
  holeAddress: string,
  apiBaseUrl: string = holeService.BASE_URL,
  pageOrigin: string = window.location.origin,
): string | null {
  if (!HOLE_ADDRESS.test(holeAddress)) return null;

  const base = apiBaseUrl === "" ? pageOrigin : apiBaseUrl;
  return `${base.replace(/\/+$/, "")}/${holeAddress}`;
}
