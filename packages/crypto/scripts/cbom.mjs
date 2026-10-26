// Print the CycloneDX CBOM of the algorithm registry (IPB-12 A6; published only when fut.cbom-export is ON).
import { cbom } from "../dist/index.js";

console.log(JSON.stringify(cbom({ timestamp: new Date().toISOString() }), null, 2));
