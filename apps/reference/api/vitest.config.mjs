import { packageConfig } from "../../../vitest.shared.mjs";

// Unit tests: src/**/*.test.ts. Integration tests: src/**/*.int.test.ts with INFRABYX_TEST_INT=1
// against PostgreSQL 18 (the shared package convention).
export default packageConfig();
