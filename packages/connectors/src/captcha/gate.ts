// The "under attack" switch (Udofin PR-UDF-029; R1-D-50): a public form asks for a CAPTCHA only
// while `int.captcha.under_attack` is on. Then a missing, refused or reused token is refused
// (429 IPB-SEC-019, `meta.rule: "captcha"`), and an unreachable vendor refuses too: the gate
// fails closed while it is on, and costs nothing while it is off.
import { IpbError } from "@infrabyx/contracts/errors";
import type { CaptchaPort, CaptchaVerdict } from "@infrabyx/contracts/ports";

export interface CaptchaGateOptions {
  captcha: CaptchaPort;
  /** `int.captcha.under_attack`, read on every request. */
  underAttack: () => Promise<boolean> | boolean;
}

export class CaptchaGate {
  constructor(private readonly o: CaptchaGateOptions) {}

  /** Whether the form should render the widget now. */
  async required(): Promise<boolean> {
    return this.o.underAttack();
  }

  /** Pass, or throw IPB-SEC-019 when the switch is on and the token does not pass. */
  async check(req: {
    token?: string | undefined;
    expectedAction?: string;
    expectedHostname?: string;
  }): Promise<{ checked: boolean }> {
    if (!(await this.o.underAttack())) return { checked: false };
    const refuse = (reason: string) =>
      new IpbError("IPB-SEC-019", {
        detail: "complete the challenge and try again",
        meta: { rule: "captcha", reason },
      });
    if (!req.token) throw refuse("missing");
    let v: CaptchaVerdict;
    try {
      v = await this.o.captcha.verify({
        token: req.token,
        ...(req.expectedAction ? { expectedAction: req.expectedAction } : {}),
        ...(req.expectedHostname ? { expectedHostname: req.expectedHostname } : {}),
      });
    } catch {
      throw refuse("unavailable");
    }
    if (!v.ok) throw refuse(v.reason);
    return { checked: true };
  }
}
