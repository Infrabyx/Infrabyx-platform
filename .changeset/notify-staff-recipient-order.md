---
"@infrabyx/notify": patch
"@infrabyx/contracts": patch
---

`notifyStaff` (and `enqueueStaff`) answer `recipients` sorted by principal id on the first call and on every replay of the same idempotency key, and `deliveryReceipt` lists its recipients in the same order (R1-D-234). Before, a replay returned the recipients in delivery-id order, and ULIDs made in the same millisecond are not ordered, so a replay could list the same people in a different order. Who is notified, and how many times, is unchanged.
