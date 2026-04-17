// client/src/lib/time.ts
// Local-date helper shared with server/lib/time.ts logic.
// Returns a "YYYY-MM-DD" string built from the browser's local calendar fields.
export function formatLocalDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
