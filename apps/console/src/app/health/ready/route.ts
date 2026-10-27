// Readiness probe (IPB-01 §01.4.8.2): the database answers.
import { ready } from "../../../server/health.ts";

export const GET = (): Promise<Response> => ready();
export const dynamic = "force-dynamic";
