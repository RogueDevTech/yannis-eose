/**
 * Nigerian states + FCT. Used by:
 *   - Staff onboarding "Current state of residence" dropdown.
 *
 * Stored as the exact string in DB. If you change spelling here, existing rows
 * keep the prior value until staff re-save — keep names stable.
 */
export const NIGERIAN_STATES: ReadonlyArray<string> = [
  'Abia',
  'Adamawa',
  'Akwa Ibom',
  'Anambra',
  'Bauchi',
  'Bayelsa',
  'Benue',
  'Borno',
  'Cross River',
  'Delta',
  'Ebonyi',
  'Edo',
  'Ekiti',
  'Enugu',
  'FCT (Abuja)',
  'Gombe',
  'Imo',
  'Jigawa',
  'Kaduna',
  'Kano',
  'Katsina',
  'Kebbi',
  'Kogi',
  'Kwara',
  'Lagos',
  'Nasarawa',
  'Niger',
  'Ogun',
  'Ondo',
  'Osun',
  'Oyo',
  'Plateau',
  'Rivers',
  'Sokoto',
  'Taraba',
  'Yobe',
  'Zamfara',
];

export function isValidNigerianState(value: string | null | undefined): boolean {
  if (!value) return false;
  return NIGERIAN_STATES.includes(value.trim());
}
