/** Scoring limits (PRD §7): integer deltas per event, zero excluded. */
export const MAX_DELTA = 1000;
export const MIN_DELTA = -1000;
export const MAX_REASON_LENGTH = 200;

/** Import/export operational limits (documented in README; PRD targets). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;
export const EXPORT_DEFAULT_ACTIVE_ONLY = true;

/** /admin?denied= messages. Generic on purpose — no account enumeration. */
export const GATE_MESSAGES = {
  not_appointed:
    "This Google account is signed in but is not appointed to an active staff role for this chapter.",
  revoked: "Your staff access has been revoked. Contact the chapter President.",
  error: "Sign-in did not complete. Please try again.",
} as const;

export type GateDeniedReason = keyof typeof GATE_MESSAGES;
