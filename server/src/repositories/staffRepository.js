export function createStaffRepository(db) {
  return {
    async findStaffByEmail(email) {
      return db.staffAccount.findUnique({ where: { email } });
    },
    async findStaffById(id) {
      return db.staffAccount.findUnique({ where: { id } });
    },
    async findPendingInvitationByStaffAccountId(staffAccountId) {
      return db.staffInvitation.findFirst({ where: { staffAccountId, status: "pending" } });
    },
    async findInvitationByTokenHash(tokenHash) {
      return db.staffInvitation.findUnique({ where: { tokenHash } });
    },
    async invalidatePendingInvitations(staffAccountId, now) {
      return db.staffInvitation.updateMany({
        where: { staffAccountId, status: "pending" },
        data: { status: "revoked", revokedAt: now, updatedAt: now },
      });
    },
    async createStaffAccount(data) {
      return db.staffAccount.create({ data });
    },
    async updateStaffAccount(id, data) {
      return db.staffAccount.update({ where: { id }, data });
    },
    async createInvitation(data) {
      return db.staffInvitation.create({ data });
    },
    async updateInvitation(id, data) {
      return db.staffInvitation.update({ where: { id }, data });
    },
    async revokeInvitation(id, now) {
      return db.staffInvitation.update({ where: { id }, data: { status: "revoked", revokedAt: now, updatedAt: now } });
    },
    async insertAuditLog(data) {
      return db.auditLog.create({ data });
    },
    async withTransaction(work) {
      return db.$transaction(work);
    },
  };
}
