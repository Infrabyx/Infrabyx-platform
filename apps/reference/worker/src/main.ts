#!/usr/bin/env node
// apps/worker: the same codebase as the API, started at its worker entrypoint (IPB-01 §01.4.2).
// The image's ENTRYPOINT runs this file; the environment and the services are the API's.
import "@infrabyx/reference-api/worker-main";
