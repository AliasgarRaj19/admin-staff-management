CREATE TYPE "staff_account_status" AS ENUM (''invited'', ''active'', ''blocked'', ''removed'');
CREATE TYPE "staff_invitation_status" AS ENUM (''pending'', ''accepted'', ''revoked'', ''expired'');
CREATE TYPE "staff_password_reset_status" AS ENUM (''pending'', ''consumed'', ''revoked'', ''expired'');

CREATE TABLE "MasterAdmin" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "email" TEXT,
  "passwordHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT ''active'',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MasterAdmin_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MasterAdmin_username_key" ON "MasterAdmin"("username");
CREATE UNIQUE INDEX "MasterAdmin_email_key" ON "MasterAdmin"("email");

CREATE TABLE "MasterAdminRefreshToken" (
  "id" TEXT NOT NULL,
  "masterAdminId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "jti" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "replacedByTokenId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MasterAdminRefreshToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MasterAdminRefreshToken_tokenHash_key" ON "MasterAdminRefreshToken"("tokenHash");
CREATE UNIQUE INDEX "MasterAdminRefreshToken_jti_key" ON "MasterAdminRefreshToken"("jti");
CREATE UNIQUE INDEX "MasterAdminRefreshToken_replacedByTokenId_key" ON "MasterAdminRefreshToken"("replacedByTokenId");
ALTER TABLE "MasterAdminRefreshToken" ADD CONSTRAINT "MasterAdminRefreshToken_masterAdminId_fkey" FOREIGN KEY ("masterAdminId") REFERENCES "MasterAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StaffAccount" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "firstName" TEXT,
  "lastName" TEXT,
  "phone" TEXT,
  "passwordHash" TEXT,
  "roleName" TEXT NOT NULL DEFAULT ''Moderator'',
  "status" "staff_account_status" NOT NULL DEFAULT ''invited'',
  "isMasterAdmin" BOOLEAN NOT NULL DEFAULT false,
  "invitedAt" TIMESTAMP(3),
  "registeredAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "blockedAt" TIMESTAMP(3),
  "removedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StaffAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StaffAccount_email_key" ON "StaffAccount"("email");
CREATE UNIQUE INDEX "StaffAccount_single_master_uidx" ON "StaffAccount"("isMasterAdmin") WHERE "isMasterAdmin" = true;

CREATE TABLE "StaffRefreshToken" (
  "id" TEXT NOT NULL,
  "staffAccountId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "jti" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "replacedByTokenId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffRefreshToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StaffRefreshToken_tokenHash_key" ON "StaffRefreshToken"("tokenHash");
CREATE UNIQUE INDEX "StaffRefreshToken_jti_key" ON "StaffRefreshToken"("jti");
CREATE UNIQUE INDEX "StaffRefreshToken_replacedByTokenId_key" ON "StaffRefreshToken"("replacedByTokenId");
ALTER TABLE "StaffRefreshToken" ADD CONSTRAINT "StaffRefreshToken_staffAccountId_fkey" FOREIGN KEY ("staffAccountId") REFERENCES "StaffAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StaffInvitation" (
  "id" TEXT NOT NULL,
  "staffAccountId" TEXT,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "roleName" TEXT,
  "invitedById" TEXT,
  "status" "staff_invitation_status" NOT NULL DEFAULT ''pending'',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StaffInvitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StaffInvitation_tokenHash_key" ON "StaffInvitation"("tokenHash");
CREATE INDEX "StaffInvitation_email_idx" ON "StaffInvitation"("email");
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_staffAccountId_fkey" FOREIGN KEY ("staffAccountId") REFERENCES "StaffAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "StaffAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "StaffPasswordReset" (
  "id" TEXT NOT NULL,
  "staffAccountId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" "staff_password_reset_status" NOT NULL DEFAULT ''pending'',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StaffPasswordReset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StaffPasswordReset_tokenHash_key" ON "StaffPasswordReset"("tokenHash");
CREATE INDEX "StaffPasswordReset_staff_status_idx" ON "StaffPasswordReset"("staffAccountId", "status");
ALTER TABLE "StaffPasswordReset" ADD CONSTRAINT "StaffPasswordReset_staffAccountId_fkey" FOREIGN KEY ("staffAccountId") REFERENCES "StaffAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Role" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

CREATE TABLE "Permission" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "description" TEXT,
  "module" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

CREATE TABLE "RolePermission" (
  "roleId" TEXT NOT NULL,
  "permissionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId", "permissionId")
);
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StaffRole" (
  "staffAccountId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffRole_pkey" PRIMARY KEY ("staffAccountId", "roleId")
);
ALTER TABLE "StaffRole" ADD CONSTRAINT "StaffRole_staffAccountId_fkey" FOREIGN KEY ("staffAccountId") REFERENCES "StaffAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffRole" ADD CONSTRAINT "StaffRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StaffPermission" (
  "staffAccountId" TEXT NOT NULL,
  "permissionId" TEXT NOT NULL,
  "grantedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffPermission_pkey" PRIMARY KEY ("staffAccountId", "permissionId")
);
ALTER TABLE "StaffPermission" ADD CONSTRAINT "StaffPermission_staffAccountId_fkey" FOREIGN KEY ("staffAccountId") REFERENCES "StaffAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffPermission" ADD CONSTRAINT "StaffPermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffPermission" ADD CONSTRAINT "StaffPermission_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "StaffAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT,
  "actorStaffAccountId" TEXT,
  "action" TEXT NOT NULL,
  "resourceType" TEXT,
  "resourceId" TEXT,
  "result" TEXT NOT NULL,
  "metadata" JSONB,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_actorStaffAccountId_createdAt_idx" ON "AuditLog"("actorStaffAccountId", "createdAt");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorStaffAccountId_fkey" FOREIGN KEY ("actorStaffAccountId") REFERENCES "StaffAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
