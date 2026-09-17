/** Typed command outcomes — contract 48.2. */
export type ErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "STORAGE_UNAVAILABLE"
  | "QUOTA_EXCEEDED"
  | "SCHEMA_UNSUPPORTED"
  | "AI_UNAVAILABLE"
  | "AI_TIMEOUT"
  | "AI_INVALID_RESPONSE"
  | "CANCELLED";

export interface DomainError {
  code: ErrorCode;
  /** Field path when the error is about one input field. */
  field?: string;
  /** Application-authored, safe to show. Never contains secrets or stack traces. */
  message: string;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: DomainError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const err = (
  code: ErrorCode,
  message: string,
  field?: string,
): Result<never> => ({ ok: false, error: { code, message, field } });

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}
