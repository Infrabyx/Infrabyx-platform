// The reference app's seed modules, in the order `infrabyx-seed --modules` runs them: the hello
// greetings and the gate's content and trust mirror (PL6 plan §8.1, §8.2).
import type { SeedModule } from "@infrabyx/seed";
import { referenceGateSeedModule } from "./gate.js";
import { helloSeedModule } from "./hello.js";

export { helloSeedModule, referenceGateSeedModule };

/** What `infrabyx-seed --modules` imports. */
export const seedModules: SeedModule[] = [helloSeedModule, referenceGateSeedModule];
