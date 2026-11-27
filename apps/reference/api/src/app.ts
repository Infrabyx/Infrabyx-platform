// The NestJS application (IPB-D-05; PL6 plan §8.1): one module with the API's controllers, the
// services under one injection token, the problem filter, and the security headers of a JSON API.
// A zstd-coded request body is refused 415 before Nest's body parser or any guard (CVE-2026-124851,
// LDC-68; R1-D-294).
// `createApp` takes built services, so tests boot the same application on their own database.
import "reflect-metadata";
import { Module, type DynamicModule, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NextFunction, Request, Response } from "express";
import { refuseZstdBodies } from "@infrabyx/connectors/content-coding";
import type { Services } from "./services.js";
import { AuthController } from "./http/auth.controller.js";
import { GateController, PublicGateController } from "./http/gate.controller.js";
import { HealthController } from "./http/health.controller.js";
import { HelloController } from "./http/hello.controller.js";
import { ProblemFilter } from "./http/problem.js";
import { SERVICES } from "./http/tokens.js";

@Module({})
export class AppModule {
  static forServices(services: Services): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        AuthController,
        HelloController,
        PublicGateController,
        GateController,
      ],
      providers: [{ provide: SERVICES, useValue: services }],
    };
  }
}

/** Response headers of every route (IPB-02 §02.4.4 for an API: no framing, no sniffing, no caching). */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  next();
}

export async function createApp(services: Services): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forServices(services), {
    logger: ["error", "warn"],
    bodyParser: true,
  });
  // First: `app.use` registers at once, and Nest adds its body parsers later, at `init`, so this
  // runs before body-parser could decode the body (`app.test.ts` proves the order).
  app.use(refuseZstdBodies);
  app.useGlobalFilters(new ProblemFilter());
  app.use(securityHeaders);
  const http = app.getHttpAdapter().getInstance() as { disable?: (s: string) => void };
  http.disable?.("x-powered-by");
  app.enableShutdownHooks();
  return app;
}
