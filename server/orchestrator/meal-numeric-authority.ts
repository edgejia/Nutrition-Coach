import { normalizeNumericSourceText, stripToolLikeRegions } from "./source-text-guard.js";

export const MEAL_NUMERIC_FIELDS = ["calories", "protein", "carbs", "fat"] as const;

export type MealNumericField = (typeof MEAL_NUMERIC_FIELDS)[number];

export interface MealNumericItem {
  foodName?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface MealNumericBaseline {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  items?: MealNumericItem[];
}

export type MealNumericUpdate =
  | { patch: Partial<Record<MealNumericField, number>> }
  | { items: MealNumericItem[] };

export type MealNumericEvidence = Record<MealNumericField, number[]>;
type ItemScopedMealNumericEvidence = Record<string, MealNumericEvidence>;

export type MealNumericAdjustmentClassification =
  | { kind: "explicit_final_value" }
  | { kind: "clarification_needed"; reason: "vague" | "direction_only" }
  | { kind: "proposal_candidate"; operator: "half" }
  | { kind: "proposal_candidate"; operator: "subtract_percent"; value: number }
  | { kind: "proposal_candidate"; operator: "add_amount"; value: number }
  | { kind: "proposal_candidate"; operator: "subtract_amount"; value: number };

export type MealNumericAuthorizationResult =
  | { ok: true; authorizedFields: string[] }
  | {
      ok: false;
      reason:
        | "unauthorized_numeric_values"
        | "vague_numeric_request"
        | "direction_only_request"
        | "relative_operator_requires_proposal";
      unauthorizedFields: string[];
    };
type MealNumericAuthorizationFailureReason = Extract<
  MealNumericAuthorizationResult,
  { ok: false }
>["reason"];

const FIELD_ALIASES: Record<MealNumericField, readonly string[]> = {
  calories: ["熱量", "卡路里", "卡"],
  protein: ["蛋白質", "蛋白"],
  carbs: ["碳水化合物", "碳水"],
  fat: ["脂肪"],
};

const FIELD_LABEL_RE = /(熱量|卡路里|蛋白質|蛋白|碳水化合物|碳水|脂肪)/g;
const CALORIE_UNIT_RE = /(\d+(?:\.\d+)?)\s*(?:kcal|卡)/gi;
const VAGUE_RE = /(合理一點|合理點|正常一點|正常點|怪怪的|不太對|不對勁|平均(?:一下|一點)?)/;
const DIRECTION_ONLY_RE = /(偏高|太高|高了|偏低|太低|低了|過高|過低)/;
const HALF_RE = /(減半|半份|一半)/;
const DIRECT_HALF_RE = /(減半|一半)/;
const HALF_PORTION_RE = /半份/;
const SUBTRACT_PERCENT_RE = /(少|減|降低|降|扣)\s*(\d+(?:\.\d+)?)\s*%/;
const ADD_AMOUNT_RE = /(加|增加|提高|多)\s*(\d+(?:\.\d+)?)\s*(?:g|克|卡|kcal)?/i;
const SUBTRACT_AMOUNT_RE = /(少|減|降低|降|扣)\s*(\d+(?:\.\d+)?)\s*(?:g|克|卡|kcal)?/i;
const TARGET_BARE_CHINESE_DIGIT_RE = /(?:改成|改為|改到|變成|換成|調成)([零一二兩三四五六七八九])(?![十百千])/g;
const NEGATED_VALUE_RE = /(?:不是|不要|別|非)\s*(\d+(?:\.\d+)?|[零一二兩三四五六七八九十百千]+)/g;
const BARE_CHINESE_DIGIT: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function emptyEvidence(): MealNumericEvidence {
  return {
    calories: [],
    protein: [],
    carbs: [],
    fat: [],
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeItemName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLocaleLowerCase() : undefined;
}

function fieldForLabel(label: string): MealNumericField | undefined {
  for (const field of MEAL_NUMERIC_FIELDS) {
    if (FIELD_ALIASES[field].includes(label)) return field;
  }
  return undefined;
}

function pushUnique(values: number[], value: number): void {
  if (!values.includes(value)) values.push(value);
}

function normalizeValue(value: number): number {
  return Number(Number(value).toFixed(3));
}

function valuesFromNumericToken(token: string): number[] {
  const values = normalizeNumericSourceText(token)
    .map((candidate) => Number(candidate))
    .filter((candidate) => Number.isFinite(candidate))
    .map(normalizeValue);

  const compact = token.replace(/\s+/g, "");
  const bareDigit = BARE_CHINESE_DIGIT[compact[0] ?? ""];
  const nextChar = compact[1];
  if (bareDigit !== undefined && nextChar !== "十" && nextChar !== "百" && nextChar !== "千" && !values.includes(bareDigit)) {
    values.push(bareDigit);
  }

  return values;
}

function negatedValuesFromText(text: string): number[] {
  const values: number[] = [];
  for (const match of text.matchAll(NEGATED_VALUE_RE)) {
    for (const value of valuesFromNumericToken(match[1] ?? "")) {
      pushUnique(values, value);
    }
  }
  return values;
}

function numbersFromText(text: string): number[] {
  const negatedValues = negatedValuesFromText(text);
  const values = valuesFromNumericToken(text).filter((value) => !negatedValues.includes(value));

  for (const match of text.matchAll(TARGET_BARE_CHINESE_DIGIT_RE)) {
    const value = BARE_CHINESE_DIGIT[match[1] ?? ""];
    if (value !== undefined && !negatedValues.includes(value)) {
      pushUnique(values, value);
    }
  }

  return values;
}

export function extractMealNumericEvidence(text: string): MealNumericEvidence {
  const evidence = emptyEvidence();
  const evidenceText = stripToolLikeRegions(text);
  const matches = [...evidenceText.matchAll(FIELD_LABEL_RE)];
  const globalNegatedValues = negatedValuesFromText(evidenceText);

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const field = fieldForLabel(match[0]);
    if (!field) continue;

    const segmentStart = match.index + match[0].length;
    const nextMatch = matches[index + 1];
    const segmentEnd = nextMatch?.index ?? evidenceText.length;
    const segment = evidenceText.slice(segmentStart, segmentEnd);
    for (const value of numbersFromText(segment)) {
      pushUnique(evidence[field], value);
    }
  }

  for (const match of evidenceText.matchAll(CALORIE_UNIT_RE)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && !globalNegatedValues.includes(normalizeValue(value))) {
      pushUnique(evidence.calories, normalizeValue(value));
    }
  }

  return evidence;
}

export function classifyMealNumericAdjustment(text: string): MealNumericAdjustmentClassification {
  const normalized = text.replace(/\s+/g, "");
  const hasFinalEvidence = MEAL_NUMERIC_FIELDS.some((field) => extractMealNumericEvidence(text)[field].length > 0);
  if (DIRECT_HALF_RE.test(normalized) || (HALF_PORTION_RE.test(normalized) && !hasFinalEvidence)) {
    return { kind: "proposal_candidate", operator: "half" };
  }

  const subtractPercent = normalized.match(SUBTRACT_PERCENT_RE);
  if (subtractPercent) {
    return {
      kind: "proposal_candidate",
      operator: "subtract_percent",
      value: normalizeValue(Number(subtractPercent[2])),
    };
  }

  const addAmount = normalized.match(ADD_AMOUNT_RE);
  if (addAmount) {
    return {
      kind: "proposal_candidate",
      operator: "add_amount",
      value: normalizeValue(Number(addAmount[2])),
    };
  }

  const subtractAmount = normalized.match(SUBTRACT_AMOUNT_RE);
  if (subtractAmount) {
    return {
      kind: "proposal_candidate",
      operator: "subtract_amount",
      value: normalizeValue(Number(subtractAmount[2])),
    };
  }

  if (VAGUE_RE.test(normalized)) {
    return { kind: "clarification_needed", reason: "vague" };
  }

  if (DIRECTION_ONLY_RE.test(normalized)) {
    return { kind: "clarification_needed", reason: "direction_only" };
  }

  return { kind: "explicit_final_value" };
}

function evidenceAllows(evidence: MealNumericEvidence, field: MealNumericField, value: number): boolean {
  return evidence[field].includes(normalizeValue(value));
}

function mergeEvidence(target: MealNumericEvidence, source: MealNumericEvidence): void {
  for (const field of MEAL_NUMERIC_FIELDS) {
    for (const value of source[field]) {
      pushUnique(target[field], value);
    }
  }
}

function extractItemScopedMealNumericEvidence(
  text: string,
  itemNames: readonly string[],
): ItemScopedMealNumericEvidence {
  const evidenceByItem: ItemScopedMealNumericEvidence = {};
  const uniqueNames = [...new Set(itemNames.map((name) => name.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  if (uniqueNames.length === 0) return evidenceByItem;

  const evidenceText = stripToolLikeRegions(text);
  const itemNamePattern = new RegExp(uniqueNames.map(escapeRegExp).join("|"), "gi");
  const itemMatches = [...evidenceText.matchAll(itemNamePattern)];

  for (let index = 0; index < itemMatches.length; index += 1) {
    const match = itemMatches[index]!;
    const itemName = normalizeItemName(match[0]);
    if (!itemName) continue;

    const segmentStart = match.index + match[0].length;
    const segmentEnd = itemMatches[index + 1]?.index ?? evidenceText.length;
    const segment = evidenceText.slice(segmentStart, segmentEnd);
    evidenceByItem[itemName] ??= emptyEvidence();
    mergeEvidence(evidenceByItem[itemName], extractMealNumericEvidence(segment));
  }

  for (const clause of evidenceText.split(/[，,。；;\n]+/)) {
    const matchingNames = uniqueNames.filter((name) => clause.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
    if (matchingNames.length !== 1) continue;
    const itemName = normalizeItemName(matchingNames[0]);
    if (!itemName) continue;

    evidenceByItem[itemName] ??= emptyEvidence();
    mergeEvidence(evidenceByItem[itemName], extractMealNumericEvidence(clause));
  }

  return evidenceByItem;
}

function evidenceAllowsItemField(
  evidenceByItem: ItemScopedMealNumericEvidence,
  currentUserMessage: string,
  currentItem: MealNumericItem | undefined,
  nextItem: MealNumericItem,
  field: MealNumericField,
  value: number,
): boolean {
  const currentName = normalizeItemName(currentItem?.foodName);
  const nextName = normalizeItemName(nextItem.foodName);
  const evidenceNames = currentName ? [currentName] : [];
  if (!currentName && nextName) {
    evidenceNames.push(nextName);
  } else if (
    currentName
    && nextName
    && currentName !== nextName
    && userTextLinksItemRename(currentUserMessage, currentName, nextName)
  ) {
    evidenceNames.push(nextName);
  }

  return evidenceNames.some((name) => evidenceAllows(evidenceByItem[name] ?? emptyEvidence(), field, value));
}

function userTextLinksItemRename(text: string, currentName: string, nextName: string): boolean {
  const evidenceText = stripToolLikeRegions(text).toLocaleLowerCase();
  const currentPattern = escapeRegExp(currentName);
  const nextPattern = escapeRegExp(nextName);
  const renameVerbPattern = "(?:改成|改為|改到|變成|換成|調成)";
  return new RegExp(`${currentPattern}.{0,40}${renameVerbPattern}.{0,40}${nextPattern}`).test(evidenceText)
    || new RegExp(`${nextPattern}.{0,40}(?:取代|替代|代替).{0,40}${currentPattern}`).test(evidenceText);
}

function hasDuplicateItemName(items: readonly MealNumericItem[], name: string | undefined): boolean {
  if (!name) return false;
  return items.filter((item) => normalizeItemName(item.foodName) === name).length > 1;
}

function collectPatchUnauthorized(
  patch: Partial<Record<MealNumericField, number>>,
  evidence: MealNumericEvidence,
): { authorizedFields: string[]; unauthorizedFields: string[] } {
  const authorizedFields: string[] = [];
  const unauthorizedFields: string[] = [];

  for (const field of MEAL_NUMERIC_FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    if (evidenceAllows(evidence, field, value)) {
      authorizedFields.push(field);
    } else {
      unauthorizedFields.push(field);
    }
  }

  return { authorizedFields, unauthorizedFields };
}

function collectItemsUnauthorized(
  currentUserMessage: string,
  currentItems: readonly MealNumericItem[],
  nextItems: readonly MealNumericItem[],
  evidenceByItem: ItemScopedMealNumericEvidence,
): { authorizedFields: string[]; unauthorizedFields: string[] } {
  const authorizedFields: string[] = [];
  const unauthorizedFields: string[] = [];

  nextItems.forEach((nextItem, itemIndex) => {
    const currentItem = currentItems[itemIndex];
    for (const field of MEAL_NUMERIC_FIELDS) {
      const nextValue = nextItem[field];
      const currentValue = currentItem?.[field];
      if (currentValue !== undefined && normalizeValue(currentValue) === normalizeValue(nextValue)) {
        continue;
      }

      const path = `items[${itemIndex}].${field}`;
      const currentName = normalizeItemName(currentItem?.foodName);
      const nextName = normalizeItemName(nextItem.foodName);
      if (hasDuplicateItemName(currentItems, currentName) || hasDuplicateItemName(nextItems, nextName)) {
        unauthorizedFields.push(path);
        continue;
      }

      if (evidenceAllowsItemField(evidenceByItem, currentUserMessage, currentItem, nextItem, field, nextValue)) {
        authorizedFields.push(path);
      } else {
        unauthorizedFields.push(path);
      }
    }
  });

  return { authorizedFields, unauthorizedFields };
}

function failureReasonForClassification(
  classification: MealNumericAdjustmentClassification,
): MealNumericAuthorizationFailureReason {
  if (classification.kind === "proposal_candidate") return "relative_operator_requires_proposal";
  if (classification.kind === "clarification_needed" && classification.reason === "direction_only") {
    return "direction_only_request";
  }
  if (classification.kind === "clarification_needed") return "vague_numeric_request";
  return "unauthorized_numeric_values";
}

export function authorizeMealNumericUpdate(input: {
  currentUserMessage: string;
  currentMeal: MealNumericBaseline;
  update: MealNumericUpdate;
}): MealNumericAuthorizationResult {
  const evidence = extractMealNumericEvidence(input.currentUserMessage);
  const classification = classifyMealNumericAdjustment(input.currentUserMessage);
  const result = "items" in input.update
    ? collectItemsUnauthorized(
      input.currentUserMessage,
      input.currentMeal.items ?? [],
      input.update.items,
      extractItemScopedMealNumericEvidence(
        input.currentUserMessage,
        [
          ...(input.currentMeal.items ?? []).map((item) => item.foodName ?? ""),
          ...input.update.items.map((item) => item.foodName ?? ""),
        ],
      ),
    )
    : collectPatchUnauthorized(input.update.patch, evidence);

  if (classification.kind !== "explicit_final_value") {
    return {
      ok: false,
      reason: failureReasonForClassification(classification),
      unauthorizedFields: [...result.authorizedFields, ...result.unauthorizedFields],
    };
  }

  if (result.unauthorizedFields.length > 0) {
    return {
      ok: false,
      reason: "unauthorized_numeric_values",
      unauthorizedFields: result.unauthorizedFields,
    };
  }

  return { ok: true, authorizedFields: result.authorizedFields };
}
