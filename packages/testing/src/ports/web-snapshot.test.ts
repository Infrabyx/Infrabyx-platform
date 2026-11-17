// The web snapshot contract against the in-memory fake (PR-LDC-40, R1-D-176).
import { withTenant } from "../context.js";
import { defineWebSnapshotContract, FakeWebSnapshot } from "./web-snapshot.js";

defineWebSnapshotContract("FakeWebSnapshot", async () => {
  const port = new FakeWebSnapshot();
  return {
    port,
    ctx: withTenant("tnt_a"),
    prefix: "tenant/tnt_a/evidence",
    otherTenant: withTenant("tnt_b"),
    base: "https://site.example",
    serve: (url, page) => port.serve(url, page),
    corrupt: async (s) => port.corrupt(s.id),
  };
});
