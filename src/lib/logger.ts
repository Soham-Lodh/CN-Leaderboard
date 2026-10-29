import "server-only";
import { newCorrelationId } from "./ids";

type Level = "info" | "warn" | "error";

/**
 * Structured server logs without private data. Never log tokens,
 * cookies, database URLs, bootstrap secrets or member-identifying
 * payloads beyond the identifiers that operators already need.
 */
export interface LogFields {
  corrId?: string;
  actorId?: string;
  domainId?: string;
  action?: string;
  [key: string]: unknown;
}

function emit(level: Level, event: string, fields: LogFields, error?: unknown) {
  const base = {
    ts: new Date().toISOString(),
    level,
    event,
    corrId: fields.corrId ?? newCorrelationId(),
    ...fields,
  };
  const line = JSON.stringify(base);
  if (level === "error" && error !== undefined) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error && process.env.NODE_ENV !== "production" ? error.stack : undefined;
    console.error(line, JSON.stringify({ message, stack }));
  } else {
    console[level](line);
  }
}

export const logger = {
  info: (event: string, fields: LogFields = {}) => emit("info", event, fields),
  warn: (event: string, fields: LogFields = {}) => emit("warn", event, fields),
  error: (event: string, fields: LogFields = {}, error?: unknown) => {
    emit("error", event, fields, error);
  },
};
