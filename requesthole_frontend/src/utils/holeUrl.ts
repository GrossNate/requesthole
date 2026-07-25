import holeService from "../services";

/**
 * The absolute URL an HTTP client should be pointed at to be captured by a
 * hole. This is the string users copy into curl, Postman or a webhook config,
 * so it must always carry a scheme and host — never a bare path.
 *
 * `BASE_URL` is `""` in production (single origin behind Nginx); there the
 * browser's own origin is the capture origin. In dev the page is served by Vite
 * on :5173 while capture only answers on the backend's origin, so an explicit
 * base wins.
 */
export function holeCaptureUrl(
  holeAddress: string,
  apiBaseUrl: string = holeService.BASE_URL,
  pageOrigin: string = window.location.origin,
): string {
  const base = apiBaseUrl === "" ? pageOrigin : apiBaseUrl;
  return `${base}/${holeAddress}`;
}
