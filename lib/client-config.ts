/**
 * The gateway's public access key. Safe to expose to the browser — it is the
 * shared public key, not a secret (see README).
 */
export const CLIENT_API_KEY: string =
  process.env.NEXT_PUBLIC_PUBLIC_API_KEY || "nishan-bajagain";

export interface PlaygroundModel {
  id: string;
  owned_by: string;
  context_length?: number;
  pricing?: { input: string; output: string };
}
