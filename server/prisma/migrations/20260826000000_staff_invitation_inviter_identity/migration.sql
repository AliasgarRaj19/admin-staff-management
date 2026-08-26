ALTER TABLE "StaffInvitation" DROP CONSTRAINT IF EXISTS "StaffInvitation_invitedById_fkey";

ALTER TABLE "StaffInvitation"
ADD COLUMN IF NOT EXISTS "invitedByType" TEXT NOT NULL DEFAULT 'master_admin';
