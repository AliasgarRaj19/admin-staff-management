import { createInvitation, resendInvitation, revokeInvitation } from "../services/staffOnboarding.js";

export function buildAdminStaffRoutes({ repository, clientUrl, sendEmail, audit }) {
  return {
    async createInvitation(payload) {
      return createInvitation({ repository, clientUrl, sendEmail, audit, ...payload });
    },
    async resendInvitation(payload) {
      return resendInvitation({ repository, clientUrl, sendEmail, audit, ...payload });
    },
    async revokeInvitation(payload) {
      return revokeInvitation({ repository, audit, ...payload });
    },
  };
}
