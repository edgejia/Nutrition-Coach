export type ProteinSourceCertainty = "clear" | "uncertain";
export type ProteinSourceCategory = "anchor" | "conditional" | "trace" | "unknown";

export interface ProteinSourceInput {
  name: string;
  protein: number;
  isPrimary: boolean;
  certainty: ProteinSourceCertainty;
}

export interface TrustedProteinSource {
  name: string;
  protein: number;
  category: Exclude<ProteinSourceCategory, "trace" | "unknown">;
  certainty: ProteinSourceCertainty;
}

export interface ExcludedProteinSource {
  name: string;
  protein: number;
  reason: "trace" | "not_primary" | "unknown";
}

export interface NormalizeTrustedProteinEstimateInput {
  mealName: string;
  proposedProtein: number;
  proteinSources: ProteinSourceInput[];
}

export interface TrustedProteinEstimate {
  trustedProtein: number;
  countedSources: TrustedProteinSource[];
  excludedSources: ExcludedProteinSource[];
  usedConservativeAssumption: boolean;
}

const ANCHOR_PATTERNS = [
  /雞|雞腿|雞胸|雞排/i,
  /牛|牛肉|beef|steak/i,
  /豬|豬肉|豬排|燒肉|烤肉|叉燒|pork|ham|bacon/i,
  /魚|鮭魚|鮪魚|鯖魚|虱目魚|fish|salmon|tuna|cod/i,
  /海鮮|蝦|蝦仁|蛤蜊|貝|干貝|海鮮|shrimp|prawn|seafood|scallop|clam/i,
  /蛋|水煮蛋|茶葉蛋|雞蛋|egg/i,
  /豆腐|板豆腐|嫩豆腐|tofu/i,
  /豆漿|soy milk/i,
  /乳清|whey/i,
  /蛋白粉|protein powder|protein shake/i,
  /牛奶|鮮奶|milk/i,
  /起司|cheese/i,
  /優格|酸奶|yogurt|yoghurt/i,
  /希臘優格|greek yogurt|greek yoghurt/i,
];

const CONDITIONAL_PATTERNS = [
  /毛豆|edamame/i,
  /豆類|紅豆|黑豆|綠豆|鷹嘴豆|豆子|bean|beans|chickpea/i,
  /扁豆|lentil/i,
  /堅果|花生|杏仁|腰果|核桃|開心果|nut|nuts|peanut|almond|cashew|walnut|pistachio/i,
  /種子|芝麻|南瓜子|奇亞籽|flax|chia|seed|seeds/i,
  /燕麥|麥片|oat|oats|oatmeal/i,
  /全穀|藜麥|糙米|quinoa|whole grain|wholegrain/i,
];

const TRACE_PATTERNS = [
  /飯|白飯|便當飯|米飯|rice/i,
  /麵|麵條|拉麵|意麵|冬粉|pasta|noodle|noodles/i,
  /吐司|麵包|貝果|土司|bread|toast|bagel/i,
  /青菜|蔬菜|沙拉|花椰菜|高麗菜|番茄|生菜|vegetable|vegetables|broccoli|cabbage|lettuce|tomato/i,
  /菇|香菇|蘑菇|mushroom|mushrooms/i,
  /醬|醬汁|醬料|肉燥|咖哩|沙茶|sauce|gravy|dressing/i,
  /油|麻油|橄欖油|奶油|oil|butter/i,
  /湯|羹|高湯|broth|soup/i,
  /粥|congee|porridge/i,
  /水果|蘋果|香蕉|地瓜|馬鈴薯|fruit|apple|banana|sweet potato|potato/i,
];

function roundProtein(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function classifyProteinSource(name: string): ProteinSourceCategory {
  const normalized = normalizeName(name);
  if (!normalized) {
    return "unknown";
  }
  if (ANCHOR_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "anchor";
  }
  if (TRACE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "trace";
  }
  if (CONDITIONAL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "conditional";
  }
  return "unknown";
}

export function normalizeTrustedProteinEstimate(
  input: NormalizeTrustedProteinEstimateInput,
): TrustedProteinEstimate {
  const countedSources: TrustedProteinSource[] = [];
  const excludedSources: ExcludedProteinSource[] = [];

  for (const source of input.proteinSources) {
    const protein = roundProtein(Math.max(source.protein, 0));
    const category = classifyProteinSource(source.name);

    if (category === "anchor") {
      countedSources.push({
        name: source.name,
        protein,
        category,
        certainty: source.certainty,
      });
      continue;
    }

    if (category === "conditional") {
      if (source.isPrimary) {
        countedSources.push({
          name: source.name,
          protein,
          category,
          certainty: source.certainty,
        });
      } else {
        excludedSources.push({
          name: source.name,
          protein,
          reason: "not_primary",
        });
      }
      continue;
    }

    if (category === "trace") {
      excludedSources.push({
        name: source.name,
        protein,
        reason: "trace",
      });
      continue;
    }

    excludedSources.push({
      name: source.name,
      protein,
      reason: "unknown",
    });
  }

  const countedProtein = countedSources.reduce((sum, source) => sum + source.protein, 0);
  const trustedProtein = roundProtein(Math.min(Math.max(input.proposedProtein, 0), countedProtein));

  return {
    trustedProtein,
    countedSources,
    excludedSources,
    usedConservativeAssumption: countedSources.some((source) => source.certainty === "uncertain"),
  };
}
