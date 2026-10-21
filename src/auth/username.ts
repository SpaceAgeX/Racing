/** Public account name: case-insensitive uniqueness is enforced in Postgres. */
export function usernameError(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(value.trim())) {
    return 'Use 3–20 characters: start with a letter, then letters, numbers, or underscores.';
  }
  return null;
}
