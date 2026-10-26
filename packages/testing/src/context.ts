// Context builders for tests. Production code builds contexts only from verified claims.
import type { KernelContext, Principal } from "@infrabyx/contracts/kernel";

export const withTenant = (
  tenantId: string,
  roles: readonly string[] = ["ORG_ADMIN"],
  over: Omit<Partial<KernelContext>, "principal"> & { principal?: Partial<Principal> } = {},
): KernelContext => {
  const { principal, ...rest } = over;
  return { tenantId, ...rest, principal: { id: "usr_test", type: "user", roles, ...principal } };
};

export const platformContext = (
  roles: readonly string[] = ["PLT_SUPER_ADMIN"],
  tenantId = "tnt_platform",
  id = "usr_staff",
): KernelContext => ({
  tenantId,
  scope: "platform",
  principal: { id, type: "user", roles },
});

export const agentContext = (
  tenantId: string,
  roles: readonly string[] = ["AGT_VIDHI"],
  id = "agt_vidhi",
): KernelContext => ({
  tenantId,
  principal: { id, type: "agent", roles },
});
