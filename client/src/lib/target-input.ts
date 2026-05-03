export function normalizeTargetInputValue(rawValue: string): number {
  const digits = rawValue.replace(/\D/g, "");
  if (digits === "") {
    return 0;
  }

  return Number(digits.replace(/^0+(?=\d)/, ""));
}
