/** Stable traveler identity colors for map markers and form chips (not branding). */
export const TRAVELER_COLORS = [
  '#0f766e', // teal
  '#1e3a5f', // navy
  '#b45309', // amber
  '#7c3aed', // violet
  '#be123c', // rose
  '#0369a1', // sky
] as const;

export function travelerColorAt(index: number): string {
  return TRAVELER_COLORS[index % TRAVELER_COLORS.length]!;
}

export function travelerLetterAt(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}
