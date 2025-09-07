import * as z from "zod";

const RequestSansBody = z.object({
  request_address: z.string(),
  created: z.date(),
  method: z.string(),
  request_path: z.string(),
  query_params: z.string(),
  headers: z.string()
});

type RequestSansBody = z.infer<typeof RequestSansBody>;

export interface HoleParams {
  hole_address: string;
}

export default RequestSansBody;