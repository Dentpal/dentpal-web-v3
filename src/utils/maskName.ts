/**
 * maskName
 * Privacy helper for buyer-facing name display in the seller panel.
 *
 * Keeps the first letter of every word and replaces the remaining characters
 * with asterisks, so "NIKKI PAR" renders as "N**** P**". The underlying value
 * is never modified — mask only at render time (search, ban records and any
 * other data still use the real name).
 */
export const maskName = (name?: string | null): string => {
  const trimmed = (name || '').trim();
  if (!trimmed) return '';
  return trimmed
    .split(/\s+/)
    .map(word => word.charAt(0) + '*'.repeat(Math.max(0, word.length - 1)))
    .join(' ');
};

export default maskName;
