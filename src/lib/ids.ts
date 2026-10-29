import { createHash, randomUUID } from "crypto";
import { canonicalize } from "./normalize";

export function newId(): string {
  return randomUUID();
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Canonical request hash used by idempotency conflict detection. */
export function requestHash(value: unknown): string {
  return sha256Hex(canonicalize(value));
}

/** Correlation ID for request tracing: some random hex, short. */
export function newCorrelationId(): string {
  return randomUUID().slice(0, 8);
}
