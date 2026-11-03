---
"@infrabyx/connectors": minor
"@infrabyx/config": minor
"@infrabyx/testing": minor
---

The `livekit` VIDEO_MEET reference adapter (`@infrabyx/connectors/video-meet`; owner answer #88, R1-D-44): a self-hosted LiveKit server called over its HTTP server API with C-26 tokens, the room's policy (India only, no anonymised origin, the official from the official network) enforced before a token is issued, webhooks verified and read back, and recordings moved from the egress disk to the room's STORAGE target with one locked single-part write each before the disk copy is removed. Off behind `int.video_meet.livekit.enabled` (`config`); the egress path is `unproven` until a deployment runs the egress worker. `testing`: the `livekit` test image and `videoMeetContractCases({ signWebhook })`. Compose: the `video` profile.
