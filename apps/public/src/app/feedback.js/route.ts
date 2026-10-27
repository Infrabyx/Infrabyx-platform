// The feedback dialog controller, served from this origin and loaded with the CSP nonce (IPB-04-98).
import { FEEDBACK_CONTROLLER_JS } from "@infrabyx/feedback";
import { text } from "../../server/files.ts";

export const GET = () => text(FEEDBACK_CONTROLLER_JS, "text/javascript", 3600);
