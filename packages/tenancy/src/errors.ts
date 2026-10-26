// Errors without an IPB catalogue code. Not-found answers 404 rather than 403 so that object
// existence is not disclosed (IPB-02-14).
export class NotFoundError extends Error {
  readonly status = 404;
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** A statement the kernel refuses to run inside a transaction (session-level SET and similar). */
export class KernelGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KernelGuardError";
  }
}
