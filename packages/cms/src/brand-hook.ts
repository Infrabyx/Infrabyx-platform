// The footer validator as Brand Studio's publish precondition (IPB-04 §04.4.3 "footer validator
// pass"; PL5 plan §5.2). The legal entity comes from the brand pack revision being submitted; the
// officers, adopted policies and shell flags come from the product (policy set, `@infrabyx/ui`).
import { IpbError } from "@infrabyx/contracts/errors";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { footerInputFrom, footerReport, validateFooter, type FooterContext } from "./footer.js";
import type { PublicContent } from "./public.js";

interface BrandBodyLike {
  app_name: string;
  legal_entity: {
    name: string;
    cin?: string | undefined;
    gstin?: string | undefined;
    registered_office: string;
  };
  logo?: unknown;
}

export function brandFooterHook(o: {
  reader: PublicContent;
  context: (
    ctx: KernelContext,
    packId: string,
  ) => Promise<Pick<FooterContext, "officers" | "legal" | "shell"> & { groupUrl: string }>;
}) {
  return async (ctx: KernelContext, body: BrandBodyLike, packId: string): Promise<void> => {
    const extra = await o.context(ctx, packId);
    const published = await o.reader.list(packId);
    const input = footerInputFrom(published, {
      pack: packId,
      brand: { logo: Boolean(body.logo), groupUrl: extra.groupUrl },
      legalEntity: {
        name: body.legal_entity.name,
        cin: body.legal_entity.cin,
        gstin: body.legal_entity.gstin,
        registeredOffice: body.legal_entity.registered_office,
      },
      officers: extra.officers,
      legal: extra.legal,
      shell: extra.shell,
    });
    const findings = validateFooter(input);
    if (findings.length)
      throw new IpbError("IPB-CMS-003", {
        detail: footerReport(findings),
        meta: { reason: "footer", fields: findings.map((f) => f.field) },
      });
  };
}
