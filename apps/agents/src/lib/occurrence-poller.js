/**
 * Executes one occurrence polling cycle without replacing previously displayed
 * occurrences when the API is temporarily unavailable.
 *
 * @template T
 * @param {() => Promise<readonly T[]>} loadOccurrences
 * @param {readonly T[]} lastOccurrences
 * @returns {Promise<{ occurrences: readonly T[], error: unknown | null }>}
 */
export async function pollOccurrenceCycle(loadOccurrences, lastOccurrences) {
  try {
    return { occurrences: await loadOccurrences(), error: null };
  } catch (error) {
    return { occurrences: lastOccurrences, error };
  }
}
