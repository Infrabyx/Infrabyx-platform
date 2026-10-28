// The hello module over HTTP (PL6 plan §8.1): every route runs behind the authentication guard
// and the tenant-context interceptor, asks the AUTHZ port before acting, validates its body with
// Zod, and hands the work to the service. Approvals routes let a checker close the maker-checker
// loop of a retraction.
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { z } from "zod";
import { TenantContextInterceptor } from "@infrabyx/tenancy/nest";
import { requireContext } from "@infrabyx/tenancy";
import { HELLO_RESOURCE } from "../fixtures.js";
import { AuthGuard } from "./auth.js";
import { SERVICES, type ServicesLike } from "./tokens.js";

const CreateBody = z.object({ message: z.string() }).strict();
const RetractBody = z.object({ reason: z.string() }).strict();
const DecideBody = z
  .object({ decision: z.enum(["approve", "reject"]), reason: z.string().max(500).optional() })
  .strict();
const Id = z.string().regex(/^grt_[0-9A-HJKMNP-TV-Z]{26}$/);
const ApprovalId = z.string().regex(/^apr_[0-9A-HJKMNP-TV-Z]{26}$/);

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new BadRequestException(
      r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
    );
  return r.data;
}

@Controller()
@UseGuards(AuthGuard)
@UseInterceptors(TenantContextInterceptor)
export class HelloController {
  constructor(@Inject(SERVICES) private readonly s: ServicesLike) {}

  private async allow(action: string, id = "*"): Promise<void> {
    const ctx = requireContext();
    const d = await this.s.authz.check(
      { id: ctx.principal.id, roles: ctx.principal.roles, attr: { tenant_id: ctx.tenantId } },
      { kind: HELLO_RESOURCE, id, attr: { tenant_id: ctx.tenantId } },
      action,
    );
    if (!d.allowed) throw new ForbiddenException(`${action} is not allowed for this principal`);
  }

  @Get("hello/greetings")
  async list() {
    await this.allow("read");
    return { greetings: await this.s.hello.list(requireContext()) };
  }

  @Post("hello/greetings")
  async create(@Body() body: unknown) {
    await this.allow("create");
    const { message } = parse(CreateBody, body);
    return this.s.hello.create(requireContext(), { message });
  }

  @Get("hello/greetings/:id")
  async get(@Param("id") id: string) {
    await this.allow("read", parse(Id, id));
    return this.s.hello.get(requireContext(), id);
  }

  @Post("hello/greetings/:id/retract")
  @HttpCode(202)
  async retract(@Param("id") id: string, @Body() body: unknown) {
    await this.allow("retract", parse(Id, id));
    const { reason } = parse(RetractBody, body);
    return this.s.hello.requestRetract(requireContext(), id, reason);
  }

  @Delete("hello/greetings/:id")
  @HttpCode(204)
  async remove(@Param("id") id: string): Promise<void> {
    await this.allow("delete", parse(Id, id));
    await this.s.hello.remove(requireContext(), id);
  }

  @Get("approvals/:id")
  async approval(@Param("id") id: string) {
    return this.s.approvals.get(requireContext(), parse(ApprovalId, id));
  }

  @Post("approvals/:id/decide")
  async decide(@Param("id") id: string, @Body() body: unknown) {
    const { decision, reason } = parse(DecideBody, body);
    const ctx = requireContext();
    const r = await this.s.approvals.decide(ctx, parse(ApprovalId, id), decision, reason);
    return r.state === "approved" && r.delayMinutes === 0 ? this.s.approvals.execute(ctx, id) : r;
  }
}
