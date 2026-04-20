import { formatLocalDate } from "./time.js";

export type HistoricalIntentMode = "query" | "mutation";
export type HistoricalMealPeriod = "breakfast" | "lunch" | "dinner" | "late_night";

export interface ResolveHistoricalDateIntentArgs {
  input: string;
  currentDate: Date;
  mode: HistoricalIntentMode;
  previousDateKey?: string;
}

interface DateMention {
  dateKey: string;
  text: string;
  start: number;
  end: number;
}

export type HistoricalDateIntent =
  | {
      status: "resolved";
      dateKey: string;
      isHistorical: boolean;
      source: "default_today" | "explicit" | "carry_forward";
      matchedText: string[];
    }
  | {
      status: "resolved_many";
      dateKeys: string[];
      source: "explicit";
      matchedText: string[];
    }
  | {
      status: "needs_clarification";
      reason: "multiple_dates" | "unsupported" | "unparseable";
      prompt: string;
      matchedText: string[];
    };

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HISTORY_FOLLOW_UP_PATTERN =
  /^(?:再(?:加|補|記)?|那(?:筆|餐|份|天)?|這(?:筆|餐|份|天)?|也(?:幫我)?|還有|加上|補上|改成|改為|刪掉|刪除|那就|正常平均|同一筆|同一天)/;

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, offsetDays: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays);
}

function dayKeyToDate(dateKey: string): Date | undefined {
  if (!DAY_KEY_PATTERN.test(dateKey)) {
    return undefined;
  }

  const [yearText, monthText, dayText] = dateKey.split("-");
  const date = new Date(Number(yearText), Number(monthText) - 1, Number(dayText), 12, 0, 0, 0);
  if (formatLocalDate(date) !== dateKey) {
    return undefined;
  }

  return date;
}

function createDateKey(year: number, month: number, day: number): string | undefined {
  const candidate = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    candidate.getFullYear() !== year
    || candidate.getMonth() !== month - 1
    || candidate.getDate() !== day
  ) {
    return undefined;
  }

  return formatLocalDate(candidate);
}

function choosePastYearlessDateKey(
  month: number,
  day: number,
  currentDate: Date,
): string | undefined {
  const currentYear = currentDate.getFullYear();
  const todayKey = formatLocalDate(currentDate);
  const currentYearKey = createDateKey(currentYear, month, day);
  if (currentYearKey && currentYearKey <= todayKey) {
    return currentYearKey;
  }

  return createDateKey(currentYear - 1, month, day);
}

function pushMention(
  mentions: DateMention[],
  seen: Set<string>,
  mention: DateMention | undefined,
): void {
  if (!mention) {
    return;
  }

  const key = `${mention.dateKey}:${mention.start}:${mention.end}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  mentions.push(mention);
}

function overlapsExistingSpan(
  spans: Array<{ start: number; end: number }>,
  start: number,
  end: number,
): boolean {
  return spans.some((span) => start < span.end && end > span.start);
}

function collectExplicitDateMentions(
  input: string,
  currentDate: Date,
): { mentions: DateMention[]; invalidMatches: string[] } {
  const mentions: DateMention[] = [];
  const seen = new Set<string>();
  const occupiedSpans: Array<{ start: number; end: number }> = [];
  const invalidMatches: string[] = [];

  const addSpan = (start: number, end: number) => {
    occupiedSpans.push({ start, end });
  };

  const explicitPatterns = [
    {
      regex: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g,
      build(match: RegExpExecArray): DateMention | undefined {
        const dateKey = createDateKey(Number(match[1]), Number(match[2]), Number(match[3]));
        if (!dateKey) {
          invalidMatches.push(match[0]);
          return undefined;
        }
        return {
          dateKey,
          text: match[0],
          start: match.index,
          end: match.index + match[0].length,
        };
      },
    },
    {
      regex: /\b(\d{4})\/(\d{1,2})\/(\d{1,2})\b/g,
      build(match: RegExpExecArray): DateMention | undefined {
        const dateKey = createDateKey(Number(match[1]), Number(match[2]), Number(match[3]));
        if (!dateKey) {
          invalidMatches.push(match[0]);
          return undefined;
        }
        return {
          dateKey,
          text: match[0],
          start: match.index,
          end: match.index + match[0].length,
        };
      },
    },
    {
      regex: /(^|[^0-9])(\d{1,2})\/(\d{1,2})(?!\/\d)/g,
      build(match: RegExpExecArray): DateMention | undefined {
        const raw = match[2] + "/" + match[3];
        const start = match.index + match[1].length;
        const end = start + raw.length;
        if (overlapsExistingSpan(occupiedSpans, start, end)) {
          return undefined;
        }

        const dateKey = choosePastYearlessDateKey(Number(match[2]), Number(match[3]), currentDate);
        if (!dateKey) {
          invalidMatches.push(raw);
          return undefined;
        }
        return {
          dateKey,
          text: raw,
          start,
          end,
        };
      },
    },
    {
      regex: /(\d{1,2})月(\d{1,2})日/g,
      build(match: RegExpExecArray): DateMention | undefined {
        const dateKey = choosePastYearlessDateKey(Number(match[1]), Number(match[2]), currentDate);
        if (!dateKey) {
          invalidMatches.push(match[0]);
          return undefined;
        }
        return {
          dateKey,
          text: match[0],
          start: match.index,
          end: match.index + match[0].length,
        };
      },
    },
  ];

  for (const pattern of explicitPatterns) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(input)) !== null) {
      const mention = pattern.build(match);
      if (!mention) {
        continue;
      }
      pushMention(mentions, seen, mention);
      addSpan(mention.start, mention.end);
    }
  }

  const todayKey = formatLocalDate(currentDate);
  const relativeMentions: Array<DateMention | undefined> = [];

  if (/今天/.test(input)) {
    const match = /今天/.exec(input);
    if (match && match.index !== undefined) {
      relativeMentions.push({
        dateKey: todayKey,
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  const previousDayPatterns = [
    { regex: /前兩天|前两天/g, offset: -2 },
    { regex: /前天/g, offset: -2 },
    { regex: /昨天/g, offset: -1 },
  ];

  for (const { regex, offset } of previousDayPatterns) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(input)) !== null) {
      relativeMentions.push({
        dateKey: formatLocalDate(addLocalDays(currentDate, offset)),
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  const weekdayMap: Record<string, number> = {
    一: 0,
    二: 1,
    三: 2,
    四: 3,
    五: 4,
    六: 5,
    日: 6,
    天: 6,
  };
  const relativeWeekdayPattern = /上(?:週|星期)([一二三四五六日天])/g;
  let weekdayMatch: RegExpExecArray | null;
  while ((weekdayMatch = relativeWeekdayPattern.exec(input)) !== null) {
    const weekdayOffset = weekdayMap[weekdayMatch[1]];
    const currentStart = startOfLocalDay(currentDate);
    const mondayOffset = (currentStart.getDay() + 6) % 7;
    const currentWeekStart = addLocalDays(currentStart, -mondayOffset);
    const targetDate = addLocalDays(currentWeekStart, -7 + weekdayOffset);
    relativeMentions.push({
      dateKey: formatLocalDate(targetDate),
      text: weekdayMatch[0],
      start: weekdayMatch.index,
      end: weekdayMatch.index + weekdayMatch[0].length,
    });
  }

  for (const mention of relativeMentions) {
    pushMention(mentions, seen, mention);
  }

  mentions.sort((left, right) => left.start - right.start);
  return { mentions, invalidMatches };
}

function hasUnsupportedHistoricalPhrase(input: string): boolean {
  return /上(?:週|星期)(?![一二三四五六日天])|前(?:陣子|一陣子)|前幾天|最近那天/.test(input);
}

function isObviousHistoricalFollowUp(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 32) {
    return false;
  }

  return HISTORY_FOLLOW_UP_PATTERN.test(trimmed);
}

function uniqueDateKeys(mentions: DateMention[]): string[] {
  return [...new Set(mentions.map((mention) => mention.dateKey))];
}

export function resolveHistoricalDateIntent(
  args: ResolveHistoricalDateIntentArgs,
): HistoricalDateIntent {
  const { input, currentDate, mode, previousDateKey } = args;
  const trimmed = input.trim();
  const todayKey = formatLocalDate(currentDate);
  const { mentions, invalidMatches } = collectExplicitDateMentions(trimmed, currentDate);
  const matchedText = mentions.map((mention) => mention.text);
  const dateKeys = uniqueDateKeys(mentions);

  if (invalidMatches.length > 0) {
    return {
      status: "needs_clarification",
      reason: "unparseable",
      prompt: "我還不能確定是哪一天，請再說一次日期。",
      matchedText: invalidMatches,
    };
  }

  if (hasUnsupportedHistoricalPhrase(trimmed)) {
    return {
      status: "needs_clarification",
      reason: "unsupported",
      prompt: "我還不能確定是哪一天，請再說一次日期。",
      matchedText,
    };
  }

  if (dateKeys.length > 1) {
    if (mode === "query") {
      return {
        status: "resolved_many",
        dateKeys,
        source: "explicit",
        matchedText,
      };
    }

    return {
      status: "needs_clarification",
      reason: "multiple_dates",
      prompt: "我還不能確定你要記錄哪一天，請一次告訴我一個日期。",
      matchedText,
    };
  }

  if (dateKeys.length === 1) {
    return {
      status: "resolved",
      dateKey: dateKeys[0]!,
      isHistorical: dateKeys[0] !== todayKey,
      source: "explicit",
      matchedText,
    };
  }

  if (previousDateKey && dayKeyToDate(previousDateKey) && isObviousHistoricalFollowUp(trimmed)) {
    return {
      status: "resolved",
      dateKey: previousDateKey,
      isHistorical: previousDateKey !== todayKey,
      source: "carry_forward",
      matchedText: [],
    };
  }

  return {
    status: "resolved",
    dateKey: todayKey,
    isHistorical: false,
    source: "default_today",
    matchedText: [],
  };
}

export function buildHistoricalLoggedAt(
  args: { dateKey: string; mealPeriod?: HistoricalMealPeriod },
): string {
  const baseDate = dayKeyToDate(args.dateKey);
  if (!baseDate) {
    throw new Error("INVALID_DATE_KEY");
  }

  const [hour, minute] = (() => {
    switch (args.mealPeriod) {
      case "breakfast":
        return [8, 0] as const;
      case "lunch":
        return [12, 30] as const;
      case "dinner":
        return [18, 30] as const;
      case "late_night":
        return [22, 30] as const;
      default:
        return [12, 0] as const;
    }
  })();

  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    hour,
    minute,
    0,
    0,
  ).toISOString();
}
