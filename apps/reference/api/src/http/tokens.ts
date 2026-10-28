// The one injection token of the API. Nest's constructor injection by type needs
// `emitDecoratorMetadata`, which the workspace's TypeScript and Vitest builds do not emit; every
// controller and guard asks for the services by this token instead, so the same code runs built
// (tsc) and under test (esbuild) alike.
import type { Services } from "../services.js";

export const SERVICES = Symbol("infrabyx.reference.services");
export type ServicesLike = Services;
