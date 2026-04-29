import { useEffect, useState } from "react";
import { deleteMeal, getMeals, updateMeal } from "../api.js";
import { formatLocalDate } from "../lib/time.js";
import { useStore } from "../store.js";
import type { DailySummary, MealEditPayload } from "../types.js";
import { PersistedAssetImage } from "./PersistedAssetImage.js";
import { SecondaryHeader, SketchButton, SketchDashedBox, SketchScreen, SketchSoftBox } from "./SketchPrimitives.js";

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
  const calories = Number(draft.calories);
  const protein = Number(draft.protein);
  const carbs = Number(draft.carbs);
  const fat = Number(draft.fat);
  const values = [calories, protein, carbs, fat];

  if (!foodName || values.some((value) => !Number.isFinite(value) || value < 0)) {
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

  const backLabel = origin === "chat" ? "‹ 對話" : "‹ 返回";

  if (!payload || !draft) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col bg-[var(--sk-paper)]">
        <SketchScreen>
          <SecondaryHeader title="編輯餐點" backLabel="‹ 返回" onBack={onBack} />
          <main className="screen-scroll-safe p-5">
            <SketchDashedBox className="p-4">
              <p className="sk-body text-sm" style={{ color: "var(--sk-ink-soft)" }}>
                找不到要編輯的餐點。
              </p>
            </SketchDashedBox>
          </main>
        </SketchScreen>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[var(--sk-paper)]">
      <SketchScreen className="flex min-h-0 flex-1 flex-col">
        <SecondaryHeader title="編輯餐點" backLabel={backLabel} onBack={onBack} />
        <main className="screen-scroll-safe space-y-4 px-5 pb-32 pt-2">
          <section
            className="grid h-44 place-items-center overflow-hidden rounded-xl"
            style={{
              background: "var(--sk-paper-soft)",
              border: "2px solid var(--sk-ink)",
              boxShadow: "2px 3px 0 var(--sk-ink)",
            }}
          >
            {payload.imageUrl ? (
              <PersistedAssetImage
                src={payload.imageUrl}
                alt={`${payload.foodName} 照片`}
                imgClassName="h-full w-full object-cover"
                fallbackClassName="grid h-full w-full place-items-center text-xs"
                fallbackStyle={{
                  background: "var(--sk-paper-warm)",
                  color: "var(--sk-ink-soft)",
                }}
              />
            ) : (
              <div className="sk-body text-sm" style={{ color: "var(--sk-ink-soft)" }}>
                meal photo
              </div>
            )}
          </section>

          <SketchSoftBox className="space-y-4 p-4">
            <div>
              <p className="sk-body text-xs" style={{ color: "var(--sk-ink-soft)" }}>
                AI 估算 · 點任一欄位調整
              </p>
              <label className="mt-3 block">
                <span className="mb-1 block text-xs font-semibold" style={{ color: "var(--sk-ink-soft)" }}>
                  餐點名稱
                </span>
                <input
                  value={draft.foodName}
                  disabled={pending}
                  onChange={(event) => setDraft({ ...draft, foodName: event.target.value })}
                  className="w-full rounded-lg px-3 py-3 text-base focus:outline-none"
                  style={{
                    background: "var(--sk-paper)",
                    border: "1.5px solid var(--sk-ink)",
                    color: "var(--sk-ink)",
                    fontFamily: "var(--sk-font-body)",
                  }}
                />
              </label>
            </div>

            <div className="space-y-2">
              {NUTRITION_FIELDS.map((field) => (
                <label
                  key={field.key}
                  className="grid min-h-14 grid-cols-[72px_minmax(0,1fr)_40px] items-center gap-2 rounded-lg px-3 py-2"
                  style={{
                    background: "var(--sk-paper)",
                    border: "1.5px solid var(--sk-ink)",
                  }}
                >
                  <span className="sk-body text-xs" style={{ color: "var(--sk-ink-soft)" }}>
                    {field.label}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="decimal"
                    value={draft[field.key]}
                    disabled={pending}
                    onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                    className="min-w-0 bg-transparent text-right text-base font-semibold focus:outline-none"
                    style={{
                      color: "var(--sk-ink)",
                      fontFamily: "var(--sk-font-mono)",
                    }}
                  />
                  <span className="sk-body text-xs" style={{ color: "var(--sk-ink-soft)" }}>
                    {field.unit}
                  </span>
                </label>
              ))}
            </div>

            <p className="sk-body text-xs" style={{ color: "var(--sk-ink-soft)" }}>
              修改會建立新 revision，保留原始紀錄。
            </p>
            {error ? (
              <div className="sk-box-dashed px-3 py-2">
                <p className="sk-body text-xs" style={{ color: "var(--sk-accent)" }}>
                  {error}
                </p>
              </div>
            ) : null}
          </SketchSoftBox>
        </main>

        <footer
          className="absolute inset-x-0 bottom-0 z-10 flex gap-3 px-5 pb-[calc(1rem+var(--app-bottom-occlusion,0px))] pt-3"
          style={{
            background: "linear-gradient(180deg, rgba(250,246,235,0) 0%, var(--sk-paper) 24%)",
          }}
        >
          <SketchButton
            aria-label="Delete meal"
            onClick={handleDelete}
            disabled={pending}
            className="flex-1 py-3 text-sm"
          >
            {pending ? "處理中..." : "刪除"}
          </SketchButton>
          <SketchButton onClick={handleSave} disabled={pending} variant="accent" className="flex-1 py-3 text-sm">
            {pending ? "儲存中..." : "儲存"}
          </SketchButton>
        </footer>
      </SketchScreen>
    </div>
  );
}
