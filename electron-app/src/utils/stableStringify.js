/**
 * Deterministic JSON.stringify for nested objects (sorted keys) so we can
 * compare "current" vs "saved" settings after the user edits and reverts.
 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']'
  }
  const keys = Object.keys(value).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}'
}
