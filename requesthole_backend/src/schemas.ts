import * as z from "zod";

const RequestSansBody = z.object({
  request_address: z.string(),
  created: z.string(),
  method: z.string(),
  request_path: z.string(),
  query_params: z.string(),
  headers: z.string(),
  /** JSON describing content the media gate dropped, or null. */
  body_dropped: z.string().nullable(),
});

type RequestSansBody = z.infer<typeof RequestSansBody>;

export interface HoleParams {
  hole_address: string;
}

export default RequestSansBody;
