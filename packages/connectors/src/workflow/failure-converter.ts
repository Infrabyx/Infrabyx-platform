// C-16: failure messages and stack traces go through the payload codec as well. Loaded by path
// inside the workflow sandbox (`failureConverterPath`), so it exports a ready instance.
import { DefaultFailureConverter } from "@temporalio/common";

export const failureConverter = new DefaultFailureConverter({ encodeCommonAttributes: true });
