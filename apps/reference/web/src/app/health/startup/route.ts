// Startup probe (IPB-01 §01.4.8.2): the API answers within two seconds.
import { ready } from "../../../server/health.ts";

export const GET = (): Promise<Response> => ready();
export const dynamic = "force-dynamic";
