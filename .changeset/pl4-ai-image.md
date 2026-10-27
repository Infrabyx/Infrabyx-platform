---
"@infrabyx/ai": minor
---

IMAGE_GEN (PL4 session 5, PL4-D-07; OWN-10): migration `ai/0004_image.sql` and `ImageService`. Images are generated only for the permitted uses, never of real people, customers, regulators, courts or documents passing as genuine (`IPB-AI-030`); each is labelled ("AI-generated image" band, XMP, `Infrabyx-SGI` statement) before it is stored, or refused (`IPB-AI-031`). Publishing needs an R2 approval by a content role (`requestPublish`); the CMS calls `assertPublishable` (`IPB-AI-031`, `IPB-AI-032`). `SpeechGateway` answers `IPB-AI-010` until a SPEECH adapter exists.
