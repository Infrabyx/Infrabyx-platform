// The EMAIL inbound contract against the fake (PR-LDC-50, R1-D-177).
import { defineEmailInboundContract, FakeInboundEmail } from "./email-inbound.js";

defineEmailInboundContract("FakeInboundEmail", () => {
  const port = new FakeInboundEmail("secret-a");
  const wrong = new FakeInboundEmail("secret-b");
  return {
    port,
    post: (m) => port.post([m]),
    forge: (m) => wrong.post([m]),
  };
});
