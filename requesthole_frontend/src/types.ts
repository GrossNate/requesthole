import type React from "react";

type UseStateSetter<F> = React.Dispatch<React.SetStateAction<F>>;
export type holeObject = { hole_address: string };

/** Where a fetch has got to, so an empty list is never mistaken for no data. */
export type LoadState = "loading" | "loaded" | "failed";

export interface HomeBlockProps {
  holes: holeObject[];
  setHoles: UseStateSetter<holeObject[]>;
  createHole: () => void;
  loadState: LoadState;
}

export interface RequestObject {
  request_address: string;
  /** ISO-8601 text, as stored — e.g. "2026-07-25T14:03:22.145Z". */
  created: string;
  method: string;
  request_path: string;
  /** JSON text of the parsed querystring. */
  query_params: string;
  /** JSON text of the captured headers. */
  headers: string;
  /** Client-side only: `headers` parsed. Never present on the wire. */
  headersObject?: RequestHeadersObject;
}

export type RequestHeadersObject = { [key: string]: string };
