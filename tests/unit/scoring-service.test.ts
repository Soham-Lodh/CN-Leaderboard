import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { AdjustScoreInput } from "@/lib/services/scoring";
import type { StaffContext } from "@/lib/auth/session";

/**
 * Integration test for the core concurrency guarantee (PRD §10: two
 * simultaneous assignments both persist with correct totals; a lead
 * cannot act outside their domain). Skipped wholesale when no database
 * is configured, so local unit runs stay hermetic and CI can enable it.
 */

const hasDb = Boolean(process.env.DATABASE_URL);

// server-only modules are loaded dynamically inside tests so vitest's
// Node runtime never evaluates the guard module itself.
let adjustScore!: (
  ctx: StaffContext,
  input: AdjustScoreInput,
  corrId: string,
) => Promise<ReturnType<Awaited<ReturnType<() => Promise<never>>>>> | unknown;

async function loadSut(): Promise<void> {
  if (!adjustScore) {
    const mod = await import("@/lib/services/scoring");
    adjustScore = mod.adjustScore as unknown as typeof adjustScore;
  }
}

let ctxLead: StaffContext;
let ctxPresident: StaffContext;
let domainA!: string;
let domainB!: string;

beforeAll(() => {
  if (!hasDb) return;
  domainA = process.env.__TEST_DOMAIN_A!;
  domainB = process.env.__TEST_DOMAIN_B!;
  ctxLead = {
    staffAccountId: process.env.__TEST_LEAD_ID!,
    email: "lead@kiit.ac.in",
    displayName: "Lead",
    globalRole: null,
    domainAssignments: [{ domainId: domainA, role: "LEAD" }],
    isGlobalLeader: false,
  };
  ctxPresident = {
    staffAccountId: process.env.__TEST_PRESIDENT_ID!,
    email: "president@kiit.ac.in",
    displayName: "President",
    globalRole: "PRESIDENT",
    domainAssignments: [],
    isGlobalLeader: true,
  };
});

afterAll(async () => {
  if (!hasDb) return;
  const { prisma } = await import("@/lib/db");
  await prisma.$disconnect();
});

describe.skipIf(!hasDb)("scoring service (needs a running database)", () => {
  function input(membershipId: string, delta: number, key: string): AdjustScoreInput {
    return { membershipId, delta, reason: null, idempotencyKey: key, source: "MANUAL" };
  }

  it("refuses a lead assigning points in another domain", async () => {
    await loadSut();
    const { prisma } = await import("@/lib/db");
    const membership = await prisma.domainMembership.findFirst({
      where: { domainId: domainB, status: "ACTIVE" },
      select: { id: true },
    });
    if (!membership) return; // requires the seed fixture to exercise this
    const result = (await adjustScore(
      ctxLead,
      input(membership.id, 10, "5e6f1e34-aaaa-4bbb-8ccc-000000000001"),
      "corr-1",
    )) as { ok: boolean; code?: string };
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("persists two concurrent assignments with a correct summed total", async () => {
    await loadSut();
    const { prisma } = await import("@/lib/db");
    const membership = await prisma.domainMembership.findFirst({
      where: { domainId: domainA, status: "ACTIVE" },
      select: { id: true, currentPoints: true },
    });
    if (!membership) return;
    const start = membership.currentPoints;
    const [a, b] = (await Promise.all([
      adjustScore(ctxPresident, input(membership.id, 10, "22222222-2222-4222-8222-000000000001"), "corr-2"),
      adjustScore(ctxPresident, input(membership.id, 25, "22222222-2222-4222-8222-000000000002"), "corr-3"),
    ])) as [{ ok: boolean }, { ok: boolean }];
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const total = await prisma.domainMembership.findUniqueOrThrow({
      where: { id: membership.id },
      select: { currentPoints: true },
    });
    expect(total.currentPoints).toBe(start + 35);
  });

  it("replays the same idempotency key as one event", async () => {
    await loadSut();
    const { prisma } = await import("@/lib/db");
    const membership = await prisma.domainMembership.findFirst({
      where: { domainId: domainA, status: "ACTIVE" },
      select: { id: true },
    });
    if (!membership) return;
    const key = "22222222-2222-4222-8222-000000000003";
    const first = (await adjustScore(ctxPresident, input(membership.id, 5, key), "corr-4")) as {
      ok: boolean;
      data?: { currentPoints: number };
    };
    expect(first.ok).toBe(true);
    if (first.ok && first.data) {
      const replay = (await adjustScore(ctxPresident, input(membership.id, 5, key), "corr-5")) as {
        ok: boolean;
        data?: { replayed: boolean; currentPoints: number };
      };
      expect(replay.ok).toBe(true);
      if (replay.ok && replay.data) {
        expect(replay.data.replayed).toBe(true);
        expect(replay.data.currentPoints).toBe(first.data.currentPoints);
      }
    }
  });
});
