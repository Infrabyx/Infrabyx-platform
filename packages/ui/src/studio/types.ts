// Shared types of the Studio screens (PL5 plan §9.6; OWNER-QUESTIONS #41). A screen takes a service
// object, the request's context and form actions. The services are typed structurally here
// (`@infrabyx/ui` sits below `brand`, `cms`, `consent`, `feedback` and `trust`), so each package's
// own Studio service satisfies them without `ui` importing it; `apps/console` proves that at type
// check. Role checks, maker-checker and lint stay in the services: a screen only shows and posts.

/** A form's action: a URL (POST) or a server action. Both work without JavaScript. */
export type FormAction = string | ((formData: FormData) => void | Promise<void>);

export type FlashTone = "success" | "warning" | "danger" | "info";

/** A one-off notice after an action (carried across the redirect, see `flash.ts`). */
export interface Flash {
  tone: FlashTone;
  title: string;
  detail?: string;
}

/** A field-level error, linked from the error summary (IPB-06 SC 3.3.1). */
export interface FieldError {
  fieldId: string;
  message: string;
}

/** What a handler returns: the notice, any field errors, and where to go next. */
export interface StudioResult {
  flash: Flash;
  errors?: FieldError[];
  /** A path under the Studio base (for example the new item's editor). */
  redirectTo?: string;
  /** A value to show once (a preview link). Never a secret: preview tokens expire. */
  reveal?: string;
}

/** Common props of every screen. */
export interface ScreenProps<C> {
  ctx: C;
  /** Where the Studio is mounted (`/studio`). */
  base: string;
  flash?: Flash | null;
  errors?: readonly FieldError[];
}
