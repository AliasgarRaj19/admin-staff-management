const inFlight = new Map();

export async function restoreSessionOnce(role, restoreFn) {
  if (inFlight.has(role)) return inFlight.get(role);
  const promise = Promise.resolve()
    .then(() => restoreFn(role))
    .catch(() => null)
    .finally(() => {
      inFlight.delete(role);
    });
  inFlight.set(role, promise);
  return promise;
}

export function resetSessionRestoreForTests() {
  inFlight.clear();
}
