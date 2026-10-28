// Shared page parts: what a page shows when the API refuses the call (signed out, a second factor
// needed, not allowed) or cannot be reached. Problems never carry stack traces or hosts.
import { ButtonLink, Notice } from "@infrabyx/ui";
import type { Problem } from "./api.ts";

export function ProblemView({ problem }: { problem: Problem }) {
  if (problem.status === 401)
    return (
      <Notice tone="info" title="Sign in to continue">
        <p>
          <ButtonLink href="/auth/login" variant="primary">
            Sign in
          </ButtonLink>
        </p>
      </Notice>
    );
  if (problem.code === "IPB-SEC-001")
    return (
      <Notice tone="warning" title="Your role needs a second factor">
        <p>
          Sign out, then sign in again with the code from your authenticator app. The first sign-in
          only set the authenticator up.
        </p>
      </Notice>
    );
  return (
    <Notice tone="danger" title={problem.title}>
      {problem.detail ? <p>{problem.detail}</p> : null}
    </Notice>
  );
}
