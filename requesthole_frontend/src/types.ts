import type React from "react";

type UseStateSetter<F> = React.Dispatch<React.SetStateAction<F>>;
export type holeObject = { hole_address: string };

export interface HomeBlockProps {
  holes: holeObject[];
  setHoles: UseStateSetter<holeObject[]>;
  createHole: () => void;
}

export interface RequestObject {
  request_address: string;
  created: number;
  method: string;
  request_path: string;
  query_params: string;
  headers: string;
  headersObject: RequestHeadersObject;
}

export type RequestHeadersObject = { [key: string]: string };