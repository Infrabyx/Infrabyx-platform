// A document in STORAGE, by key and SHA-256: what ESTAMP, DOCGEN and PDF take and return
// (PR-FBX-29, R1-D-52). The bytes never pass through the port's arguments.
import { z } from "zod";
import { classed } from "./payload-class.js";

export const DocFileRef = z
  .object({
    storageKey: classed(z.string().min(1).max(1024), "CONFIDENTIAL"),
    sha256: classed(z.string().regex(/^[0-9a-f]{64}$/), "CONFIDENTIAL"),
  })
  .strict();
export type DocFileRef = z.infer<typeof DocFileRef>;

/** Where a port writes its output: a key prefix under the tenant's own STORAGE prefix. */
export const OutputPrefix = z.string().regex(/^tenant\/[a-z]{2,6}_[A-Za-z0-9]+\/[a-z][a-z0-9_/]*$/);
