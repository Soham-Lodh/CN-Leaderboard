import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { AdjustScoreInput } from "@/lib/services/scoring";
import type { StaffContext } from "@/lib/auth/session";

/**
 * Concurrency/authorization checks for the scoring service against a
 * real database. The suite creates its OWN fixture (domain + member +
 * membership, unique keys per run) and cleans up compensatingly, so it
 * is safe to run against a shared database the owner opted into.
 *
 * No values from any env file are printed anywhere.
 */

// The vitest worker may not inherit the config-loaded .env; load the
// project configuration explicitly.
function ensureProjectEnv(): void {
  try {
    for (const rawLine of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      const eq = line.indexOf("=");
      if (!line || line.startsWith("#") || eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (!/^[A-Z0-9_]+$/.test(key)) continue;
      const value = line
        .slice(eq + 1)
        .trim()
        .replace(/^["']/, "")
        .replace(/["']$/, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    /* no .env */
  }
}
ensureProjectEnv();

const hasDb = Boolean(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL);

type ScoringMod = typeof import("@/lib/services/scoring");
type MembersMod = typeof import("@/lib/services/members");
type Driver = typeof import("../integration/_driver");

let adjustScore!: ScoringMod["adjustScore"];
let driver!: Driver;
let members!: MembersMod;

let ctxLead: StaffContext;
let ctxPresident: StaffContext;
let domainA!: string; // lead's domain: holds the fixture membership
let domainB!: string; // a different domain: lead must be refused here
let fixtureMembershipId!: string;

const created = { domainIds: [] as string[], staffEmails: [] as string[], memberIds: [] as string[] };
let actorEmail = "";
let leadEmail = "";
const unique = () => `ut${Date.now().toString(36)}${randomUUID().slice(0, 8).replace(/-/g, "")}`;

beforeAll(async () => {
  ensureProjectEnv();
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL) as string;
  if (!process.env.DATABASE_URL) return;

  driver = await import("../integration/_driver");
  const scoringMod = await import("@/lib/services/scoring");
  members = await import("@/lib/services/members");
  adjustScore = scoringMod.adjustScore;

  actorEmail = `unit-actor-${unique()}@example.edu`;
  leadEmail = `unit-lead-${unique()}@example.edu`;
  created.staffEmails.push(actorEmail, leadEmail);

  domainA = (await driver.makeDomain(unique())).id;
  domainB = (await driver.makeDomain(unique())).id;
  created.domainIds.push(domainA, domainB);

  ctxPresident = await driver.globalCtx(actorEmail);
  ctxLead = await driver.leadCtx(leadEmail, domainA);

  const roll = unique().toUpperCase(); // services uppercase-normalize rolls
  const added = await members.addMemberWithMembership(
    ctxPresident,
    domainA,
    { name: "Unit Scoring Probe", rollNumber: roll },
    `key-fixture-${unique()}`,
  );
  if (!added.ok) throw new Error(`fixture member add failed: ${added.message}`);
  created.memberIds.push(added.data.memberId);
  fixtureMembershipId = added.data.membershipId;
}, 60_000);

afterAll(async () => {
  if (!hasDb) return;
  await driver.cleanup(created);
}, 60_000);

describe.skipIf(!hasDb)("scoring service (needs a running database)", () => {
  function input(membershipId: string, delta: number, key: string): AdjustScoreInput {
    return { membershipId, delta, reason: null, idempotencyKey: key, source: "MANUAL" };
  }

  it("refuses a lead assigning points in another domain", async () => {
    const other = await members.listDomainMembers(domainB);
    let membershipId: string | null = other.find((m) => m.status === "ACTIVE")?.membershipId ?? null;
    if (!membershipId) {
      // No member exists yet in domainB: create one owned by the actor.
      const seed = await members.addMemberWithMembership(
        ctxPresident,
        domainB,
        { name: "Unit Scoring Neighbor", rollNumber: unique().toUpperCase() },
        `key-fixture-b-${unique()}`,
      );
      if (seed.ok) {
        created.memberIds.push(seed.data.memberId);
        membershipId = seed.data.membershipId;
      }
    }
    if (!membershipId) return; // cannot exercise the refusal without a membership
    const result = await adjustScore(ctxLead, input(membershipId, 10, randomUUID()), `corr-${unique()}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  }, 45_000);

  it("persists two concurrent assignments with a correct summed total", async () => {
    const membership = await members.listDomainMembers(domainA);
    const probe = membership.find((m) => m.membershipId === fixtureMembershipId && m.status === "ACTIVE");
    if (!probe) return;
    const start = probe.points;

    const keyA = randomUUID();
    const keyB = randomUUID();
    const results = await Promise.all([
      adjustScore(ctxLead, input(fixtureMembershipId, 10, keyA), `corr-${unique()}`),
      adjustScore(ctxLead, input(fixtureMembershipId, 25, keyB), `corr-${unique()}`),
    ]);
    expect(results[0]!.ok).toBe(true);
    expect(results[1]!.ok).toBe(true);

    const total = await members.listDomainMembers(domainA);
    const after = total.find((m) => m.membershipId === fixtureMembershipId);
    expect(after?.points).toBe(start + 35); // no lost update
  }, 45_000);

  it("replays the same idempotency key as one event", async () => {
    const membership = await members.listDomainMembers(domainA);
    const probe = membership.find((m) => m.membershipId === fixtureMembershipId && m.status === "ACTIVE");
    if (!probe) return;
    // Fresh key per run: replaying is safe, re-running this test is not
    // poisoned by a previous shared-database run's stored key.
    const key = randomUUID();
    const first = await adjustScore(ctxLead, input(fixtureMembershipId, 5, key), `corr-${unique()}`);
    expect(first.ok, first.ok ? "scored" : `${first.code}: ${first.message}`).toBe(true);
    const startPoints = first.ok ? first.data.currentPoints : undefined;
    const replay = await adjustScore(ctxLead, input(fixtureMembershipId, 5, key), `corr-${unique()}`);
    expect(replay.ok).toBe(true);
    if (replay.ok && typeof startPoints === "number") {
      expect(replay.data.replayed).toBe(true);
      expect(replay.data.currentPoints).toBe(startPoints);
    }
  }, 45_000);
});
