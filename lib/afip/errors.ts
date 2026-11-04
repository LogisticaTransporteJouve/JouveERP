// Typed error hierarchy for AFIP web service calls.
//
// The action layer matches on `code` to decide whether to surface the message
// to the user, retry, or escalate. Keeping the codes stable means changing
// the parser internals never breaks downstream callsites.
//
// Categories (mirrors arca.ts conventions):
//   - CONFIG     — env vars, cert/key shape, endpoint setup
//   - INPUT      — caller-provided data fails our own validation
//   - TRANSPORT  — fetch/network/HTTP error before we have a SOAP body
//   - SOAP_FAULT — server returned a `Fault` envelope
//   - SERVICE    — WSFE returned an `Errors` array (business validation)
//
// Only TRANSPORT is safe to retry. SOAP_FAULT and SERVICE are deterministic.

export type AfipErrorCode =
  | "CONFIG"
  | "INPUT"
  | "TRANSPORT"
  | "SOAP_FAULT"
  | "SERVICE";

export class AfipError extends Error {
  readonly code: AfipErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: AfipErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AfipError";
    this.code = code;
    this.details = details;
  }
}

export class AfipConfigError extends AfipError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("CONFIG", message, details);
    this.name = "AfipConfigError";
  }
}

export class AfipInputError extends AfipError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("INPUT", message, details);
    this.name = "AfipInputError";
  }
}

export class AfipTransportError extends AfipError {
  readonly httpStatus?: number;

  constructor(
    message: string,
    httpStatus?: number,
    details?: Record<string, unknown>,
  ) {
    super("TRANSPORT", message, details);
    this.name = "AfipTransportError";
    this.httpStatus = httpStatus;
  }
}

export class AfipSoapFaultError extends AfipError {
  readonly faultString: string;

  constructor(faultString: string, details?: Record<string, unknown>) {
    super("SOAP_FAULT", `SOAP fault: ${faultString}`, details);
    this.name = "AfipSoapFaultError";
    this.faultString = faultString;
  }
}

export interface AfipServiceErrorEntry {
  code: number;
  message: string;
}

export class AfipServiceError extends AfipError {
  readonly errors: AfipServiceErrorEntry[];

  constructor(errors: AfipServiceErrorEntry[]) {
    const summary = errors
      .map((e) => `[${e.code}] ${e.message}`)
      .join("; ");
    super("SERVICE", summary || "AFIP service error", { errors });
    this.name = "AfipServiceError";
    this.errors = errors;
  }
}
