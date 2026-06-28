import path from 'path'

// Serializes async operations that share a key so concurrent read-modify-write
// cycles (e.g. two writes to the same file path) cannot interleave and clobber
// each other. Each key maps to the tail of a promise chain: a new caller waits
// for the current tail to settle, runs its task, and becomes the new tail.

const chainTailByKey = new Map<string, Promise<unknown>>()

export const withKeyedLock = async <T>(key: string, task: () => Promise<T>): Promise<T> => {
  const previousTail = chainTailByKey.get(key) ?? Promise.resolve()

  // Run the task once the previous tail settles, regardless of its outcome.
  const result = previousTail.then(task, task)

  // The stored tail must never reject, or it would surface as an unhandled
  // rejection and the next caller's `.then` onRejected would fire prematurely.
  chainTailByKey.set(key, result.then(() => undefined, () => undefined))

  return result
}

// Normalizes a filesystem path into a stable lock key (case-insensitive on
// Windows) so different spellings of the same path share one lock.
export const normalizeLockKey = (targetPath: string): string => {
  const resolved = path.resolve(targetPath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
