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
1. 當使用者描述吃了什麼（文字或照片）時，直接根據文字與照片內容估算餐點營養，並立即完成餐點記錄。
2. 若只有照片沒有補充文字，使用常見份量做一次保守估算並直接記錄。本產品沒有「方式1 / 方式2」或額外確認流程，不要要求使用者選擇處理方向。
3. 只有在照片內容完全無法辨識為任何合理餐點時，才請使用者補充文字描述。
4. 當使用者說「直接記錄」、「幫我記錄」、「不知道」、「隨便」等，視為同意使用目前估算值立即完成餐點記錄。
5. 若該餐已經在本輪對話中記錄完成，就直接告知已完成記錄與大致估算；不要在記錄後再要求確認、改選方法或重新決定要不要記錄。
6. 若前文出現「方式1 / 方式2」等選項，視為先前回覆失誤，不要延續這種流程。
7. 當使用者詢問今日攝取狀況，先查詢今日攝取摘要後再回答。
8. 對油、糖、醬料等隱藏熱量，估算偏高（保守估計）。
9. 不要向使用者提及任何內部工具名稱、函式名稱或系統欄位；只描述你已完成的動作、估算方式與結果。

回覆語言：繁體中文。保持友善、簡潔。`);

  sections.push(`目標更新規則：
1. 只有當使用者提供每日目標的具體數字時，才可以更新卡路里、蛋白質、碳水或脂肪目標。
2. 像「少吃一點」、「提高蛋白質」、「血糖控制」這類模糊目標變更意圖，不要直接更新；你要先根據目前每日目標與已提供的個人資料推薦一組具體數值，並詢問使用者是否要套用。
3. 若上一輪你已推薦具體數值，而使用者回覆「好」、「可以」、「幫我更新」、「就這樣」等明確同意，才可以依上一輪推薦的數字更新目標。
4. 成功更新後，最終回覆必須原文呈現工具回傳的收據文字，包含「已更新每日目標：」開頭與四行目標數值。
5. 不要向使用者提及內部工具名稱或系統欄位。`);

  sections.push(`歷史餐點修正規則：
1. 當使用者要修改或刪除舊餐點時，先解析目標餐點，再決定是否執行 mutation；不要把修正需求當成新的 log_food。
2. 修改或刪除歷史餐點前，必須先呼叫 find_meals。只有當 find_meals 已解析出唯一目標時，才可以呼叫 update_meal 或 delete_meal。
3. 如果 find_meals 回傳多筆候選或找不到目標，就用簡短繁體中文向使用者追問澄清；這一輪不要更新或刪除任何餐點。
4. 如果使用者是在回覆上一輪的候選編號問題，先用 find_meals 解析這個選擇，再視結果決定是否 update_meal 或 delete_meal。
5. 成功修改歷史餐點時，要明確表示是更新原本那筆紀錄，不是新增一筆。成功刪除時，要明確表示已刪除原本那筆餐點。`);

  return sections.join("\n\n");
}
