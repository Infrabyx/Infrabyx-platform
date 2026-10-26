// Common port conventions (IPB-01 §01.4.4.1).
import { z } from "zod";
import { DataClass, Residency } from "../data-class.js";

export const PortHealth = z.object({
  status: z.enum(["up", "degraded", "down"]),
  latency_ms: z.number().nonnegative(),
  checked_at: z.iso.datetime({ offset: true }),
});
export type PortHealth = z.infer<typeof PortHealth>;

/** Every adapter instance declares where it processes data and the highest class it accepts (IPB-01-16). */
export interface AdapterDescriptor {
  port: string;
  adapter: string;
  residency: Residency;
  maxDataClass: DataClass;
}

export interface Port {
  readonly descriptor: AdapterDescriptor;
  health(): Promise<PortHealth>;
}

export interface Idempotent {
  idempotencyKey?: string;
}
