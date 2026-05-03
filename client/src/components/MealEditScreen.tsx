import { useEffect, useState } from "react";
import { deleteMeal, getMeals, updateMeal } from "../api.js";
import { formatLocalDate } from "../lib/time.js";
import { useStore } from "../store.js";
import type { DailySummary, MealEditPayload } from "../types.js";
import { PersistedAssetImage } from "./PersistedAssetImage.js";
import { SportCameraIcon, SportChevronLeftIcon } from "./SportIcons.js";
import { SportCard, SportIconButton, SportScreen } from "./SportPrimitives.js";

type DraftState = {
  foodName: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
};

type NutritionKey = "calories" | "protein" | "carbs" | "fat";

const NUTRITION_FIELDS: Array<{ key: NutritionKey; label: string; unit: "kcal" | "g" }> = [
  { key: "calories", label: "熱量", unit: "kcal" },
  { key: "protein", label: "蛋白質", unit: "g" },
  { key: "carbs", label: "碳水", unit: "g" },
  { key: "fat", label: "脂肪", unit: "g" },
];

function createDraft(payload: MealEditPayload): DraftState {
  return {
    foodName: payload.foodName,
    calories: String(Math.round(payload.calories)),
    protein: String(Math.round(payload.protein)),
    carbs: String(Math.round(payload.carbs)),
    fat: String(Math.round(payload.fat)),
  };
}

function parseDraft(draft: DraftState) {
  const foodName = draft.foodName.trim();
  const rawValues = [draft.calories, draft.protein, draft.carbs, draft.fat];
  if (!foodName || rawValues.some((value) => value.trim() === "")) {
    return null;
  }

  const [calories, protein, carbs, fat] = rawValues.map(Number);
  if (
    calories === undefined ||
    protein === undefined ||
    carbs === undefined ||
    fat === undefined ||
    [calories, protein, carbs, fat].some((value) => !Number.isFinite(value) || value < 0)
  ) {
    return null;
  }

  return { foodName, calories, protein, carbs, fat };
}

export function MealEditScreen({ onBack }: { onBack: () => void }) {
  const secondaryScreen = useStore((s) => s.secondaryScreen);
  const setDailySummary = useStore((s) => s.setDailySummary);
  const setMeals = useStore((s) => s.setMeals);
  const recordMealMutation = useStore((s) => s.recordMealMutation);
  const recoverGuestSession = useStore((s) => s.recoverGuestSession);
  const payload = secondaryScreen?.screen === "mealEdit" ? secondaryScreen.payload : undefined;
  const origin = secondaryScreen?.screen === "mealEdit" ? secondaryScreen.origin : undefined;
  const [draft, setDraft] = useState<DraftState | null>(() => (payload ? createDraft(payload) : null));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(payload ? createDraft(payload) : null);
    setError(null);
  }, [payload]);

  async function refreshAfterMealMutation(affectedDate: string, dailySummary: DailySummary) {
    recordMealMutation(affectedDate);
    if (dailySummary.date !== formatLocalDate(new Date())) {
      return;
    }

    setDailySummary(dailySummary);
    const { meals } = await getMeals({ refreshReason: "meal_mutation" });
    setMeals(meals);
  }

  async function handleSave() {
    if (!payload || !draft) {
      return;
    }

    const parsedDraft = parseDraft(draft);
    if (!parsedDraft) {
      setError("請確認餐名與數值都已填寫，且數值不可為負。");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await updateMeal(payload.mealId, {
        ...parsedDraft,
        imageAssetId: payload.imageAssetId ?? null,
      });
      await refreshAfterMealMutation(response.affectedDate, response.dailySummary);
      onBack();
    } catch (err) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        void recoverGuestSession();
      } else {
        setError("餐點暫時無法儲存，請稍後再試。");
      }
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (!payload) {
      return;
    }

    if (!window.confirm("刪除這筆餐點？這會建立刪除 revision。")) {
      return;
    }

    setPending(true);
    setError(null);
    try {
      const { affectedDate, dailySummary } = await deleteMeal(payload.mealId);
      await refreshAfterMealMutation(affectedDate, dailySummary);
      onBack();
    } catch (err) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        void recoverGuestSession();
      } else {
        setError("餐點暫時無法刪除，請稍後再試。");
      }
    } finally {
      setPending(false);
    }
  }

  const backLabel = origin === "chat" ? "返回對話" : origin === "history" ? "返回歷史" : "返回";

  if (!payload || !draft) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col bg-[var(--sp-bg)]">
        <SportScreen className="sp-meal-edit-screen">
          <header className="sp-meal-edit-header">
            <SportIconButton aria-label="返回" className="sp-meal-edit-back" onClick={onBack}>
              <SportChevronLeftIcon size={18} stroke={2} />
            </SportIconButton>
            <div className="sp-meal-edit-title">
              <h1>編輯餐點</h1>
              <div>REV · MEAL</div>
            </div>
            <div className="sp-meal-edit-header-spacer" aria-hidden="true" />
          </header>
          <main className="screen-scroll-safe sp-meal-edit-scroll">
            <SportCard className="sp-meal-edit-empty" variant="flat">
              找不到要編輯的餐點。
            </SportCard>
          </main>
        </SportScreen>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[var(--sp-bg)]">
      <SportScreen className="sp-meal-edit-screen">
        <header className="sp-meal-edit-header">
          <SportIconButton aria-label={backLabel} className="sp-meal-edit-back" onClick={onBack}>
            <SportChevronLeftIcon size={18} stroke={2} />
          </SportIconButton>
          <div className="sp-meal-edit-title">
            <h1>編輯餐點</h1>
            <div>REV · AI ESTIMATE</div>
          </div>
          <div className="sp-meal-edit-header-spacer" aria-hidden="true" />
        </header>

        <main className="screen-scroll-safe sp-meal-edit-scroll">
          <section className="sp-meal-edit-image-frame">
            {payload.imageUrl ? (
              <PersistedAssetImage
                src={payload.imageUrl}
                alt={`${payload.foodName} 照片`}
                imgClassName="sp-meal-edit-image"
                fallbackClassName="sp-meal-edit-image-fallback"
                fallbackStyle={{
                  background: "var(--sp-surface-2)",
                  color: "var(--sp-ink-2)",
                }}
              />
            ) : (
              <div className="sp-meal-edit-image-placeholder" aria-hidden="true">
                <SportCameraIcon size={28} stroke={1.6} />
                <span>餐點照片</span>
              </div>
            )}
          </section>

          <SportCard className="sp-meal-edit-form">
            <div className="sp-meal-edit-form-head">
              <p>
                AI 估算 · 點任一欄位調整
              </p>
            </div>

            <label className="sp-meal-edit-field sp-meal-edit-name-field">
              <span>
                餐點名稱
              </span>
              <input
                value={draft.foodName}
                disabled={pending}
                onChange={(event) => setDraft({ ...draft, foodName: event.target.value })}
              />
            </label>

            <div className="sp-meal-edit-macro-head">
              <span>營養素</span>
              <span>會建立新 revision</span>
            </div>

            <div className="sp-meal-edit-macro-grid">
              {NUTRITION_FIELDS.map((field) => (
                <label key={field.key} className="sp-meal-edit-field sp-meal-edit-macro-field">
                  <span>
                    {field.label}
                  </span>
                  <div>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="decimal"
                      value={draft[field.key]}
                      disabled={pending}
                      onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                    />
                    <small>{field.unit}</small>
                  </div>
                </label>
              ))}
            </div>

            <div className="sp-meal-edit-delete-row">
              <button type="button" onClick={handleDelete} disabled={pending}>
                {pending ? "處理中..." : "刪除"}
              </button>
            </div>

            <p className="sp-meal-edit-note">
              修改會建立新 revision，保留原始紀錄。
            </p>
            {error ? (
              <div className="sp-meal-edit-error" role="alert">
                {error}
              </div>
            ) : null}
          </SportCard>
        </main>

        <footer className="sp-meal-edit-footer">
          <button type="button" className="sp-meal-edit-cancel" onClick={onBack} disabled={pending}>
            取消
          </button>
          <button type="button" className="sp-meal-edit-save" onClick={handleSave} disabled={pending}>
            {pending ? "儲存中..." : "儲存"}
          </button>
        </footer>
      </SportScreen>
    </div>
  );
}
