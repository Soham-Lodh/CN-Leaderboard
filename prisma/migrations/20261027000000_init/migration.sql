-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "GlobalRole" AS ENUM ('PRESIDENT', 'VICE_PRESIDENT');

-- CreateEnum
CREATE TYPE "DomainRole" AS ENUM ('LEAD', 'CO_LEAD');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "ScoreSource" AS ENUM ('MANUAL', 'IMPORT', 'CORRECTION');

-- CreateTable
CREATE TABLE "StaffAccount" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "authUserId" TEXT,
    "displayName" TEXT,
    "status" "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "StaffAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalRoleAssignment" (
    "id" TEXT NOT NULL,
    "staffAccountId" TEXT NOT NULL,
    "role" "GlobalRole" NOT NULL,
    "appointedById" TEXT,
    "appointedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "GlobalRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainAssignment" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "staffAccountId" TEXT NOT NULL,
    "role" "DomainRole" NOT NULL,
    "appointedById" TEXT,
    "appointedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "DomainAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "rollNumber" VARCHAR(60) NOT NULL,
    "normalizedRollNumber" VARCHAR(60) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainMembership" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPoints" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,

    CONSTRAINT "DomainMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreEntry" (
    "id" TEXT NOT NULL,
    "domainMembershipId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" VARCHAR(200),
    "actorStaffAccountId" TEXT NOT NULL,
    "actorEmailSnapshot" VARCHAR(320),
    "source" "ScoreSource" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorStaffAccountId" TEXT,
    "actorEmailSnapshot" VARCHAR(320),
    "action" VARCHAR(64) NOT NULL,
    "targetType" VARCHAR(32) NOT NULL,
    "targetId" TEXT NOT NULL,
    "domainId" TEXT,
    "beforeState" JSONB,
    "afterState" JSONB,
    "requestId" VARCHAR(64) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "actorStaffAccountId" TEXT NOT NULL,
    "key" VARCHAR(72) NOT NULL,
    "operation" VARCHAR(32) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'RESERVED',
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "actorStaffAccountId" TEXT NOT NULL,
    "filename" VARCHAR(200) NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "membershipsCreated" INTEGER NOT NULL DEFAULT 0,
    "membershipsReactivated" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "rowsInvalid" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffAccount_email_key" ON "StaffAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAccount_authUserId_key" ON "StaffAccount"("authUserId");

-- CreateIndex
CREATE INDEX "StaffAccount_status_idx" ON "StaffAccount"("status");

-- CreateIndex
CREATE INDEX "GlobalRoleAssignment_staffAccountId_revokedAt_idx" ON "GlobalRoleAssignment"("staffAccountId", "revokedAt");

-- CreateIndex
CREATE INDEX "GlobalRoleAssignment_role_revokedAt_idx" ON "GlobalRoleAssignment"("role", "revokedAt");

-- CreateIndex
CREATE INDEX "DomainAssignment_domainId_role_revokedAt_idx" ON "DomainAssignment"("domainId", "role", "revokedAt");

-- CreateIndex
CREATE INDEX "DomainAssignment_staffAccountId_revokedAt_idx" ON "DomainAssignment"("staffAccountId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_name_key" ON "Domain"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_slug_key" ON "Domain"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Member_normalizedRollNumber_key" ON "Member"("normalizedRollNumber");

-- CreateIndex
CREATE INDEX "Member_archivedAt_idx" ON "Member"("archivedAt");

-- CreateIndex
CREATE INDEX "DomainMembership_domainId_status_currentPoints_idx" ON "DomainMembership"("domainId", "status", "currentPoints" DESC);

-- CreateIndex
CREATE INDEX "DomainMembership_memberId_idx" ON "DomainMembership"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "DomainMembership_domainId_memberId_key" ON "DomainMembership"("domainId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreEntry_idempotencyKey_key" ON "ScoreEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ScoreEntry_domainMembershipId_createdAt_idx" ON "ScoreEntry"("domainMembershipId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ScoreEntry_actorStaffAccountId_createdAt_idx" ON "ScoreEntry"("actorStaffAccountId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_domainId_createdAt_idx" ON "AuditEvent"("domainId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_targetType_targetId_createdAt_idx" ON "AuditEvent"("targetType", "targetId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_actorStaffAccountId_createdAt_idx" ON "AuditEvent"("actorStaffAccountId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_actorStaffAccountId_key_operation_key" ON "IdempotencyRecord"("actorStaffAccountId", "key", "operation");

-- CreateIndex
CREATE INDEX "ImportBatch_domainId_createdAt_idx" ON "ImportBatch"("domainId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "GlobalRoleAssignment" ADD CONSTRAINT "GlobalRoleAssignment_staffAccountId_fkey" FOREIGN KEY ("staffAccountId") REFERENCES "StaffAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainAssignment" ADD CONSTRAINT "DomainAssignment_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainAssignment" ADD CONSTRAINT "DomainAssignment_staffAccountId_fkey" FOREIGN KEY ("staffAccountId") REFERENCES "StaffAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainMembership" ADD CONSTRAINT "DomainMembership_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainMembership" ADD CONSTRAINT "DomainMembership_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEntry" ADD CONSTRAINT "ScoreEntry_domainMembershipId_fkey" FOREIGN KEY ("domainMembershipId") REFERENCES "DomainMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEntry" ADD CONSTRAINT "ScoreEntry_actorStaffAccountId_fkey" FOREIGN KEY ("actorStaffAccountId") REFERENCES "StaffAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorStaffAccountId_fkey" FOREIGN KEY ("actorStaffAccountId") REFERENCES "StaffAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_actorStaffAccountId_fkey" FOREIGN KEY ("actorStaffAccountId") REFERENCES "StaffAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_actorStaffAccountId_fkey" FOREIGN KEY ("actorStaffAccountId") REFERENCES "StaffAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------
-- Invariant enforcement beyond Prisma's schema (see TRD §5.2)
-- ---------------------------------------------------------------------

-- One current global role per staff account.
CREATE UNIQUE INDEX "GlobalRoleAssignment_one_active_per_staff"
  ON "GlobalRoleAssignment"("staffAccountId")
  WHERE "revokedAt" IS NULL;

-- One active Lead and one active Co-lead per domain (v1 assumption).
CREATE UNIQUE INDEX "DomainAssignment_one_active_role_per_domain"
  ON "DomainAssignment"("domainId", "role")
  WHERE "revokedAt" IS NULL;

-- One active domain role per staff per domain.
CREATE UNIQUE INDEX "DomainAssignment_one_active_per_staff_domain"
  ON "DomainAssignment"("domainId", "staffAccountId")
  WHERE "revokedAt" IS NULL;

-- Signed nonzero bounded deltas (mirrors the Zod validation).
ALTER TABLE "ScoreEntry" ADD CONSTRAINT "ScoreEntry_delta_check"
  CHECK ("delta" <> 0 AND "delta" BETWEEN -1000 AND 1000);

-- Append-only history: block UPDATE/DELETE at the database level.
CREATE OR REPLACE FUNCTION prohibit_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; use compensating entries instead.', TG_TABLE_NAME
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER score_entry_no_update
  BEFORE UPDATE OR DELETE ON "ScoreEntry"
  FOR EACH ROW EXECUTE FUNCTION prohibit_history_mutation();

CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION prohibit_history_mutation();
