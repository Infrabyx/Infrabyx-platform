// The NestJS application (IPB-D-05; PL6 plan §8.1): one module with the API's controllers, the
// services under one injection token, the problem filter, and the security headers of a JSON API.
// `createApp` takes built services, so tests boot the same application on their own database.
import "reflect-metadata";
import { Module, type DynamicModule, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NextFunction, Request, Response } from "express";
import type { Services } from "./services.js";
import { AuthController } from "./http/auth.controller.js";
import { HealthController } from "./http/health.controller.js";
import { HelloController } from "./http/hello.controller.js";
import { ProblemFilter } from "./http/problem.js";
import { SERVICES } from "./http/tokens.js";

@Module({})
export class AppModule {
  static forServices(services: Services): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, AuthController, HelloController],
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
  app.useGlobalFilters(new ProblemFilter());
  app.use(securityHeaders);
  const http = app.getHttpAdapter().getInstance() as { disable?: (s: string) => void };
  http.disable?.("x-powered-by");
  app.enableShutdownHooks();
  return app;
}
