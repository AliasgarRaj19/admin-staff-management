import { AUDIT_ACTOR_TYPES, AUDIT_RESULTS } from "../domain/audit.js";

export function buildAuditEvent({
  actorType = AUDIT_ACTOR_TYPES.SYSTEM,
  actorId = null,
  action,
  resourceType = null,
  resourceId = null,
  result = AUDIT_RESULTS.SUCCESS,
  metadata = null,
  ipAddress = null,
  userAgent = null,
}) {
  return { actorType, actorId, action, resourceType, resourceId, result, metadata, ipAddress, userAgent };
}

export async function recordAuditEvent(repository, event) {
  return repository.insertAuditLog(event);
}
