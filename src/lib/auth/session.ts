import "server-only";
import { prisma } from "../db";
import { env } from "../env";
import type { GlobalRole, DomainRole } from "@prisma/client";
import { createSupabaseServerClient } from "../supabase/server";
import { hasEmailSuffix, normalizeEmail } from "../normalize";
import { ensureBootstrapPresident } from "./bootstrap";

/**
 * Authenticated staff context. Identity comes exclusively from a
 * server-verified Supabase session; roles and domain scope come from
 * database rows. Nothing here ever accepts a client-supplied role,
 * actor id, or email.
 */
export interface StaffContext {
  staffAccountId: string;
  email: string;
  displayName: string | null;
  globalRole: GlobalRole | null;
  domainAssignments: Array<{ domainId: string; role: DomainRole }>;
  isGlobalLeader: boolean;
}

export interface ResolvedUser {
  authUserId: string;
  email: string;
  displayName: string | null;
}

/**
 * Verify the Supabase session server-side and resolve the pre-provisioned
 * active staff record. OAuth sign-in alone never grants access.
 */
export async function getAuthContext(): Promise<StaffContext | null> {
  await ensureBootstrapPresident();
  const user = await getVerifiedUser();
  if (!user) return null;

  const normalized = normalizeEmail(user.email);
  if (!hasEmailSuffix(normalized, env().ALLOWED_EMAIL_DOMAIN)) return null;

  // Resolve by the trusted auth subject first. The email fallback only
  // applies while the provisioned row is unlinked; a row already linked
  // to a DIFFERENT Google identity is left alone (no account takeover).
  let staff = await prisma.staffAccount.findFirst({
    where: { authUserId: user.authUserId, status: "ACTIVE" },
  });
  if (!staff) {
    const byEmail = await prisma.staffAccount.findFirst({
      where: { email: normalized, status: "ACTIVE" },
    });
    if (byEmail && byEmail.authUserId === null) staff = byEmail;
  }

  if (!staff) return null; // unappointed or revoked staff: denied

  // First successful link of the OAuth identity to the provisioned row.
  if (staff.authUserId !== user.authUserId || staff.lastLoginAt === null || staff.displayName !== user.displayName) {
    staff = await prisma.staffAccount.update({
      where: { id: staff.id },
      data: {
        authUserId: user.authUserId,
        lastLoginAt: new Date(),
        displayName: user.displayName ?? staff.displayName,
      },
    });
  }

  const [globalAssignment, domainAssignments] = await Promise.all([
    prisma.globalRoleAssignment.findFirst({
      where: { staffAccountId: staff.id, revokedAt: null },
      select: { role: true },
    }),
    prisma.domainAssignment.findMany({
      where: { staffAccountId: staff.id, revokedAt: null },
      select: { domainId: true, role: true },
    }),
  ]);

  const globalRole = globalAssignment?.role ?? null;
  return {
    staffAccountId: staff.id,
    email: staff.email,
    displayName: staff.displayName,
    globalRole,
    domainAssignments,
    isGlobalLeader: globalRole === "PRESIDENT" || globalRole === "VICE_PRESIDENT",
  };
}

/**
 * Server-verified Google/Supabase user with a verified institutional email.
 * Returns null for missing session, unverified email, or wrong domain.
 */
export async function getVerifiedUser(): Promise<ResolvedUser | null> {
  const supabase = await createSupabaseServerClient();
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    const user = data.user;
    const email = user.email;
    if (!email) return null;

    // Supabase Auth only issues sessions for verified providers, but we
    // still check the documented verification field defensively. Only a
    // COMPLETED confirmation (email_confirmed_at) counts —
    // confirmation_sent_at merely proves a verification mail was sent.
    if (!user.email_confirmed_at) return null;

    return {
      authUserId: user.id,
      email,
      displayName: (user.user_metadata?.["full_name"] as string | undefined) ?? null,
    };
  } catch {
    // No session cookie / invalid session counts as anonymous.
    return null;
  }
}
