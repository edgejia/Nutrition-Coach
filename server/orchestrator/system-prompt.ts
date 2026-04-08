import type { DailyTargets } from "../services/device.js";

interface IntakeContext {
  sex?: string | null;
  age?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  activityLevel?: string | null;
  trainingFrequency?: string | null;
  allergies?: string | null;
  goalClarification?: string | null;
  bodyFatPercent?: number | null;
  tdee?: number | null;
  advancedNotes?: string | null;
}

function formatFieldValue(value: string | number | null | undefined, suffix = ""): string {
  if (value === null || value === undefined || value === "") {
    return "未提供";
  }

  return `${value}${suffix}`;
}

function buildIntakeBlock(intake: IntakeContext): string {
  const lines = [
    "使用者背景資料：",
    `- 性別：${formatFieldValue(intake.sex === "male" ? "男" : intake.sex === "female" ? "女" : intake.sex)}`,
    `- 年齡：${formatFieldValue(intake.age)}`,
    `- 身高：${formatFieldValue(intake.heightCm, " cm")}`,
    `- 體重：${formatFieldValue(intake.weightKg, " kg")}`,
    `- 活動量：${formatFieldValue(intake.activityLevel)}`,
    `- 訓練頻率：${formatFieldValue(intake.trainingFrequency)}`,
  ];

  if (intake.allergies) {
    lines.push(`- 過敏/飲食限制：${intake.allergies}`);
  }
  if (intake.goalClarification) {
    lines.push(`- 目標補充：${intake.goalClarification}`);
  }
  if (intake.bodyFatPercent !== null && intake.bodyFatPercent !== undefined) {
    lines.push(`- 體脂率：${formatFieldValue(intake.bodyFatPercent, "%")}`);
  }
  if (intake.tdee !== null && intake.tdee !== undefined) {
    lines.push(`- TDEE：${formatFieldValue(intake.tdee, " kcal")}`);
  }
  if (intake.advancedNotes) {
    lines.push(`- 備註：${intake.advancedNotes}`);
  }

  return lines.join("\n");
}

function hasMeaningfulIntake(intake: IntakeContext): boolean {
  return (
    intake.sex !== null && intake.sex !== undefined && intake.sex !== "" ||
    intake.age !== null && intake.age !== undefined ||
    intake.heightCm !== null && intake.heightCm !== undefined ||
    intake.weightKg !== null && intake.weightKg !== undefined ||
    intake.activityLevel !== null && intake.activityLevel !== undefined && intake.activityLevel !== "" ||
    intake.trainingFrequency !== null && intake.trainingFrequency !== undefined && intake.trainingFrequency !== "" ||
    intake.allergies !== null && intake.allergies !== undefined && intake.allergies !== "" ||
    intake.goalClarification !== null && intake.goalClarification !== undefined && intake.goalClarification !== "" ||
    intake.bodyFatPercent !== null && intake.bodyFatPercent !== undefined ||
    intake.tdee !== null && intake.tdee !== undefined ||
    intake.advancedNotes !== null && intake.advancedNotes !== undefined && intake.advancedNotes !== ""
  );
}

export function buildSystemPrompt(goal: string, targets: DailyTargets, intake?: IntakeContext): string {
  const goalLabel = goal === "fat_loss" ? "減脂" : "增肌";
  const sections = [
    `你是一位專業的 AI 營養教練。使用者的目標是「${goalLabel}」。`,
    `每日營養目標：
- 熱量：${targets.calories} kcal
- 蛋白質：${targets.protein} g
- 碳水化合物：${targets.carbs} g
- 脂肪：${targets.fat} g`,
    intake && hasMeaningfulIntake(intake) ? buildIntakeBlock(intake) : null,
    `你的職責：
1. 當使用者描述吃了什麼（文字或照片），直接分析食物的營養成分，然後呼叫 log_food 記錄。
2. 分析時考慮份量、烹調方式、醬料等，對油、糖、醬料等隱藏熱量保守估計偏高。
3. 無論使用者描述是否完整，都直接估算份量與營養成分並呼叫 log_food 記錄。不要在記錄前要求確認份量、品牌名稱、烹調方式或確切克數，這些細節由你自行估算。
4. 記錄完成後，在文字回覆中用一句話說明你的估算假設，例如：「已記錄白飯 200g，估算為一般碗裝」或「已記錄雞胸肉 150g，估算為水煮」。
5. 當使用者詢問今日攝取狀況，使用 get_daily_summary 工具查詢後回答。
6. 回覆語言：繁體中文。保持友善、簡潔。`,
  ].filter((section): section is string => section !== null);

  return `${sections.join("\n\n")}\n`;
}
