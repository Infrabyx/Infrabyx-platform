// The hello module's manifest (IPB-01-10, §01.4.3.2): one schema, one tenant table under forced
// RLS, its events, its registered setting and its help keys. `defineModule` parses it, so a wrong
// manifest fails at import time. The event types carry the product the template stands in for.
import { defineModule, type ModuleManifest } from "@infrabyx/contracts";

export const HELLO_SCHEMA = "hello";
export const HELLO_GREETING_TABLE = "hello.greeting";
export const HELLO_MAX_LENGTH_KEY = "hello.greeting.max_length";

export const HELLO_HELP_KEYS = {
  greeting: "hlp.hello.greeting",
  maxLength: "hlp.hello.greeting_max_length",
  retract: "hlp.hello.retract",
} as const;

export const HELLO_EVENTS = {
  created: "GreetingCreated",
  retracted: "GreetingRetracted",
  deleted: "GreetingDeleted",
} as const;

export function helloManifest(product: string): ModuleManifest {
  const p = product.toLowerCase();
  return defineModule({
    name: "hello",
    schema: HELLO_SCHEMA,
    boundedContext: "reference greetings",
    owner: "platform",
    publishes: Object.values(HELLO_EVENTS).map((e) => `in.${p}.hello.${e}.v1`),
    consumes: [],
    ports: [],
    settingsPrefix: "hello.",
    settings: [HELLO_MAX_LENGTH_KEY],
    helpKeys: Object.values(HELLO_HELP_KEYS),
    dataClasses: ["INTERNAL"],
    extractionReadiness: 3,
    rlsTables: [HELLO_GREETING_TABLE],
  });
}
