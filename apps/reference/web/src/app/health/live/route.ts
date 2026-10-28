// Liveness probe (IPB-01 §01.4.8.2): the process serves requests.
import { live } from "../../../server/health.ts";

export const GET = (): Response => live();
export const dynamic = "force-dynamic";
