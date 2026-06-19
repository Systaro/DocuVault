/**
 * Single source of truth for the account password policy, mirroring the
 * server-side rule in AuthController (@Size(min = 8) + the complexity regex).
 * Keep this in sync with the backend so the UI never lets a password through
 * that the API will silently reject.
 */
export const PASSWORD_POLICY_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

export const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 8 characters and contain an uppercase letter, ' +
  'a lowercase letter, a number, and a special character.';

/**
 * Returns a human-readable error message if the password violates the policy,
 * or null if it is acceptable.
 */
export function validatePasswordPolicy(password: string): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (!PASSWORD_POLICY_REGEX.test(password)) {
    return PASSWORD_POLICY_MESSAGE;
  }
  return null;
}
