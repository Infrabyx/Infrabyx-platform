// The gate endpoints of PL6 plan §8.2: published CMS content and the public Trust Centre (no
// sign-in: both are public by design), and, behind the authentication guard, the hello Vidhi
// skill (a maker triggers it; a checker decides the post through the approvals route) and the tenant export (an owner exports; an
// admin's request waits for the owner; the worker runs the job; the download is a signed link).
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { DEFAULT_LOCALE } from "@infrabyx/cms";
import { requireContext } from "@infrabyx/tenancy";
import { TenantContextInterceptor } from "@infrabyx/tenancy/nest";
import { trustCentre } from "@infrabyx/trust";
import { HELLO_RESOURCE } from "../fixtures.js";
import { AuthGuard } from "./auth.js";
import { SERVICES, type ServicesLike } from "./tokens.js";

const PackId = z.string().regex(/^brd_[0-9A-HJKMNP-TV-Z]{26}$/);
const Locale = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);
const TaskId = z.string().regex(/^tsk_[0-9A-HJKMNP-TV-Z]{26}$/);
const JobId = z.string().regex(/^exj_[0-9A-HJKMNP-TV-Z]{26}$|^[a-z]{2,6}_[0-9A-HJKMNP-TV-Z]{26}$/);
const ExportBody = z
  .object({
    scope: z
      .object({
        type: z.enum(["FULL_TENANT", "AUDIT_PACK", "DATASET"]),
        ref: z.string().optional(),
      })
      .strict(),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new BadRequestException(
      r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
    );
  return r.data;
}

const noStore = (res: Response) => {
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
};

@Controller()
export class PublicGateController {
  constructor(@Inject(SERVICES) private readonly s: ServicesLike) {}

  /** Published content of a brand pack (IPB-05 §05.4; `PublicContent.resolve`). */
  @Get("content/:packId/:locale/*path")
  async content(
    @Param("packId") packId: string,
    @Param("locale") locale: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const pack = parse(PackId, packId);
    const loc = parse(Locale, locale || DEFAULT_LOCALE);
    const prefix = `/content/${pack}/${loc}`;
    const path = decodeURIComponent((req.path ?? "").slice(prefix.length) || "/");
    const r = await this.s.content.resolve(pack, loc, path);
    noStore(res);
    if (r.kind === "content") {
      res.status(200).json(r.content);
      return;
    }
    if (r.kind === "redirect") {
      res.redirect(r.status, `${prefix}${r.to}`);
      return;
    }
    throw new NotFoundException(r.kind === "gone" ? "the page is gone" : "no such page");
  }

  /** The public Trust Centre, built from the mirror only (IPB-08 §08.3.3). */
  @Get("trust")
  async trust(@Res() res: Response): Promise<void> {
    const centre = await trustCentre(this.s.mirror, {
      links: { vdp: "/.well-known/security.txt", dpaRequest: "/trust", requestAccess: "/trust" },
    });
    noStore(res);
    res.status(200).json(centre);
  }
}

@Controller()
@UseGuards(AuthGuard)
@UseInterceptors(TenantContextInterceptor)
export class GateController {
  constructor(@Inject(SERVICES) private readonly s: ServicesLike) {}

  private async allow(action: string): Promise<void> {
    const ctx = requireContext();
    const d = await this.s.authz.check(
      { id: ctx.principal.id, roles: ctx.principal.roles, attr: { tenant_id: ctx.tenantId } },
      { kind: HELLO_RESOURCE, id: "*", attr: { tenant_id: ctx.tenantId } },
      action,
    );
    if (!d.allowed) throw new ForbiddenException(`${action} is not allowed for this principal`);
  }

  /** A maker runs the hello skill: the summary is drafted now; a checker decides the post at `POST /approvals/:id/decide`. */
  @Post("vidhi/hello/summarise")
  @HttpCode(202)
  async summarise() {
    await this.allow("create");
    return this.s.summarise.request(requireContext());
  }

  @Get("vidhi/tasks/:id")
  async task(@Param("id") id: string) {
    const t = await this.s.summarise.status(requireContext(), parse(TaskId, id));
    if (!t) throw new NotFoundException("no such task");
    return t;
  }

  /** An owner exports directly; an admin's request waits for the owner (IPB-07-27). */
  @Post("export")
  @HttpCode(202)
  async requestExport(@Body() body: unknown) {
    const { scope } = parse(ExportBody, body);
    const ctx = requireContext();
    const req = { scope: { type: scope.type, ref: scope.ref ?? null } };
    if (ctx.principal.roles.includes("ORG_OWNER")) return this.s.exports.request(ctx, req);
    return this.s.exports.submit(ctx, req);
  }

  @Get("export/:id")
  async exportJob(@Param("id") id: string) {
    return this.s.exports.get(requireContext(), parse(JobId, id));
  }

  /** A short-lived signed link to the archive, ledgered as a download (C-22). */
  @Get("export/archives/:id/download")
  async download(@Param("id") id: string) {
    return this.s.exports.download(requireContext(), parse(JobId, id));
  }
}
