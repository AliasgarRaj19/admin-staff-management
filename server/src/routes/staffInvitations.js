import { acceptInvitation, validateInvitation } from "../services/staffOnboarding.js";

export function buildStaffInvitationRoutes({ repository, hashPasswordFn, audit }) {
  return {
    async validateInvitation(token, now) {
      return validateInvitation({ repository, token, now });
    },
    async acceptInvitation(payload) {
      return acceptInvitation({ repository, hashPasswordFn, audit, ...payload });
    },
  };
}
