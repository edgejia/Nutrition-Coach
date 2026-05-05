import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "../../server/orchestrator/system-prompt.js";

describe("buildSystemPrompt", () => {
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
});
