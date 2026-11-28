# @infrabyx/vidhi

## 1.0.70

### Patch Changes

- Updated dependencies [fa389d6]
  - @infrabyx/contracts@1.56.0
  - @infrabyx/ai@1.2.22
  - @infrabyx/config@1.24.10
  - @infrabyx/crypto@1.15.8
  - @infrabyx/tenancy@1.30.4

## 1.0.69

### Patch Changes

- Updated dependencies [bdd282a]
  - @infrabyx/contracts@1.55.0
  - @infrabyx/ai@1.2.21
  - @infrabyx/config@1.24.9
  - @infrabyx/crypto@1.15.7
  - @infrabyx/tenancy@1.30.3

## 1.0.68

### Patch Changes

- Updated dependencies [c45aaa0]
- Updated dependencies [4e319d1]
  - @infrabyx/config@1.24.8
  - @infrabyx/contracts@1.54.0
  - @infrabyx/ai@1.2.20
  - @infrabyx/tenancy@1.30.2
  - @infrabyx/crypto@1.15.6

## 1.0.67

### Patch Changes

- 4db3acb: Refuse zstd content codings while the runtime's bundled zstd 1.5.7 is affected by CVE-2026-124851 (LDC-68; R1-D-294; guide §7fb). New `@infrabyx/connectors/content-coding`: `refuseZstdBodies` (and `refuseZstdBodiesWith`) answers a `Content-Encoding: zstd` request 415 `IPB-SEC-010` before any body parser or guard, while gzip, deflate and br pass; `refuseZstdFetch` never offers zstd and refuses a zstd response unread. `createEgress`, the OpenFGA and Cerbos adapters, the OH consent ledger and Vidhi's MCP client no longer offer zstd, and `createEgress` refuses a zstd answer with `IPB-SEC-010` without retrying. Whole-object assertions on the headers an injected fetch receives gain `accept-encoding: gzip, deflate, br`.

## 1.0.66

### Patch Changes

- Updated dependencies [f4f525b]
  - @infrabyx/contracts@1.53.0
  - @infrabyx/ai@1.2.19
  - @infrabyx/config@1.24.7
  - @infrabyx/crypto@1.15.5
  - @infrabyx/tenancy@1.30.1

## 1.0.65

### Patch Changes

- Updated dependencies [591ff53]
  - @infrabyx/tenancy@1.30.0
  - @infrabyx/ai@1.2.18

## 1.0.64

### Patch Changes

- Updated dependencies [95acbf9]
  - @infrabyx/contracts@1.52.0
  - @infrabyx/ai@1.2.17
  - @infrabyx/config@1.24.6
  - @infrabyx/crypto@1.15.4
  - @infrabyx/tenancy@1.29.1

## 1.0.63

### Patch Changes

- Updated dependencies [c07aefe]
  - @infrabyx/tenancy@1.29.0
  - @infrabyx/ai@1.2.16

## 1.0.62

### Patch Changes

- Updated dependencies [fc9e98c]
  - @infrabyx/tenancy@1.28.0
  - @infrabyx/contracts@1.51.0
  - @infrabyx/ai@1.2.15
  - @infrabyx/config@1.24.5
  - @infrabyx/crypto@1.15.3

## 1.0.61

### Patch Changes

- Updated dependencies [061f0d4]
  - @infrabyx/tenancy@1.27.0
  - @infrabyx/ai@1.2.14

## 1.0.60

### Patch Changes

- Updated dependencies [613e0e0]
- Updated dependencies [90ffc18]
- Updated dependencies [9abffba]
  - @infrabyx/tenancy@1.26.0
  - @infrabyx/contracts@1.50.0
  - @infrabyx/ai@1.2.13
  - @infrabyx/config@1.24.4
  - @infrabyx/crypto@1.15.2

## 1.0.59

### Patch Changes

- Updated dependencies [a37e9fe]
- Updated dependencies [4fbcf73]
  - @infrabyx/tenancy@1.25.0
  - @infrabyx/contracts@1.49.0
  - @infrabyx/ai@1.2.12
  - @infrabyx/config@1.24.3
  - @infrabyx/crypto@1.15.1

## 1.0.58

### Patch Changes

- Updated dependencies [e98dfeb]
- Updated dependencies [24c16c4]
- Updated dependencies [b131e84]
- Updated dependencies [5fc6afe]
- Updated dependencies [daa13b9]
  - @infrabyx/crypto@1.15.0
  - @infrabyx/ai@1.2.11
  - @infrabyx/contracts@1.48.0
  - @infrabyx/config@1.24.2
  - @infrabyx/tenancy@1.24.1

## 1.0.57

### Patch Changes

- Updated dependencies [5ee71f6]
- Updated dependencies [cb859aa]
  - @infrabyx/contracts@1.47.0
  - @infrabyx/tenancy@1.24.0
  - @infrabyx/ai@1.2.10
  - @infrabyx/config@1.24.1
  - @infrabyx/crypto@1.14.1

## 1.0.56

### Patch Changes

- Updated dependencies [2769b78]
- Updated dependencies [5aba118]
- Updated dependencies [2a0ea72]
- Updated dependencies [21a2bc4]
- Updated dependencies [ef3adc2]
- Updated dependencies [01f9313]
- Updated dependencies [200a8a4]
  - @infrabyx/config@1.24.0
  - @infrabyx/contracts@1.46.0
  - @infrabyx/crypto@1.14.0
  - @infrabyx/ai@1.2.9
  - @infrabyx/tenancy@1.23.1

## 1.0.55

### Patch Changes

- Updated dependencies [75cbd9a]
- Updated dependencies [beca045]
- Updated dependencies [5b1257d]
- Updated dependencies [199c930]
- Updated dependencies [27057c2]
- Updated dependencies [a107b8d]
- Updated dependencies [a702fdc]
- Updated dependencies [f3293a2]
  - @infrabyx/contracts@1.45.0
  - @infrabyx/crypto@1.13.0
  - @infrabyx/tenancy@1.23.0
  - @infrabyx/ai@1.2.8
  - @infrabyx/config@1.23.1

## 1.0.54

### Patch Changes

- Updated dependencies [d4636a3]
- Updated dependencies [ae319d5]
- Updated dependencies [2d543fe]
- Updated dependencies [98a1d62]
- Updated dependencies [461fe2c]
  - @infrabyx/contracts@1.44.0
  - @infrabyx/config@1.23.0
  - @infrabyx/crypto@1.12.0
  - @infrabyx/ai@1.2.7
  - @infrabyx/tenancy@1.22.2

## 1.0.53

### Patch Changes

- Updated dependencies [648c511]
- Updated dependencies [9be2fc7]
- Updated dependencies [f0edee3]
- Updated dependencies [2d2729b]
  - @infrabyx/crypto@1.11.0
  - @infrabyx/contracts@1.43.0
  - @infrabyx/ai@1.2.6
  - @infrabyx/config@1.22.3
  - @infrabyx/tenancy@1.22.1

## 1.0.52

### Patch Changes

- Updated dependencies [206b3c1]
- Updated dependencies [2cb5b3f]
- Updated dependencies [a38f921]
- Updated dependencies [f62dcaa]
- Updated dependencies [dbb08e6]
  - @infrabyx/tenancy@1.22.0
  - @infrabyx/contracts@1.42.0
  - @infrabyx/crypto@1.10.0
  - @infrabyx/ai@1.2.5
  - @infrabyx/config@1.22.2

## 1.0.51

### Patch Changes

- Updated dependencies [98c9416]
  - @infrabyx/contracts@1.41.0
  - @infrabyx/ai@1.2.4
  - @infrabyx/config@1.22.1
  - @infrabyx/crypto@1.9.2
  - @infrabyx/tenancy@1.21.4

## 1.0.50

### Patch Changes

- Updated dependencies [053e16a]
- Updated dependencies [ce8ca22]
- Updated dependencies [b135555]
- Updated dependencies [48810fd]
- Updated dependencies [1ffb012]
  - @infrabyx/contracts@1.40.0
  - @infrabyx/config@1.22.0
  - @infrabyx/ai@1.2.3
  - @infrabyx/crypto@1.9.1
  - @infrabyx/tenancy@1.21.3

## 1.0.49

### Patch Changes

- Updated dependencies [5fd012a]
- Updated dependencies [3b57c29]
- Updated dependencies [4d509e6]
  - @infrabyx/contracts@1.39.0
  - @infrabyx/crypto@1.9.0
  - @infrabyx/config@1.21.0
  - @infrabyx/ai@1.2.2
  - @infrabyx/tenancy@1.21.2

## 1.0.48

### Patch Changes

- Updated dependencies [3c4b588]
  - @infrabyx/contracts@1.38.0
  - @infrabyx/crypto@1.8.0
  - @infrabyx/ai@1.2.1
  - @infrabyx/config@1.20.1
  - @infrabyx/tenancy@1.21.1

## 1.0.47

### Patch Changes

- Updated dependencies [82dc7ef]
- Updated dependencies [1cdbf0f]
- Updated dependencies [2f9d3f8]
- Updated dependencies [b0e0b72]
- Updated dependencies [1cdbf0f]
- Updated dependencies [9e626ef]
- Updated dependencies [aac1c2c]
- Updated dependencies [62dc1eb]
- Updated dependencies [d58d5f0]
- Updated dependencies [dbaecff]
- Updated dependencies [80a843a]
- Updated dependencies [1cdbf0f]
- Updated dependencies [ff2a74b]
- Updated dependencies [d35f7e9]
  - @infrabyx/contracts@1.37.0
  - @infrabyx/ai@1.2.0
  - @infrabyx/tenancy@1.21.0
  - @infrabyx/crypto@1.7.0
  - @infrabyx/config@1.20.0

## 1.0.46

### Patch Changes

- Updated dependencies [4af2688]
- Updated dependencies [955cc67]
  - @infrabyx/contracts@1.36.0
  - @infrabyx/config@1.19.0
  - @infrabyx/ai@1.1.17
  - @infrabyx/crypto@1.6.2
  - @infrabyx/tenancy@1.20.7

## 1.0.45

### Patch Changes

- Updated dependencies [a6929eb]
  - @infrabyx/contracts@1.35.0
  - @infrabyx/ai@1.1.16
  - @infrabyx/config@1.18.1
  - @infrabyx/crypto@1.6.1
  - @infrabyx/tenancy@1.20.6

## 1.0.44

### Patch Changes

- Updated dependencies [3e69471]
- Updated dependencies [3e69471]
- Updated dependencies [3e69471]
  - @infrabyx/config@1.18.0
  - @infrabyx/contracts@1.34.0
  - @infrabyx/crypto@1.6.0
  - @infrabyx/ai@1.1.15
  - @infrabyx/tenancy@1.20.5

## 1.0.43

### Patch Changes

- Updated dependencies [34f5e49]
- Updated dependencies [34f5e49]
  - @infrabyx/config@1.17.0
  - @infrabyx/contracts@1.33.0
  - @infrabyx/ai@1.1.14
  - @infrabyx/tenancy@1.20.4
  - @infrabyx/crypto@1.5.18

## 1.0.42

### Patch Changes

- Updated dependencies [6bb68c1]
- Updated dependencies [6bb68c1]
  - @infrabyx/config@1.16.0
  - @infrabyx/contracts@1.32.0
  - @infrabyx/ai@1.1.13
  - @infrabyx/tenancy@1.20.3
  - @infrabyx/crypto@1.5.17

## 1.0.41

### Patch Changes

- Updated dependencies [32097cb]
  - @infrabyx/contracts@1.31.0
  - @infrabyx/ai@1.1.12
  - @infrabyx/config@1.15.2
  - @infrabyx/crypto@1.5.16
  - @infrabyx/tenancy@1.20.2

## 1.0.40

### Patch Changes

- Updated dependencies [c79fef5]
  - @infrabyx/contracts@1.30.0
  - @infrabyx/ai@1.1.11
  - @infrabyx/config@1.15.1
  - @infrabyx/crypto@1.5.15
  - @infrabyx/tenancy@1.20.1

## 1.0.39

### Patch Changes

- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
  - @infrabyx/contracts@1.29.0
  - @infrabyx/tenancy@1.20.0
  - @infrabyx/config@1.15.0
  - @infrabyx/ai@1.1.10
  - @infrabyx/crypto@1.5.14

## 1.0.38

### Patch Changes

- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
  - @infrabyx/contracts@1.28.0
  - @infrabyx/tenancy@1.19.0
  - @infrabyx/config@1.14.0
  - @infrabyx/ai@1.1.9
  - @infrabyx/crypto@1.5.13

## 1.0.37

### Patch Changes

- Updated dependencies [043a348]
- Updated dependencies [043a348]
- Updated dependencies [043a348]
  - @infrabyx/contracts@1.27.0
  - @infrabyx/ai@1.1.8
  - @infrabyx/config@1.13.4
  - @infrabyx/crypto@1.5.12
  - @infrabyx/tenancy@1.18.2

## 1.0.36

### Patch Changes

- 0aa0f1d: Register `vidhi.outbox` for the outbox relay (`vidhi` migration `register_outbox`; LawDocsComply PR-LDC-35, R1-D-112). The outbox was never registered, so `OutboxRelay` neither found nor delivered its events; run `infrabyx-migrate` and the next relay pass delivers the backlog.
- Updated dependencies [0aa0f1d]
- Updated dependencies [0aa0f1d]
- Updated dependencies [0aa0f1d]
- Updated dependencies [0aa0f1d]
  - @infrabyx/ai@1.1.7
  - @infrabyx/config@1.13.3
  - @infrabyx/tenancy@1.18.1
  - @infrabyx/contracts@1.26.0
  - @infrabyx/crypto@1.5.11

## 1.0.35

### Patch Changes

- Updated dependencies [496180e]
  - @infrabyx/contracts@1.25.0
  - @infrabyx/tenancy@1.18.0
  - @infrabyx/ai@1.1.6
  - @infrabyx/config@1.13.2
  - @infrabyx/crypto@1.5.10

## 1.0.34

### Patch Changes

- Updated dependencies [e86dedf]
  - @infrabyx/tenancy@1.17.0
  - @infrabyx/contracts@1.24.0
  - @infrabyx/ai@1.1.5
  - @infrabyx/config@1.13.1
  - @infrabyx/crypto@1.5.9

## 1.0.33

### Patch Changes

- Updated dependencies [d3888de]
  - @infrabyx/config@1.13.0
  - @infrabyx/ai@1.1.4
  - @infrabyx/tenancy@1.16.1

## 1.0.32

### Patch Changes

- Updated dependencies [67be297]
- Updated dependencies [67be297]
- Updated dependencies [67be297]
- Updated dependencies [67be297]
  - @infrabyx/contracts@1.23.0
  - @infrabyx/tenancy@1.16.0
  - @infrabyx/ai@1.1.3
  - @infrabyx/config@1.12.1
  - @infrabyx/crypto@1.5.8

## 1.0.31

### Patch Changes

- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
  - @infrabyx/config@1.12.0
  - @infrabyx/tenancy@1.15.0
  - @infrabyx/contracts@1.22.0
  - @infrabyx/ai@1.1.2
  - @infrabyx/crypto@1.5.7

## 1.0.30

### Patch Changes

- Updated dependencies [bc2c301]
  - @infrabyx/tenancy@1.14.1
  - @infrabyx/ai@1.1.1

## 1.0.29

### Patch Changes

- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
  - @infrabyx/tenancy@1.14.0
  - @infrabyx/config@1.11.0
  - @infrabyx/contracts@1.21.0
  - @infrabyx/ai@1.1.0
  - @infrabyx/crypto@1.5.6

## 1.0.28

### Patch Changes

- Updated dependencies [b8c1f2c]
- Updated dependencies [b8c1f2c]
  - @infrabyx/contracts@1.20.0
  - @infrabyx/tenancy@1.13.0
  - @infrabyx/ai@1.0.28
  - @infrabyx/config@1.10.1
  - @infrabyx/crypto@1.5.5

## 1.0.27

### Patch Changes

- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
  - @infrabyx/tenancy@1.12.0
  - @infrabyx/contracts@1.19.0
  - @infrabyx/config@1.10.0
  - @infrabyx/ai@1.0.27
  - @infrabyx/crypto@1.5.4

## 1.0.26

### Patch Changes

- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
  - @infrabyx/tenancy@1.11.0
  - @infrabyx/contracts@1.18.0
  - @infrabyx/ai@1.0.26
  - @infrabyx/config@1.9.2
  - @infrabyx/crypto@1.5.3

## 1.0.25

### Patch Changes

- Updated dependencies [714ad01]
  - @infrabyx/contracts@1.17.0
  - @infrabyx/ai@1.0.25
  - @infrabyx/config@1.9.1
  - @infrabyx/crypto@1.5.2
  - @infrabyx/tenancy@1.10.1

## 1.0.24

### Patch Changes

- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
  - @infrabyx/config@1.9.0
  - @infrabyx/tenancy@1.10.0
  - @infrabyx/contracts@1.16.0
  - @infrabyx/ai@1.0.24
  - @infrabyx/crypto@1.5.1

## 1.0.23

### Patch Changes

- Updated dependencies [fdd1f1a]
- Updated dependencies [ed143e3]
  - @infrabyx/config@1.8.0
  - @infrabyx/ai@1.0.23
  - @infrabyx/tenancy@1.9.2

## 1.0.22

### Patch Changes

- Updated dependencies [2a95100]
- Updated dependencies [2a95100]
  - @infrabyx/config@1.7.0
  - @infrabyx/crypto@1.5.0
  - @infrabyx/ai@1.0.22
  - @infrabyx/tenancy@1.9.1

## 1.0.21

### Patch Changes

- @infrabyx/ai@1.0.21

## 1.0.20

### Patch Changes

- Updated dependencies [7910610]
- Updated dependencies [1b99d7a]
- Updated dependencies [c83e9e0]
- Updated dependencies [af2ae98]
- Updated dependencies [c4117e4]
- Updated dependencies [1e721cd]
- Updated dependencies [854e309]
- Updated dependencies [854e309]
- Updated dependencies [0da0398]
- Updated dependencies [05c3122]
  - @infrabyx/tenancy@1.9.0
  - @infrabyx/contracts@1.15.0
  - @infrabyx/config@1.6.0
  - @infrabyx/crypto@1.4.0
  - @infrabyx/ai@1.0.20

## 1.0.19

### Patch Changes

- Updated dependencies [97e8524]
- Updated dependencies [e41c3bd]
- Updated dependencies [92706c4]
- Updated dependencies [92706c4]
- Updated dependencies [4a87754]
- Updated dependencies [d66ffad]
  - @infrabyx/contracts@1.14.0
  - @infrabyx/tenancy@1.8.0
  - @infrabyx/ai@1.0.19
  - @infrabyx/config@1.5.2
  - @infrabyx/crypto@1.3.1

## 1.0.18

### Patch Changes

- Updated dependencies [32b53ee]
- Updated dependencies [cff2a02]
  - @infrabyx/crypto@1.3.0
  - @infrabyx/contracts@1.13.0
  - @infrabyx/ai@1.0.18
  - @infrabyx/config@1.5.1
  - @infrabyx/tenancy@1.7.2

## 1.0.17

### Patch Changes

- Updated dependencies [63c5ad2]
- Updated dependencies [63c5ad2]
  - @infrabyx/config@1.5.0
  - @infrabyx/contracts@1.12.0
  - @infrabyx/ai@1.0.17
  - @infrabyx/tenancy@1.7.1
  - @infrabyx/crypto@1.2.7

## 1.0.16

### Patch Changes

- Updated dependencies [2e3a2d3]
- Updated dependencies [2e3a2d3]
- Updated dependencies [3f20011]
- Updated dependencies [3f20011]
  - @infrabyx/contracts@1.11.0
  - @infrabyx/tenancy@1.7.0
  - @infrabyx/ai@1.0.16
  - @infrabyx/config@1.4.1
  - @infrabyx/crypto@1.2.6

## 1.0.15

### Patch Changes

- Updated dependencies [138ae44]
- Updated dependencies [138ae44]
- Updated dependencies [138ae44]
  - @infrabyx/config@1.4.0
  - @infrabyx/contracts@1.10.0
  - @infrabyx/tenancy@1.6.0
  - @infrabyx/ai@1.0.15
  - @infrabyx/crypto@1.2.5

## 1.0.14

### Patch Changes

- Updated dependencies [2b307e0]
- Updated dependencies [2b307e0]
  - @infrabyx/contracts@1.9.0
  - @infrabyx/tenancy@1.5.0
  - @infrabyx/ai@1.0.14
  - @infrabyx/config@1.3.2
  - @infrabyx/crypto@1.2.4

## 1.0.13

### Patch Changes

- Updated dependencies [cd25633]
- Updated dependencies [cd25633]
  - @infrabyx/contracts@1.8.0
  - @infrabyx/tenancy@1.4.0
  - @infrabyx/ai@1.0.13
  - @infrabyx/config@1.3.1
  - @infrabyx/crypto@1.2.3

## 1.0.12

### Patch Changes

- Updated dependencies [94b706e]
  - @infrabyx/config@1.3.0
  - @infrabyx/ai@1.0.12
  - @infrabyx/tenancy@1.3.5

## 1.0.11

### Patch Changes

- Updated dependencies [f5622c9]
- Updated dependencies [f5622c9]
  - @infrabyx/config@1.2.0
  - @infrabyx/contracts@1.7.0
  - @infrabyx/ai@1.0.11
  - @infrabyx/tenancy@1.3.4
  - @infrabyx/crypto@1.2.2

## 1.0.10

### Patch Changes

- Updated dependencies [ceabe3b]
  - @infrabyx/contracts@1.6.0
  - @infrabyx/ai@1.0.10
  - @infrabyx/config@1.1.1
  - @infrabyx/crypto@1.2.1
  - @infrabyx/tenancy@1.3.3

## 1.0.9

### Patch Changes

- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
  - @infrabyx/config@1.1.0
  - @infrabyx/contracts@1.5.0
  - @infrabyx/crypto@1.2.0
  - @infrabyx/ai@1.0.9
  - @infrabyx/tenancy@1.3.2

## 1.0.8

### Patch Changes

- Updated dependencies [7e38652]
- Updated dependencies [7e38652]
  - @infrabyx/contracts@1.4.0
  - @infrabyx/crypto@1.1.0
  - @infrabyx/ai@1.0.8
  - @infrabyx/config@1.0.6
  - @infrabyx/tenancy@1.3.1

## 1.0.7

### Patch Changes

- Updated dependencies [b6058d3]
- Updated dependencies [b6058d3]
  - @infrabyx/contracts@1.3.0
  - @infrabyx/tenancy@1.3.0
  - @infrabyx/ai@1.0.7
  - @infrabyx/config@1.0.5
  - @infrabyx/crypto@1.0.3

## 1.0.6

### Patch Changes

- Updated dependencies [1c869a8]
  - @infrabyx/config@1.0.4
  - @infrabyx/ai@1.0.6
  - @infrabyx/tenancy@1.2.1

## 1.0.5

### Patch Changes

- Updated dependencies [75e9ea4]
- Updated dependencies [75e9ea4]
  - @infrabyx/contracts@1.2.0
  - @infrabyx/tenancy@1.2.0
  - @infrabyx/ai@1.0.5
  - @infrabyx/config@1.0.3
  - @infrabyx/crypto@1.0.2

## 1.0.4

### Patch Changes

- Updated dependencies [c0ce8ff]
- Updated dependencies [2724cd6]
  - @infrabyx/tenancy@1.1.3
  - @infrabyx/ai@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [8a2587e]
- Updated dependencies [8a2587e]
- Updated dependencies [8a2587e]
  - @infrabyx/ai@1.0.3
  - @infrabyx/config@1.0.2
  - @infrabyx/tenancy@1.1.2

## 1.0.2

### Patch Changes

- Updated dependencies [53a973c]
  - @infrabyx/tenancy@1.1.1
  - @infrabyx/ai@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [588b509]
- Updated dependencies [588b509]
  - @infrabyx/contracts@1.1.0
  - @infrabyx/tenancy@1.1.0
  - @infrabyx/ai@1.0.1
  - @infrabyx/config@1.0.1
  - @infrabyx/crypto@1.0.1

## 1.0.0

### Major Changes

- 9ec9a2c: 1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).

### Patch Changes

- Updated dependencies [9ec9a2c]
  - @infrabyx/ai@1.0.0
  - @infrabyx/config@1.0.0
  - @infrabyx/contracts@1.0.0
  - @infrabyx/crypto@1.0.0
  - @infrabyx/tenancy@1.0.0

## 0.2.1

### Patch Changes

- Updated dependencies [9d8cd8c]
- Updated dependencies [b3934f9]
  - @infrabyx/tenancy@0.6.0
  - @infrabyx/config@0.5.1
  - @infrabyx/ai@0.2.1

## 0.2.0

### Minor Changes

- de53086: Owner answers #37 and #40 (PL4-D-13).

  - New CLI `infrabyx-vidhi manifest-lint <dir or file>...`: add it to product CI over the skill manifests. It fails on a tool without an explicit `locked: true` or `locked: false`, and notes a `false` that the kernel locked list overrides (word matching stays the safety net). `lintManifest` is exported too.
  - `QaSampler` reads the governed, tighten-only settings `vidhi.qa.min_reviews`, `vidhi.qa.precision_floor` and `vidhi.qa.recall_floor` per tenant, never below the platform floor of 20 reviews and 0.8 (`QaSampler.floor(ctx)`). **Breaking:** the `floor` constructor option and `QA_DEFAULT_FLOOR` are removed; use `QA_PLATFORM_FLOOR`.

### Patch Changes

- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
- Updated dependencies [1fecf45]
- Updated dependencies [1fecf45]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [275d4ba]
- Updated dependencies [934355c]
- Updated dependencies [686d24b]
- Updated dependencies [686d24b]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [36338c3]
- Updated dependencies [934355c]
- Updated dependencies [b7de3c6]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
  - @infrabyx/ai@0.2.0
  - @infrabyx/config@0.5.0
  - @infrabyx/contracts@0.5.0
  - @infrabyx/tenancy@0.5.0
  - @infrabyx/crypto@0.4.1

## 0.1.0

### Minor Changes

- b205b1d: First release of the Vidhi kernel core (PL4 session 6, PL4-D-08): migration `vidhi/0001_init.sql`; `SkillRegistry`; the frozen locked-action list with product additions; product ceilings; `Autonomy` (effective level, R4 promotion with evidence, automatic demotion); `TaskRuntime` (the IPB-03 task state machine, approvals for locked actions and L2 writes, kill-switch sweep); `Vidhi.answer` with the persona prompts and reserved-advice hand-off; `aiLabel` and `assistantName`.
- 9af583a: Feedback, QA sampling, the daily digest and AI disclosure (PL4 session 8a, PL4-D-11): migration `vidhi/0004_feedback_qa_digest.sql`; `Feedback` with sealed corrections and the tenant reference set; `QaSampler` with deterministic sampling, owner reviews, precision and recall and demotion below the floor; `Digest` with the daily digest and the action log; `disclosure` and `Vidhi.disclose` for the AI label and the `ai_provenance` sidecar. The promotion evidence window is now compared in SQL, so rows written in a demotion's own transaction no longer count in the new window.
- 288ae44: MCP and knowledge notebooks (PL4 session 7b, PL4-D-10): `McpServer`, `McpToolRegistry` and `checkMcpHeaders` (MCP 2026-07-28, stateless; write and locked tools always wait for the product UI's approval, `IPB-VID-040`); `McpClient` with the narrowing allow-list, class ceilings and rates (`IPB-VID-041`); `Notebooks` with migration `vidhi/0003_notebooks.sql`, sealed sources, class aggregation, grounded outputs through `vidhi.notebook@1` with provenance and staleness, read-only platform notebooks and cross-tenant sharing as a locked action (`IPB-VID-060`); `TaskRuntime.callTool` takes `forceApproval`, and `TaskRuntime.status`.
- 183c532: Scheduled tasks and missions (PL4 session 7a, PL4-D-09): migration `vidhi/0002_missions_schedules.sql`; the in-house RRULE subset (`parseRecurrence`, `nextOccurrence`, DST-correct); `Scheduler` with recurring and event-triggered schedules, the cross-tenant due-run poller (`SVC_VIDHI_SCHED`), the permission re-check before every run, skip (`IPB-VID-020`) and pause (`IPB-VID-021`); `Missions` with the `vidhi.mission_plan@1` planner, budgets (`IPB-VID-070`), the mission level as a cap on its tasks and a lease for resumable runs; `TaskRuntime.create` takes `maxLevel`.

### Patch Changes

- Updated dependencies [2b07109]
- Updated dependencies [200b25a]
- Updated dependencies [c0b6d38]
- Updated dependencies [bfa324d]
- Updated dependencies [b205b1d]
- Updated dependencies [c0b6d38]
- Updated dependencies [f6e9a88]
- Updated dependencies [9af583a]
- Updated dependencies [200b25a]
- Updated dependencies [f6e9a88]
- Updated dependencies [f6e9a88]
- Updated dependencies [200b25a]
- Updated dependencies [9af583a]
- Updated dependencies [288ae44]
- Updated dependencies [b205b1d]
- Updated dependencies [183c532]
- Updated dependencies [f6e9a88]
- Updated dependencies [183c532]
- Updated dependencies [200b25a]
- Updated dependencies [b205b1d]
  - @infrabyx/contracts@0.4.0
  - @infrabyx/ai@0.1.0
  - @infrabyx/config@0.4.0
  - @infrabyx/crypto@0.4.0
  - @infrabyx/tenancy@0.4.0
