import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useAnnounce, useReducedMotion, useShortcut, useTextScale } from "./index.js";

function Probe() {
  const reduced = useReducedMotion();
  const scale = useTextScale();
  const announce = useAnnounce();
  useShortcut("probe.open", "Open", "Ctrl+O", () => announce("opened"));
  return createElement("p", null, `motion:${reduced ? "reduced" : "full"} scale:${scale}`);
}

describe("hooks on the server", () => {
  it("render the defaults without touching window or document", () => {
    expect(renderToString(createElement(Probe))).toBe("<p>motion:full scale:100</p>");
  });
});
