import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_SYSTEM_PROMPT_VERSION,
  SYSTEM_PROMPT_SECTION_IDS,
  buildSystemPrompt,
} from "../../server/orchestrator/system-prompt.js";

function goalUpdateSection(prompt: string): string {
  const match = /目標更新規則：[\s\S]*?(?=\n\n歷史餐點修正規則：)/.exec(prompt);
  assert.ok(match, "goal update section must be present");
  return match[0];
}

const LEGACY_GOAL_UPDATE_SECTION = `目標更新規則：
1. 只有當使用者提供每日目標的具體數字時，才可以更新卡路里、蛋白質、碳水或脂肪目標。
2. 像「少吃一點」、「提高蛋白質」、「血糖控制」這類模糊目標變更意圖，不要直接更新；你要先根據目前每日目標與已提供的個人資料推薦一組具體數值，並詢問使用者是否要套用。
3. 若上一輪你已推薦具體數值，而使用者回覆「好」、「可以」、「幫我更新」、「就這樣」等明確同意，才可以依上一輪推薦的數字更新目標。
4. 成功更新後，最終回覆必須原文呈現工具回傳的收據文字，包含「已更新每日目標：」開頭與四行目標數值。
5. 不要向使用者提及內部工具名稱或系統欄位。`;

function normalizeGoalUpdateSectionForLegacySnapshot(prompt: string): string {
  return prompt.replace(goalUpdateSection(prompt), LEGACY_GOAL_UPDATE_SECTION);
}

describe("buildSystemPrompt", () => {
  it("exports exact prompt metadata", () => {
    assert.equal(ACTIVE_SYSTEM_PROMPT_VERSION, "system-prompt.v2");
    assert.deepEqual(SYSTEM_PROMPT_SECTION_IDS, {
      role: "role",
      dailyTargets: "daily-targets",
      intakeContext: "intake-context",
      responsibilities: "responsibilities",
      mealItemization: "meal-itemization",
      proteinEstimation: "protein-estimation",
      logFoodReceipt: "log-food-receipt",
      goalUpdates: "goal-updates",
      mealCorrections: "meal-corrections",
      historicalDates: "historical-dates",
    });
  });

  it("exports unique kebab-case section IDs including conditional intake context", () => {
    const sectionIds = Object.values(SYSTEM_PROMPT_SECTION_IDS);

    assert.equal(new Set(sectionIds).size, sectionIds.length);
    assert.ok(sectionIds.every((id) => /^[a-z]+(?:-[a-z]+)*$/.test(id)));
    assert.ok(sectionIds.includes("intake-context"));
  });

  it("maps test-local risk categories to locked section IDs", () => {
    const coverageByRisk = {
      logging: [
        SYSTEM_PROMPT_SECTION_IDS.responsibilities,
        SYSTEM_PROMPT_SECTION_IDS.mealItemization,
        SYSTEM_PROMPT_SECTION_IDS.proteinEstimation,
        SYSTEM_PROMPT_SECTION_IDS.logFoodReceipt,
      ],
      images: [
        SYSTEM_PROMPT_SECTION_IDS.responsibilities,
        SYSTEM_PROMPT_SECTION_IDS.mealItemization,
      ],
      corrections: [
        SYSTEM_PROMPT_SECTION_IDS.mealCorrections,
        SYSTEM_PROMPT_SECTION_IDS.historicalDates,
      ],
      goals: [
        SYSTEM_PROMPT_SECTION_IDS.dailyTargets,
        SYSTEM_PROMPT_SECTION_IDS.goalUpdates,
      ],
      safety: [
        SYSTEM_PROMPT_SECTION_IDS.responsibilities,
        SYSTEM_PROMPT_SECTION_IDS.logFoodReceipt,
        SYSTEM_PROMPT_SECTION_IDS.goalUpdates,
        SYSTEM_PROMPT_SECTION_IDS.mealCorrections,
      ],
      outputLanguage: [
        SYSTEM_PROMPT_SECTION_IDS.responsibilities,
        SYSTEM_PROMPT_SECTION_IDS.logFoodReceipt,
      ],
    } as const;
    const sectionIds = new Set(Object.values(SYSTEM_PROMPT_SECTION_IDS));

    for (const mappedIds of Object.values(coverageByRisk)) {
      for (const mappedId of mappedIds) {
        assert.ok(sectionIds.has(mappedId));
      }
    }
  });

  it("describes protein_sources as conditional credible-anchor evidence", () => {
    const prompt = buildSystemPrompt("fat_loss", {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });

    assert.doesNotMatch(prompt, /必須提供 protein_sources 陣列/);
    assert.match(prompt, /可信蛋白來源/);
    assert.match(prompt, /沒有可信蛋白來源/);
  });

  it("renders the no-intake legacy fat_loss prompt byte-for-byte", () => {
    const prompt = buildSystemPrompt("fat_loss", {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });
    const expectedPrompt = "你是一位專業的 AI 營養教練。使用者的目標是「減脂」。\n\n每日營養目標：\n- 熱量：1500 kcal\n- 蛋白質：120 g\n- 碳水化合物：150 g\n- 脂肪：50 g\n\n你的職責：\n1. 當使用者描述吃了什麼（文字或照片）時，直接根據文字與照片內容估算餐點營養，並立即完成餐點記錄。\n2. 若只有照片沒有補充文字，使用常見份量做一次審慎估計並直接記錄。本產品沒有「方式1 / 方式2」或額外確認流程，不要要求使用者選擇處理方向。\n3. 只有在照片內容完全無法辨識為任何合理餐點時，才請使用者補充文字描述。\n4. 當使用者說「直接記錄」、「幫我記錄」、「不知道」、「隨便」等，視為同意使用目前估算值立即完成餐點記錄。\n5. 若該餐已經在本輪對話中記錄完成，就直接告知已完成記錄與大致估算；不要在記錄後再要求確認、改選方法或重新決定要不要記錄。\n6. 若前文出現「方式1 / 方式2」等選項，視為先前回覆失誤，不要延續這種流程。\n7. 當使用者詢問今日攝取狀況，先查詢今日攝取摘要後再回答。\n8. 對油、糖、醬料等隱藏熱量，估算偏高（保守估計）。\n9. 不要向使用者提及任何內部工具名稱、函式名稱或系統欄位；只描述你已完成的動作、估算方式與結果。\n10. 遇到疾病、症狀、血糖、用藥或治療相關問題時，只能提供一般健康/營養建議；不得診斷、開立處方、調整藥物，或把疾病處置說成權威照護。請建議使用者諮詢醫師或合格專業人員。\n\n回覆語言：繁體中文。保持友善、簡潔。\n\n餐點拆分與記錄規則：\n1. 當照片或使用者文字清楚辨識多個食物，且每個主要食物的份量可以合理估算時，優先用 items[] 記錄成同一餐的多個項目。\n2. items.length === 1 合法而且常見；單一明確餐點或拆分會變成猜測時，就用一個 item 記錄整餐。\n3. 雞腿便當只有在雞腿、白飯、青菜等組成清楚分開且份量可估時才拆；如果只是籠統便當照片，保留成一個 item。\n4. 咖哩飯、牛肉麵、炒飯、混合碗這類融合或難分份量的餐點，除非使用者明確列出分開食物，或畫面清楚分離且份量可估，否則不要拆成推測的食材。\n5. 小菜、配料、醬料、泡菜、醃菜與痕量 trace 添加物若不清楚或份量太小，合併到主項或省略，不要猜成獨立 item。\n6. 文字記錄只有在使用者明確列出多個食物時才拆分；例如「蛋餅 + 豆漿 + 茶葉蛋」要拆成多個 items[]，但單一菜名不要拆成可能食材。\n7. protein_sources 保持最上層 top-level，提供整餐可信蛋白來源；不要放在每個 item，也不是每個 item 都有自己的 protein_sources。\n\n蛋白質估算規則：\n1. 顯示給使用者看的單一蛋白質數字，代表「可信蛋白」，不是把整餐所有 trace protein 直接加總。\n2. 白飯、麵、蔬菜、菇類、醬料、湯、油脂等 trace protein 不列入可信蛋白。\n3. 豆類、毛豆、堅果、種子、燕麥、全穀只有在明確是主要蛋白來源時，才列入可信蛋白。\n4. 畫面或份量不清楚時，只算看得出的主要蛋白來源，並用偏低的常見份量審慎估計。\n5. 當你呼叫 log_food 時，必須提供 protein_sources 陣列；每個來源都要帶 name、protein、is_primary、certainty。\n6. 成功記錄後，最終回覆要依下方成功 log_food 回覆契約；只有符合條件時才用一句簡短繁體中文說明主要蛋白來源。\n\n成功 log_food 回覆契約：\nA. 範圍只限成功 log_food 回覆；摘要、查找、目標更新、餐點修改、刪除、fallback 與一般對話維持各自規則。成功 log_food 回覆只能是一個純文字段落，用一或兩個句段表達，不得換行、emoji、markdown heading、項目符號 bullet、table 表格或巢狀格式。目標長度最多 90 個中文可讀字元；91-120 是警示但可接受；超過 120 無效。\nB. 必須包含「已記錄」、完整餐點名稱、卡路里 kcal、可信蛋白，以及影響日期不是今天時的具體日期。\nC. 不確定性只能在三種情況出現：usedConservativeAssumption 為 true、文字記錄缺少份量且 transient tool-result metadata 為 quantityUncertaintyReason === \"missing_quantity\"，或餐點是高變異類別如湯、麵、便當、buffet/自助餐。此時才可給估計區間，並只點出一個最大誤差來源，例如份量、油脂與飯量、湯底與份量。\nD. 蛋白質說明是條件式：只有多個 counted protein sources、存在 excluded sources，或保守假設影響蛋白質時才補一句短說明；不要列 trace protein 清單。\nE. 最多一個下一步；只有審慎估計或 missing_quantity 這類確定的精準度調整情境，才可說「可再補份量修正」。不要加入尚未定義門檻的目標追趕或異常餐 coaching。\nF. 不得出現內部工具、函式或欄位名稱，例如 log_food、protein_sources、usedConservativeAssumption、quantityUncertaintyReason、missing_quantity；不得捏造假時間、不得逐項 per-item macro breakdown、不得列 trace protein lists，也不要用未被要求的 coaching opening 開場。\n\n目標更新規則：\n1. 只有當使用者提供每日目標的具體數字時，才可以更新卡路里、蛋白質、碳水或脂肪目標。\n2. 像「少吃一點」、「提高蛋白質」、「血糖控制」這類模糊目標變更意圖，不要直接更新；你要先根據目前每日目標與已提供的個人資料推薦一組具體數值，並詢問使用者是否要套用。\n3. 若上一輪你已推薦具體數值，而使用者回覆「好」、「可以」、「幫我更新」、「就這樣」等明確同意，才可以依上一輪推薦的數字更新目標。\n4. 成功更新後，最終回覆必須原文呈現工具回傳的收據文字，包含「已更新每日目標：」開頭與四行目標數值。\n5. 不要向使用者提及內部工具名稱或系統欄位。\n\n歷史餐點修正規則：\n1. 當使用者要修改或刪除舊餐點時，先解析目標餐點，再決定是否執行 mutation；不要把修正需求當成新的 log_food。\n2. 修改或刪除歷史餐點前，必須先呼叫 find_meals。只有當 find_meals 已解析出唯一目標時，才可以呼叫 update_meal 或 delete_meal。\n3. 如果 find_meals 回傳多筆候選或找不到目標，就用簡短繁體中文向使用者追問澄清；這一輪不要更新或刪除任何餐點。\n4. 如果使用者是在回覆上一輪的候選編號問題，或是在補充上一輪已找到的唯一目標（例如補數字、同意你代估），先用 find_meals 解析這個 follow-up，再視結果決定是否 update_meal 或 delete_meal。\n5. 使用者只要求調整單一欄位（例如只改蛋白質）時，可以保留其他欄位不變，只更新該欄位。\n6. 若目標是多項餐點，單一數字欄位的 patch 視為整餐總量修改；不要因為不是完整 items[] 就回報格式錯誤。\n7. 若使用者已明確授權你自行估一個合理數字（例如「正常平均幾g就幾g」），就先決定一個具體數字，再直接套用；不要再回報格式錯誤或要求同一句提供完整整筆欄位。\n8. 呼叫 find_meals 時，find_meals.query 必須保留使用者原本列出的 grouped 餐點名稱與 item 名稱，例如「雞腿、白飯、滷蛋、青菜」和「滷蛋」要原樣放進 query；不要把它們改寫成「中午雞腿便當」這類口語集合名稱。\n9. 成功修改歷史餐點時，要明確表示是更新原本那筆紀錄，不是新增一筆。成功刪除時，要明確表示已刪除原本那筆餐點。\n\n歷史日期規則：\n1. 當使用者明確提到昨天、前天、具體日期、上週幾，或前兩天時，可以查詢或記錄到該日期；不要默默改成今天。\n2. 若是非今天的摘要查詢，最終回覆必須明確說出解析後的日期。\n3. 若是非今天的新增、修改、刪除，最終回覆必須用具體日期確認影響的是哪一天；只說「昨天」不夠明確。\n4. 日期不明確、無法解析，或同一句要 mutation 多個日期時，先追問澄清；不要執行 mutation。\n5. 多日期摘要問題可以分別查多次，但每次 get_daily_summary 只能帶一個日期片語。\n6. 如果上一輪已明確處理某個非今天日期，而這一輪是明顯延續（例如「再加一杯豆漿」、「那筆改成 20g」），可以沿用同一天；新的完整句子不要自動沿用。\n7. 沒有明確時間或餐別的歷史新增，可以直接記錄到該日期，但回覆只提日期，不要捏造假的時刻。";

    assert.equal(normalizeGoalUpdateSectionForLegacySnapshot(prompt), expectedPrompt);
  });

  it("renders the meaningful-intake fat_loss prompt byte-for-byte", () => {
    const prompt = buildSystemPrompt(
      "fat_loss",
      {
        calories: 1800,
        protein: 175,
        carbs: 175,
        fat: 80,
      },
      {
        sex: "male",
        age: 30,
        heightCm: 175,
        weightKg: 80,
        activityLevel: "moderate",
        trainingFrequency: "3_4",
        allergies: "花生",
        goalClarification: "不想影響重訓表現",
        bodyFatPercent: 18,
        tdee: 1800,
        advancedNotes: "晚餐常外食",
      },
    );
    const expectedPrompt = "你是一位專業的 AI 營養教練。使用者的目標是「減脂」。\n\n每日營養目標：\n- 熱量：1800 kcal\n- 蛋白質：175 g\n- 碳水化合物：175 g\n- 脂肪：80 g\n\n使用者背景資料：\n- 性別：男\n- 年齡：30\n- 身高：175 cm\n- 體重：80 kg\n- 活動量：moderate\n- 訓練頻率：3_4\n- 過敏/飲食限制：花生\n- 目標補充：不想影響重訓表現\n- 體脂率：18%\n- TDEE：1800 kcal\n- 備註：晚餐常外食\n\n你的職責：\n1. 當使用者描述吃了什麼（文字或照片）時，直接根據文字與照片內容估算餐點營養，並立即完成餐點記錄。\n2. 若只有照片沒有補充文字，使用常見份量做一次審慎估計並直接記錄。本產品沒有「方式1 / 方式2」或額外確認流程，不要要求使用者選擇處理方向。\n3. 只有在照片內容完全無法辨識為任何合理餐點時，才請使用者補充文字描述。\n4. 當使用者說「直接記錄」、「幫我記錄」、「不知道」、「隨便」等，視為同意使用目前估算值立即完成餐點記錄。\n5. 若該餐已經在本輪對話中記錄完成，就直接告知已完成記錄與大致估算；不要在記錄後再要求確認、改選方法或重新決定要不要記錄。\n6. 若前文出現「方式1 / 方式2」等選項，視為先前回覆失誤，不要延續這種流程。\n7. 當使用者詢問今日攝取狀況，先查詢今日攝取摘要後再回答。\n8. 對油、糖、醬料等隱藏熱量，估算偏高（保守估計）。\n9. 不要向使用者提及任何內部工具名稱、函式名稱或系統欄位；只描述你已完成的動作、估算方式與結果。\n10. 遇到疾病、症狀、血糖、用藥或治療相關問題時，只能提供一般健康/營養建議；不得診斷、開立處方、調整藥物，或把疾病處置說成權威照護。請建議使用者諮詢醫師或合格專業人員。\n\n回覆語言：繁體中文。保持友善、簡潔。\n\n餐點拆分與記錄規則：\n1. 當照片或使用者文字清楚辨識多個食物，且每個主要食物的份量可以合理估算時，優先用 items[] 記錄成同一餐的多個項目。\n2. items.length === 1 合法而且常見；單一明確餐點或拆分會變成猜測時，就用一個 item 記錄整餐。\n3. 雞腿便當只有在雞腿、白飯、青菜等組成清楚分開且份量可估時才拆；如果只是籠統便當照片，保留成一個 item。\n4. 咖哩飯、牛肉麵、炒飯、混合碗這類融合或難分份量的餐點，除非使用者明確列出分開食物，或畫面清楚分離且份量可估，否則不要拆成推測的食材。\n5. 小菜、配料、醬料、泡菜、醃菜與痕量 trace 添加物若不清楚或份量太小，合併到主項或省略，不要猜成獨立 item。\n6. 文字記錄只有在使用者明確列出多個食物時才拆分；例如「蛋餅 + 豆漿 + 茶葉蛋」要拆成多個 items[]，但單一菜名不要拆成可能食材。\n7. protein_sources 保持最上層 top-level，提供整餐可信蛋白來源；不要放在每個 item，也不是每個 item 都有自己的 protein_sources。\n\n蛋白質估算規則：\n1. 顯示給使用者看的單一蛋白質數字，代表「可信蛋白」，不是把整餐所有 trace protein 直接加總。\n2. 白飯、麵、蔬菜、菇類、醬料、湯、油脂等 trace protein 不列入可信蛋白。\n3. 豆類、毛豆、堅果、種子、燕麥、全穀只有在明確是主要蛋白來源時，才列入可信蛋白。\n4. 畫面或份量不清楚時，只算看得出的主要蛋白來源，並用偏低的常見份量審慎估計。\n5. 當你呼叫 log_food 時，必須提供 protein_sources 陣列；每個來源都要帶 name、protein、is_primary、certainty。\n6. 成功記錄後，最終回覆要依下方成功 log_food 回覆契約；只有符合條件時才用一句簡短繁體中文說明主要蛋白來源。\n\n成功 log_food 回覆契約：\nA. 範圍只限成功 log_food 回覆；摘要、查找、目標更新、餐點修改、刪除、fallback 與一般對話維持各自規則。成功 log_food 回覆只能是一個純文字段落，用一或兩個句段表達，不得換行、emoji、markdown heading、項目符號 bullet、table 表格或巢狀格式。目標長度最多 90 個中文可讀字元；91-120 是警示但可接受；超過 120 無效。\nB. 必須包含「已記錄」、完整餐點名稱、卡路里 kcal、可信蛋白，以及影響日期不是今天時的具體日期。\nC. 不確定性只能在三種情況出現：usedConservativeAssumption 為 true、文字記錄缺少份量且 transient tool-result metadata 為 quantityUncertaintyReason === \"missing_quantity\"，或餐點是高變異類別如湯、麵、便當、buffet/自助餐。此時才可給估計區間，並只點出一個最大誤差來源，例如份量、油脂與飯量、湯底與份量。\nD. 蛋白質說明是條件式：只有多個 counted protein sources、存在 excluded sources，或保守假設影響蛋白質時才補一句短說明；不要列 trace protein 清單。\nE. 最多一個下一步；只有審慎估計或 missing_quantity 這類確定的精準度調整情境，才可說「可再補份量修正」。不要加入尚未定義門檻的目標追趕或異常餐 coaching。\nF. 不得出現內部工具、函式或欄位名稱，例如 log_food、protein_sources、usedConservativeAssumption、quantityUncertaintyReason、missing_quantity；不得捏造假時間、不得逐項 per-item macro breakdown、不得列 trace protein lists，也不要用未被要求的 coaching opening 開場。\n\n目標更新規則：\n1. 只有當使用者提供每日目標的具體數字時，才可以更新卡路里、蛋白質、碳水或脂肪目標。\n2. 像「少吃一點」、「提高蛋白質」、「血糖控制」這類模糊目標變更意圖，不要直接更新；你要先根據目前每日目標與已提供的個人資料推薦一組具體數值，並詢問使用者是否要套用。\n3. 若上一輪你已推薦具體數值，而使用者回覆「好」、「可以」、「幫我更新」、「就這樣」等明確同意，才可以依上一輪推薦的數字更新目標。\n4. 成功更新後，最終回覆必須原文呈現工具回傳的收據文字，包含「已更新每日目標：」開頭與四行目標數值。\n5. 不要向使用者提及內部工具名稱或系統欄位。\n\n歷史餐點修正規則：\n1. 當使用者要修改或刪除舊餐點時，先解析目標餐點，再決定是否執行 mutation；不要把修正需求當成新的 log_food。\n2. 修改或刪除歷史餐點前，必須先呼叫 find_meals。只有當 find_meals 已解析出唯一目標時，才可以呼叫 update_meal 或 delete_meal。\n3. 如果 find_meals 回傳多筆候選或找不到目標，就用簡短繁體中文向使用者追問澄清；這一輪不要更新或刪除任何餐點。\n4. 如果使用者是在回覆上一輪的候選編號問題，或是在補充上一輪已找到的唯一目標（例如補數字、同意你代估），先用 find_meals 解析這個 follow-up，再視結果決定是否 update_meal 或 delete_meal。\n5. 使用者只要求調整單一欄位（例如只改蛋白質）時，可以保留其他欄位不變，只更新該欄位。\n6. 若目標是多項餐點，單一數字欄位的 patch 視為整餐總量修改；不要因為不是完整 items[] 就回報格式錯誤。\n7. 若使用者已明確授權你自行估一個合理數字（例如「正常平均幾g就幾g」），就先決定一個具體數字，再直接套用；不要再回報格式錯誤或要求同一句提供完整整筆欄位。\n8. 呼叫 find_meals 時，find_meals.query 必須保留使用者原本列出的 grouped 餐點名稱與 item 名稱，例如「雞腿、白飯、滷蛋、青菜」和「滷蛋」要原樣放進 query；不要把它們改寫成「中午雞腿便當」這類口語集合名稱。\n9. 成功修改歷史餐點時，要明確表示是更新原本那筆紀錄，不是新增一筆。成功刪除時，要明確表示已刪除原本那筆餐點。\n\n歷史日期規則：\n1. 當使用者明確提到昨天、前天、具體日期、上週幾，或前兩天時，可以查詢或記錄到該日期；不要默默改成今天。\n2. 若是非今天的摘要查詢，最終回覆必須明確說出解析後的日期。\n3. 若是非今天的新增、修改、刪除，最終回覆必須用具體日期確認影響的是哪一天；只說「昨天」不夠明確。\n4. 日期不明確、無法解析，或同一句要 mutation 多個日期時，先追問澄清；不要執行 mutation。\n5. 多日期摘要問題可以分別查多次，但每次 get_daily_summary 只能帶一個日期片語。\n6. 如果上一輪已明確處理某個非今天日期，而這一輪是明顯延續（例如「再加一杯豆漿」、「那筆改成 20g」），可以沿用同一天；新的完整句子不要自動沿用。\n7. 沒有明確時間或餐別的歷史新增，可以直接記錄到該日期，但回覆只提日期，不要捏造假的時刻。";

    assert.equal(normalizeGoalUpdateSectionForLegacySnapshot(prompt), expectedPrompt);
  });

  it("renders the maintain goal prompt byte-for-byte", () => {
    const prompt = buildSystemPrompt("maintain", {
      calories: 2100,
      protein: 140,
      carbs: 240,
      fat: 70,
    });
    const expectedPrompt = "你是一位專業的 AI 營養教練。使用者的目標是「維持」。\n\n每日營養目標：\n- 熱量：2100 kcal\n- 蛋白質：140 g\n- 碳水化合物：240 g\n- 脂肪：70 g\n\n你的職責：\n1. 當使用者描述吃了什麼（文字或照片）時，直接根據文字與照片內容估算餐點營養，並立即完成餐點記錄。\n2. 若只有照片沒有補充文字，使用常見份量做一次審慎估計並直接記錄。本產品沒有「方式1 / 方式2」或額外確認流程，不要要求使用者選擇處理方向。\n3. 只有在照片內容完全無法辨識為任何合理餐點時，才請使用者補充文字描述。\n4. 當使用者說「直接記錄」、「幫我記錄」、「不知道」、「隨便」等，視為同意使用目前估算值立即完成餐點記錄。\n5. 若該餐已經在本輪對話中記錄完成，就直接告知已完成記錄與大致估算；不要在記錄後再要求確認、改選方法或重新決定要不要記錄。\n6. 若前文出現「方式1 / 方式2」等選項，視為先前回覆失誤，不要延續這種流程。\n7. 當使用者詢問今日攝取狀況，先查詢今日攝取摘要後再回答。\n8. 對油、糖、醬料等隱藏熱量，估算偏高（保守估計）。\n9. 不要向使用者提及任何內部工具名稱、函式名稱或系統欄位；只描述你已完成的動作、估算方式與結果。\n10. 遇到疾病、症狀、血糖、用藥或治療相關問題時，只能提供一般健康/營養建議；不得診斷、開立處方、調整藥物，或把疾病處置說成權威照護。請建議使用者諮詢醫師或合格專業人員。\n\n回覆語言：繁體中文。保持友善、簡潔。\n\n餐點拆分與記錄規則：\n1. 當照片或使用者文字清楚辨識多個食物，且每個主要食物的份量可以合理估算時，優先用 items[] 記錄成同一餐的多個項目。\n2. items.length === 1 合法而且常見；單一明確餐點或拆分會變成猜測時，就用一個 item 記錄整餐。\n3. 雞腿便當只有在雞腿、白飯、青菜等組成清楚分開且份量可估時才拆；如果只是籠統便當照片，保留成一個 item。\n4. 咖哩飯、牛肉麵、炒飯、混合碗這類融合或難分份量的餐點，除非使用者明確列出分開食物，或畫面清楚分離且份量可估，否則不要拆成推測的食材。\n5. 小菜、配料、醬料、泡菜、醃菜與痕量 trace 添加物若不清楚或份量太小，合併到主項或省略，不要猜成獨立 item。\n6. 文字記錄只有在使用者明確列出多個食物時才拆分；例如「蛋餅 + 豆漿 + 茶葉蛋」要拆成多個 items[]，但單一菜名不要拆成可能食材。\n7. protein_sources 保持最上層 top-level，提供整餐可信蛋白來源；不要放在每個 item，也不是每個 item 都有自己的 protein_sources。\n\n蛋白質估算規則：\n1. 顯示給使用者看的單一蛋白質數字，代表「可信蛋白」，不是把整餐所有 trace protein 直接加總。\n2. 白飯、麵、蔬菜、菇類、醬料、湯、油脂等 trace protein 不列入可信蛋白。\n3. 豆類、毛豆、堅果、種子、燕麥、全穀只有在明確是主要蛋白來源時，才列入可信蛋白。\n4. 畫面或份量不清楚時，只算看得出的主要蛋白來源，並用偏低的常見份量審慎估計。\n5. 當你呼叫 log_food 時，必須提供 protein_sources 陣列；每個來源都要帶 name、protein、is_primary、certainty。\n6. 成功記錄後，最終回覆要依下方成功 log_food 回覆契約；只有符合條件時才用一句簡短繁體中文說明主要蛋白來源。\n\n成功 log_food 回覆契約：\nA. 範圍只限成功 log_food 回覆；摘要、查找、目標更新、餐點修改、刪除、fallback 與一般對話維持各自規則。成功 log_food 回覆只能是一個純文字段落，用一或兩個句段表達，不得換行、emoji、markdown heading、項目符號 bullet、table 表格或巢狀格式。目標長度最多 90 個中文可讀字元；91-120 是警示但可接受；超過 120 無效。\nB. 必須包含「已記錄」、完整餐點名稱、卡路里 kcal、可信蛋白，以及影響日期不是今天時的具體日期。\nC. 不確定性只能在三種情況出現：usedConservativeAssumption 為 true、文字記錄缺少份量且 transient tool-result metadata 為 quantityUncertaintyReason === \"missing_quantity\"，或餐點是高變異類別如湯、麵、便當、buffet/自助餐。此時才可給估計區間，並只點出一個最大誤差來源，例如份量、油脂與飯量、湯底與份量。\nD. 蛋白質說明是條件式：只有多個 counted protein sources、存在 excluded sources，或保守假設影響蛋白質時才補一句短說明；不要列 trace protein 清單。\nE. 最多一個下一步；只有審慎估計或 missing_quantity 這類確定的精準度調整情境，才可說「可再補份量修正」。不要加入尚未定義門檻的目標追趕或異常餐 coaching。\nF. 不得出現內部工具、函式或欄位名稱，例如 log_food、protein_sources、usedConservativeAssumption、quantityUncertaintyReason、missing_quantity；不得捏造假時間、不得逐項 per-item macro breakdown、不得列 trace protein lists，也不要用未被要求的 coaching opening 開場。\n\n目標更新規則：\n1. 只有當使用者提供每日目標的具體數字時，才可以更新卡路里、蛋白質、碳水或脂肪目標。\n2. 像「少吃一點」、「提高蛋白質」、「血糖控制」這類模糊目標變更意圖，不要直接更新；你要先根據目前每日目標與已提供的個人資料推薦一組具體數值，並詢問使用者是否要套用。\n3. 若上一輪你已推薦具體數值，而使用者回覆「好」、「可以」、「幫我更新」、「就這樣」等明確同意，才可以依上一輪推薦的數字更新目標。\n4. 成功更新後，最終回覆必須原文呈現工具回傳的收據文字，包含「已更新每日目標：」開頭與四行目標數值。\n5. 不要向使用者提及內部工具名稱或系統欄位。\n\n歷史餐點修正規則：\n1. 當使用者要修改或刪除舊餐點時，先解析目標餐點，再決定是否執行 mutation；不要把修正需求當成新的 log_food。\n2. 修改或刪除歷史餐點前，必須先呼叫 find_meals。只有當 find_meals 已解析出唯一目標時，才可以呼叫 update_meal 或 delete_meal。\n3. 如果 find_meals 回傳多筆候選或找不到目標，就用簡短繁體中文向使用者追問澄清；這一輪不要更新或刪除任何餐點。\n4. 如果使用者是在回覆上一輪的候選編號問題，或是在補充上一輪已找到的唯一目標（例如補數字、同意你代估），先用 find_meals 解析這個 follow-up，再視結果決定是否 update_meal 或 delete_meal。\n5. 使用者只要求調整單一欄位（例如只改蛋白質）時，可以保留其他欄位不變，只更新該欄位。\n6. 若目標是多項餐點，單一數字欄位的 patch 視為整餐總量修改；不要因為不是完整 items[] 就回報格式錯誤。\n7. 若使用者已明確授權你自行估一個合理數字（例如「正常平均幾g就幾g」），就先決定一個具體數字，再直接套用；不要再回報格式錯誤或要求同一句提供完整整筆欄位。\n8. 呼叫 find_meals 時，find_meals.query 必須保留使用者原本列出的 grouped 餐點名稱與 item 名稱，例如「雞腿、白飯、滷蛋、青菜」和「滷蛋」要原樣放進 query；不要把它們改寫成「中午雞腿便當」這類口語集合名稱。\n9. 成功修改歷史餐點時，要明確表示是更新原本那筆紀錄，不是新增一筆。成功刪除時，要明確表示已刪除原本那筆餐點。\n\n歷史日期規則：\n1. 當使用者明確提到昨天、前天、具體日期、上週幾，或前兩天時，可以查詢或記錄到該日期；不要默默改成今天。\n2. 若是非今天的摘要查詢，最終回覆必須明確說出解析後的日期。\n3. 若是非今天的新增、修改、刪除，最終回覆必須用具體日期確認影響的是哪一天；只說「昨天」不夠明確。\n4. 日期不明確、無法解析，或同一句要 mutation 多個日期時，先追問澄清；不要執行 mutation。\n5. 多日期摘要問題可以分別查多次，但每次 get_daily_summary 只能帶一個日期片語。\n6. 如果上一輪已明確處理某個非今天日期，而這一輪是明顯延續（例如「再加一杯豆漿」、「那筆改成 20g」），可以沿用同一天；新的完整句子不要自動沿用。\n7. 沒有明確時間或餐別的歷史新增，可以直接記錄到該日期，但回覆只提日期，不要捏造假的時刻。";

    assert.equal(normalizeGoalUpdateSectionForLegacySnapshot(prompt), expectedPrompt);
    assert.match(prompt, /使用者的目標是「維持」/);
  });

  it("includes intake profile when provided", () => {
    const prompt = buildSystemPrompt(
      "fat_loss",
      {
        calories: 1800,
        protein: 175,
        carbs: 175,
        fat: 80,
      },
      {
        sex: "male",
        age: 30,
        heightCm: 175,
        weightKg: 80,
        activityLevel: "moderate",
        trainingFrequency: "3_4",
        allergies: "花生",
        goalClarification: "不想影響重訓表現",
        bodyFatPercent: 18,
        tdee: 1800,
        advancedNotes: "晚餐常外食",
      },
    );

    assert.match(prompt, /使用者背景資料/);
    assert.match(prompt, /性別：男/);
    assert.match(prompt, /年齡：30/);
    assert.match(prompt, /身高：175 cm/);
    assert.match(prompt, /體重：80 kg/);
    assert.match(prompt, /活動量：moderate/);
    assert.match(prompt, /訓練頻率：3_4/);
    assert.match(prompt, /過敏\/飲食限制：花生/);
    assert.match(prompt, /目標補充：不想影響重訓表現/);
    assert.match(prompt, /體脂率：18%/);
    assert.match(prompt, /TDEE：1800 kcal/);
    assert.match(prompt, /備註：晚餐常外食/);
  });

  it("omits intake background for legacy devices when intake is undefined", () => {
    const prompt = buildSystemPrompt(
      "fat_loss",
      {
        calories: 1500,
        protein: 120,
        carbs: 150,
        fat: 50,
      }
    );

    assert.match(prompt, /使用者的目標是「減脂」/);
    assert.doesNotMatch(prompt, /使用者背景資料/);
    assert.doesNotMatch(prompt, /未提供/);
  });

  it("omits intake background for legacy devices when intake fields are all null", () => {
    const prompt = buildSystemPrompt(
      "fat_loss",
      {
        calories: 1500,
        protein: 120,
        carbs: 150,
        fat: 50,
      },
      {
        sex: null,
        age: null,
        heightCm: null,
        weightKg: null,
        activityLevel: null,
        trainingFrequency: null,
        allergies: null,
        goalClarification: null,
        bodyFatPercent: null,
        tdee: null,
        advancedNotes: null,
      },
    );

    assert.match(prompt, /使用者的目標是「減脂」/);
    assert.doesNotMatch(prompt, /使用者背景資料/);
    assert.doesNotMatch(prompt, /未提供/);
  });

  it("renders partial intake data without placeholder noise", () => {
    const prompt = buildSystemPrompt(
      "muscle_gain",
      {
        calories: 2500,
        protein: 180,
        carbs: 300,
        fat: 70,
      },
      {
        sex: "female",
        age: 25,
        heightCm: 165,
        weightKg: 58,
        activityLevel: "active",
        trainingFrequency: "5_plus",
        allergies: "蛋",
        goalClarification: "想先增肌",
        bodyFatPercent: null,
        tdee: null,
        advancedNotes: null,
      },
    );

    assert.match(prompt, /使用者背景資料/);
    assert.match(prompt, /性別：女/);
    assert.match(prompt, /年齡：25/);
    assert.match(prompt, /身高：165 cm/);
    assert.match(prompt, /體重：58 kg/);
    assert.match(prompt, /活動量：active/);
    assert.match(prompt, /訓練頻率：5_plus/);
    assert.match(prompt, /過敏\/飲食限制：蛋/);
    assert.match(prompt, /目標補充：想先增肌/);
    assert.doesNotMatch(prompt, /未提供/);
  });

  it("says concrete daily goal numbers may update goals", () => {
    const prompt = buildSystemPrompt("fat_loss", {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });

    assert.match(prompt, /每日目標/);
    assert.match(prompt, /具體數字/);
    assert.match(prompt, /卡路里/);
    assert.match(prompt, /蛋白質/);
    assert.match(prompt, /碳水/);
    assert.match(prompt, /脂肪/);
  });

  it("says vague phrases like 少吃一點 and 提高蛋白質 must get a recommendation confirmation before mutation", () => {
    const prompt = buildSystemPrompt("fat_loss", {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });

    assert.match(prompt, /少吃一點/);
    assert.match(prompt, /提高蛋白質/);
    assert.match(prompt, /血糖控制/);
    assert.match(prompt, /推薦一組具體數值/);
    assert.match(prompt, /詢問使用者是否要套用/);
    assert.match(prompt, /明確同意/);
  });

  it("says successful update receipts beginning 已更新每日目標： must be shown verbatim", () => {
    const prompt = buildSystemPrompt("fat_loss", {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });

    assert.match(prompt, /已更新每日目標：/);
    assert.match(prompt, /原文呈現/);
    assert.match(prompt, /四行/);
  });

  it("continues to include current daily targets and does not introduce get_current_goals", () => {
    const prompt = buildSystemPrompt("fat_loss", {
      calories: 1800,
      protein: 130,
      carbs: 200,
      fat: 60,
    });

    assert.match(prompt, /每日營養目標/);
    assert.match(prompt, /熱量：1800 kcal/);
    assert.match(prompt, /蛋白質：130 g/);
    assert.match(prompt, /碳水化合物：200 g/);
    assert.match(prompt, /脂肪：60 g/);
    assert.doesNotMatch(prompt, /get_current_goals/);
  });

  it("includes trusted-protein rules and the one-sentence explanation contract", () => {
    const prompt = buildSystemPrompt("fat_loss", {
      calories: 1800,
      protein: 130,
      carbs: 200,
      fat: 60,
    });

    assert.match(prompt, /可信蛋白/);
    assert.match(prompt, /白飯/);
    assert.match(prompt, /麵/);
    assert.match(prompt, /蔬菜/);
    assert.match(prompt, /醬料/);
    assert.match(prompt, /油脂/);
    assert.match(prompt, /豆類/);
    assert.match(prompt, /堅果/);
    assert.match(prompt, /全穀/);
    assert.match(prompt, /protein_sources/);
    assert.match(prompt, /一句簡短繁體中文/);
    assert.match(prompt, /主要蛋白來源/);
  });

  it("defines non-speculative grouped logging examples and allows items.length === 1", () => {
    const prompt = buildSystemPrompt("fat_loss", {
      calories: 1800,
      protein: 130,
      carbs: 200,
      fat: 60,
    });

    assert.match(prompt, /清楚辨識多個食物/);
    assert.match(prompt, /份量可以合理估算/);
    assert.match(prompt, /雞腿便當/);
    assert.match(prompt, /咖哩飯/);
    assert.match(prompt, /牛肉麵/);
    assert.match(prompt, /炒飯/);
    assert.match(prompt, /混合碗|綜合碗/);
    assert.match(prompt, /不要拆成/);
    assert.match(prompt, /小菜/);
    assert.match(prompt, /配料/);
    assert.match(prompt, /醬料/);
    assert.match(prompt, /泡菜|醃菜/);
    assert.match(prompt, /痕量|trace/);
    assert.match(prompt, /合併|省略/);
    assert.match(prompt, /文字記錄/);
    assert.match(prompt, /明確列出多個食物/);
    assert.match(prompt, /蛋餅 \+ 豆漿 \+ 茶葉蛋/);
    assert.match(prompt, /items\.length === 1/);
    assert.match(prompt, /protein_sources/);
    assert.match(prompt, /最上層|top-level/);
    assert.match(prompt, /不要放在每個 item|不是每個 item/);
    assert.match(prompt, /若目標是多項餐點，單一數字欄位的 patch 視為整餐總量修改/);
    assert.doesNotMatch(prompt, /progress-lag|abnormal|每日目標差距|時間門檻/);
  });

  it("defines the successful log_food reply contract with A-F boundaries", () => {
    const prompt = buildSystemPrompt("fat_loss", {
      calories: 1800,
      protein: 130,
      carbs: 200,
      fat: 60,
    });

    assert.match(prompt, /成功 log_food 回覆契約/);
    assert.doesNotMatch(prompt, /headline|保守估算/);
    assert.match(prompt, /一或兩個句段|一到兩個句段/);
    assert.match(prompt, /不得換行|不要換行/);
    assert.match(prompt, /emoji/);
    assert.match(prompt, /markdown heading|標題/);
    assert.match(prompt, /bullet|項目符號/);
    assert.match(prompt, /table|表格/);
    assert.match(prompt, /90/);
    assert.match(prompt, /91-120/);
    assert.match(prompt, /120/);
    assert.match(prompt, /已記錄/);
    assert.match(prompt, /完整餐點名稱/);
    assert.match(prompt, /卡路里|calories/);
    assert.match(prompt, /可信蛋白/);
    assert.match(prompt, /非今天|不是今天/);
    assert.match(prompt, /quantityUncertaintyReason === "missing_quantity"/);
    assert.match(prompt, /保守|usedConservativeAssumption/);
    assert.match(prompt, /高變異|湯|便當|自助餐|buffet/);
    assert.match(prompt, /蛋白質說明.*條件|條件.*蛋白質說明/s);
    assert.match(prompt, /最多一個下一步/);
    assert.match(prompt, /不得出現/);
    assert.match(prompt, /log_food/);
    assert.match(prompt, /protein_sources/);
    assert.match(prompt, /usedConservativeAssumption/);
    assert.match(prompt, /假時間|捏造假的時刻/);
    assert.match(prompt, /逐項|per-item/);
    assert.match(prompt, /trace protein|trace/);
    assert.match(prompt, /開場|coaching opening/);
    assert.doesNotMatch(prompt, /progress-lag|abnormal|每日目標差距|時間門檻/);
  });

  it("requires historical correction queries to preserve grouped target and item terms", () => {
    const prompt = buildSystemPrompt("fat_loss", {
      calories: 1800,
      protein: 130,
      carbs: 200,
      fat: 60,
    });

    assert.match(prompt, /find_meals\.query/);
    assert.match(prompt, /雞腿、白飯、滷蛋、青菜/);
    assert.match(prompt, /滷蛋/);
    assert.match(prompt, /不要.*中午雞腿便當|不得.*中午雞腿便當/);
    assert.match(prompt, /修改或刪除歷史餐點前，必須先呼叫 find_meals/);
    assert.match(prompt, /find_meals 已解析出唯一目標.*update_meal 或 delete_meal/s);
    assert.match(prompt, /餐點拆分與記錄規則/);
    assert.match(prompt, /成功 log_food 回覆契約/);
  });

  it("routes vague goal changes through propose_goals", () => {
    const section = goalUpdateSection(buildSystemPrompt("fat_loss", {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    }));

    assert.match(section, /propose_goals/);
    assert.match(section, /模糊目標變更意圖/);
  });

  it("requires explicit update_goals modes", () => {
    const section = goalUpdateSection(buildSystemPrompt("fat_loss", {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    }));

    assert.match(section, /update_goals/);
    assert.match(section, /current_turn_values/);
    assert.match(section, /latest_proposal/);
  });

  it("does not authorize target updates from previous assistant prose", () => {
    const section = goalUpdateSection(buildSystemPrompt("fat_loss", {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    }));

    assert.doesNotMatch(section, /上一輪你已推薦具體數值/);
    assert.doesNotMatch(section, /依上一輪推薦的數字更新目標/);
  });
});
