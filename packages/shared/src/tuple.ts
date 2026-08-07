/**
 * Narrows a non-empty readonly string array to a mutable tuple type
 * that Zod's `z.enum` accepts, after a runtime emptiness check.
 */
export function asNonEmptyStringTuple<T extends string>(values: readonly T[]): [T, ...T[]] {
  const first = values[0];
  if (first === undefined) {
    throw new Error('Expected a non-empty string tuple');
  }
  return [first, ...values.slice(1)];
}
