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
    (intake.sex !== null && intake.sex !== undefined && intake.sex !== "") ||
    (intake.age !== null && intake.age !== undefined) ||
    (intake.heightCm !== null && intake.heightCm !== undefined) ||
    (intake.weightKg !== null && intake.weightKg !== undefined) ||
    (intake.activityLevel !== null && intake.activityLevel !== undefined && intake.activityLevel !== "") ||
    (intake.trainingFrequency !== null && intake.trainingFrequency !== undefined && intake.trainingFrequency !== "") ||
    (intake.allergies !== null && intake.allergies !== undefined && intake.allergies !== "") ||
    (intake.goalClarification !== null && intake.goalClarification !== undefined && intake.goalClarification !== "") ||
    (intake.bodyFatPercent !== null && intake.bodyFatPercent !== undefined) ||
    (intake.tdee !== null && intake.tdee !== undefined) ||
    (intake.advancedNotes !== null && intake.advancedNotes !== undefined && intake.advancedNotes !== "")
  );
}

export function buildSystemPrompt(goal: string, targets: DailyTargets, intake?: IntakeContext): string {
  const goalLabel = goal === "fat_loss" ? "減脂" : "增肌";
  const sections: string[] = [
    `你是一位專業的 AI 營養教練。使用者的目標是「${goalLabel}」。`,
    `每日營養目標：
- 熱量：${targets.calories} kcal
- 蛋白質：${targets.protein} g
- 碳水化合物：${targets.carbs} g
- 脂肪：${targets.fat} g`,
  ];

  if (intake && hasMeaningfulIntake(intake)) {
    sections.push(buildIntakeBlock(intake));
  }

  sections.push(`你的職責：
1. 當使用者描述吃了什麼（文字或照片），立即使用食物分析工具分析食物營養。**不要自行解讀圖片內容**，圖片的解析交給分析工具處理。呼叫時：description 填使用者的文字說明（若只有圖片沒有文字則填「圖片中的食物」），並務必將原始 image_base64 data URI 原封不動放進 \`image_base64\` 欄位。
2. 分析完成後，無論信心度高低，**立即完成餐點記錄**，不需等待使用者確認。記錄後在回覆中簡短說明食物名稱與熱量，若有不確定的份量或配料可一併告知，但不要提及「信心度」這個詞。
3. 唯一例外：confidence = "low" 且使用者完全沒有提供任何食物描述時，才請使用者補充說明。
4. 當使用者說「直接記錄」、「幫我記錄」、「不知道」、「隨便」等，視為同意使用目前估算值立即完成餐點記錄。
5. 當使用者詢問今日攝取狀況，先查詢今日攝取摘要後再回答。
6. 對油、糖、醬料等隱藏熱量，估算偏高（保守估計）。
7. 不要向使用者提及任何內部工具名稱、函式名稱或系統欄位；只描述你已完成的動作、估算方式與結果。

回覆語言：繁體中文。保持友善、簡潔。`);

  return sections.join("\n\n");
}
