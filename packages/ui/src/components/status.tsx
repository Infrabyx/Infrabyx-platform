// Status messages and labels (IPB-06 SC 4.1.3, 1.4.1; IPB-13-04). Live regions are polite for
// status and assertive (`role="alert"`) only for errors; status always pairs an icon with text.
import type { ReactNode } from "react";
import { messages, type Messages } from "../i18n/messages.js";

const en = messages("en-IN");

export function LiveRegion({
  children,
  politeness = "polite",
  id,
}: {
  children?: ReactNode;
  politeness?: "polite" | "assertive";
  id?: string;
}) {
  return politeness === "assertive" ? (
    <div className="ibx-live" role="alert" id={id}>
      {children}
    </div>
  ) : (
    <div className="ibx-live" role="status" aria-live="polite" id={id}>
      {children}
    </div>
  );
}

const ICON: Record<"success" | "warning" | "danger" | "info", string> = {
  success: "✓",
  warning: "!",
  danger: "✕",
  info: "i",
};

/** A status notice: icon and text, never colour alone. */
export function Notice({
  tone,
  title,
  children,
}: {
  tone: "success" | "warning" | "danger" | "info";
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={`ibx-notice ibx-notice--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <span className="ibx-notice__icon" aria-hidden="true">
        {ICON[tone]}
      </span>
      <div>
        <p className="ibx-notice__title">{title}</p>
        {children}
      </div>
    </div>
  );
}

/** The AI label; the text comes from `@infrabyx/vidhi` `disclosure` (IPB-03-53, IPB-13-04). */
export function AiLabel({ text, t = en }: { text?: string; t?: Messages }) {
  return <span className="ibx-ai-label">{text ?? t.t("ui.ai.label")}</span>;
}
