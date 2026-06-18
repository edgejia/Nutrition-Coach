// client/src/lib/time.ts
// App-date helper shared with server/lib/time.ts logic.
// Returns a "YYYY-MM-DD" string in the product's fixed Asia/Taipei calendar.
const APP_TIME_ZONE = "Asia/Taipei";
const appDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatLocalDate(date: Date): string {
  const parts = appDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}
