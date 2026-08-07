/**
 * The address format the backend validates against, mirrored client-side.
 * Both hole and request addresses use it.
 *
 * Addresses reach the app through the route, so they are whatever the visitor
 * typed — `useParams` percent-decodes them, which means a crafted link can put
 * slashes, newlines or traversal segments into a value the app would otherwise
 * interpolate straight into a request URL or onto the clipboard.
 */
const ADDRESS = /^[a-zA-Z0-9]{6}$/;

export function isAddress(candidate: string | undefined): boolean {
  return candidate !== undefined && ADDRESS.test(candidate);
}
