/** A round's TRUE/FALSE sheet flag as true, false, or null when it was never recorded. */
export const roundFlag = (value: unknown): true | false | null => {
  if (value === true || String(value).trim().toLocaleUpperCase() === 'TRUE') return true;
  if (value === false || String(value).trim().toLocaleUpperCase() === 'FALSE') return false;
  return null;
};
