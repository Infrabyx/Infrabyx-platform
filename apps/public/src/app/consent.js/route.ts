// The CMP controller, served from this origin and loaded with the CSP nonce (IPB-04-79).
import { CMP_CONTROLLER_JS } from "@infrabyx/consent";
import { text } from "../../server/files.ts";

export const GET = () => text(CMP_CONTROLLER_JS, "text/javascript", 3600);
