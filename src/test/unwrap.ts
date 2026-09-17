import type { Result } from "@/domain/errors";

/** Test helper: assert a Result is ok and return its value. */
export function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error.code} ${r.error.message}`);
  return r.value;
}

/** Test helper: assert a Result is an error and return it. */
export function expectErr<T>(r: Result<T>): { code: string; field?: string; message: string } {
  if (r.ok) throw new Error("expected an error result, got ok");
  return r.error;
}
