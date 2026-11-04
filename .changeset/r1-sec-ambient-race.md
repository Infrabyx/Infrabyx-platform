---
"@infrabyx/tenancy": patch
---

Security fix (R1-D-92): no statement can run on a kernel transaction's connection after the transaction has ended. A `tx` used after its `mutate` or `read` returned is refused with `KernelGuardError`; an ambient mutation waits for every joined call still running before it ends, fails when one was, and refuses a joined call that starts after it ended. Before this fix, a joined call left running when its ambient mutation ended (a sibling of a refused call, or one not awaited) could run its next statements on the pooled connection's next transaction, which may belong to another tenant.
