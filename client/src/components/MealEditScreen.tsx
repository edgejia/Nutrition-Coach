import { useEffect, useState } from "react";
import { deleteMeal, getMeals, MealRevisionConflictError, updateMeal } from "../api.js";
import { formatLocalDate } from "../lib/time.js";
import { refreshAfterMealMutation } from "../meal-edit-refresh.js";
import { useStore } from "../store.js";
import type { MealEditPayload } from "../types.js";
import { PersistedAssetImage } from "./PersistedAssetImage.js";
import { SportChevronLeftIcon } from "./SportIcons.js";
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

const MULTI_ITEM_UPDATE_ERROR_CODE = "MEAL_REQUIRES_" + "GROUP" + "ED_UPDATE";
const MULTI_ITEM_UPDATE_ERROR_COPY = "這筆餐點包含多個項目，請到「對話」修正，避免把多項餐點合併成單一餐點。";
const MEAL_REVISION_REQUIRED = "MEAL_REVISION_REQUIRED";
const MEAL_REVISION_STALE = "MEAL_REVISION_STALE";
const STALE_EDIT_ERROR_COPY = "餐點已被更新，請重新載入最新餐點後再編輯。";
const MISSING_REVISION_ERROR_COPY = "餐點版本已失效，請重新載入最新餐點後再編輯。";
const STALE_DELETE_ERROR_COPY = "餐點已被更新，未刪除。請重新載入最新餐點後再決定是否刪除。";

function formatMealItemMacro(value: number, unit: "kcal" | "g") {
  return `${Math.round(value)} ${unit}`;
}

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

function MealEditImageFrame({ payload }: { payload: MealEditPayload }) {
  return (
    <section className="sp-meal-edit-image-frame">
      {payload.imageUrl ? (
        <>
          <div className="sp-meal-edit-image-copy">
            <span>整餐照片</span>
            <p>這張照片代表整餐，不是單一食物裁切。</p>
          </div>
          <div className="sp-meal-edit-image-media">
            <PersistedAssetImage
              src={payload.imageUrl}
              alt={`${payload.foodName} 整餐照片`}
              imgClassName="sp-meal-edit-image"
              fallbackClassName="sp-meal-edit-image-fallback"
              fallbackStyle={{
                background: "var(--sp-surface-2)",
                color: "var(--sp-ink-2)",
              }}
            />
            <p className="sp-meal-edit-image-error-copy">
              圖片載入失敗，餐點資料仍可編輯。請稍後再試。
            </p>
          </div>
        </>
      ) : (
        <div className="sp-meal-edit-image-placeholder">
          <span>尚未附上餐點照片</span>
          <p>這筆餐點是文字記錄，仍可編輯名稱與營養數值。</p>
        </div>
      )}
    </section>
  );
}

export function MealEditScreen({ onBack }: { onBack: () => void }) {
  const secondaryScreen = useStore((s) => s.secondaryScreen);
  const setActiveScreen = useStore((s) => s.setActiveScreen);
  const closeSecondaryScreen = useStore((s) => s.closeSecondaryScreen);
  const setDailySummary = useStore((s) => s.setDailySummary);
  const setMeals = useStore((s) => s.setMeals);
  const redactChatReceiptIdentity = useStore((s) => s.redactChatReceiptIdentity);
  const recordMealMutation = useStore((s) => s.recordMealMutation);
  const recoverGuestSession = useStore((s) => s.recoverGuestSession);
  const payload = secondaryScreen?.screen === "mealEdit" ? secondaryScreen.payload : undefined;
  const origin = secondaryScreen?.screen === "mealEdit" ? secondaryScreen.origin : undefined;
  const isGroupedPayload = Boolean(payload && payload.itemCount > 1);
  const [draft, setDraft] = useState<DraftState | null>(() => (payload && !isGroupedPayload ? createDraft(payload) : null));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleBlocked, setStaleBlocked] = useState(false);
  const [staleAffectedDate, setStaleAffectedDate] = useState<string | null>(null);

  useEffect(() => {
    setDraft(payload && payload.itemCount <= 1 ? createDraft(payload) : null);
    setError(null);
    setStaleBlocked(false);
    setStaleAffectedDate(null);
  }, [payload]);

  async function refreshAfterStaleConflict(mealId: string, affectedDate: string) {
    redactChatReceiptIdentity(mealId);
    recordMealMutation(affectedDate);
    setStaleAffectedDate(affectedDate);
    if (affectedDate !== formatLocalDate(new Date())) {
      return;
    }

    const { meals } = await getMeals({ refreshReason: "meal_mutation" });
    setMeals(meals);
  }

  async function handleMealRevisionConflict(error: MealRevisionConflictError, mode: "save" | "delete") {
    setStaleBlocked(true);
    setError(
      mode === "delete"
        ? STALE_DELETE_ERROR_COPY
        : error.code === MEAL_REVISION_REQUIRED
          ? MISSING_REVISION_ERROR_COPY
          : error.code === MEAL_REVISION_STALE
            ? STALE_EDIT_ERROR_COPY
            : STALE_EDIT_ERROR_COPY,
    );
    await refreshAfterStaleConflict(error.mealId, error.affectedDate);
  }

  async function handleReloadStaleMeal() {
    if (!staleAffectedDate) {
      onBack();
      return;
    }

    if (staleAffectedDate === formatLocalDate(new Date())) {
      const { meals } = await getMeals({ refreshReason: "meal_mutation" });
      setMeals(meals);
    }

    onBack();
  }

  async function handleSave() {
    if (!payload || staleBlocked || payload.itemCount > 1 || !draft) {
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
        expectedMealRevisionId: payload.mealRevisionId,
        ...parsedDraft,
        imageAssetId: payload.imageAssetId ?? null,
      });
      try {
        await refreshAfterMealMutation({
          redactChatReceiptIdentity,
          recordMealMutation,
          setDailySummary,
          getMeals,
          setMeals,
          todayKey: () => formatLocalDate(new Date()),
        }, {
          mealId: payload.mealId,
          affectedDate: response.affectedDate,
          dailySummary: response.dailySummary,
        });
      } catch {
        recordMealMutation(response.affectedDate);
      }
      onBack();
    } catch (err) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        void recoverGuestSession();
      } else if (err instanceof Error && err.message === MULTI_ITEM_UPDATE_ERROR_CODE) {
        setError(MULTI_ITEM_UPDATE_ERROR_COPY);
      } else if (err instanceof MealRevisionConflictError) {
        await handleMealRevisionConflict(err, "save");
      } else {
        setError("餐點暫時無法儲存，請稍後再試。");
      }
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (!payload || staleBlocked) {
      return;
    }

    if (!window.confirm("刪除這筆餐點？系統會保留歷史紀錄。")) {
      return;
    }

    setPending(true);
    setError(null);
    try {
      const { affectedDate, dailySummary } = await deleteMeal(payload.mealId, {
        expectedMealRevisionId: payload.mealRevisionId,
      });
      try {
        await refreshAfterMealMutation({
          redactChatReceiptIdentity,
          recordMealMutation,
          setDailySummary,
          getMeals,
          setMeals,
          todayKey: () => formatLocalDate(new Date()),
        }, {
          mealId: payload.mealId,
          affectedDate,
          dailySummary,
        });
      } catch {
        recordMealMutation(affectedDate);
      }
      onBack();
    } catch (err) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        void recoverGuestSession();
      } else if (err instanceof MealRevisionConflictError) {
        await handleMealRevisionConflict(err, "delete");
      } else {
        setError("餐點暫時無法刪除，請稍後再試。");
      }
    } finally {
      setPending(false);
    }
  }

  const backLabel = origin === "chat" ? "返回對話" : origin === "history" ? "返回歷史" : "返回";
  const goToChatCorrection = () => {
    closeSecondaryScreen();
    setActiveScreen("chat");
  };

  if (!payload) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col bg-[var(--sp-bg)]">
        <SportScreen className="sp-meal-edit-screen">
          <header className="sp-meal-edit-header">
            <SportIconButton aria-label="返回" className="sp-meal-edit-back" onClick={onBack}>
              <SportChevronLeftIcon size={18} stroke={2} />
            </SportIconButton>
            <div className="sp-meal-edit-title">
              <h1>編輯餐點</h1>
              <div>餐點紀錄</div>
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

  if (payload.itemCount > 1) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col bg-[var(--sp-bg)]">
        <SportScreen className="sp-meal-edit-screen">
          <header className="sp-meal-edit-header">
            <SportIconButton aria-label={backLabel} className="sp-meal-edit-back" onClick={onBack}>
              <SportChevronLeftIcon size={18} stroke={2} />
            </SportIconButton>
            <div className="sp-meal-edit-title">
              <h1>編輯餐點</h1>
              <div>AI 估算</div>
            </div>
            <div className="sp-meal-edit-header-spacer" aria-hidden="true" />
          </header>

          <main className="screen-scroll-safe sp-meal-edit-scroll sp-meal-edit-grouped-scroll">
            <MealEditImageFrame payload={payload} />
            <SportCard className="sp-meal-edit-grouped-lock">
              <div className="sp-meal-edit-grouped-label">組合餐點</div>
              <h2>這筆是組合餐點</h2>
              <p>
                包含 {payload.itemCount} 項：{payload.foodName}。請到「對話」說明要改哪一項或要調整整餐，避免把多項餐點合併成一項。
              </p>
              {payload.items && payload.items.length > 0 ? (
                <div className="sp-meal-edit-grouped-items" aria-label={`${payload.foodName} 項目明細`}>
                  {payload.items.map((item) => (
                    <div key={`${item.position}-${item.name}`} className="sp-meal-edit-grouped-item">
                      <div className="sp-meal-edit-grouped-item-name">{item.name}</div>
                      <div className="sp-meal-edit-grouped-item-macros">
                        <span>熱量 {formatMealItemMacro(item.calories, "kcal")}</span>
                        <span>蛋白質 {formatMealItemMacro(item.protein, "g")}</span>
                        <span>碳水 {formatMealItemMacro(item.carbs, "g")}</span>
                        <span>脂肪 {formatMealItemMacro(item.fat, "g")}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              <button type="button" className="sp-meal-edit-grouped-primary" onClick={goToChatCorrection}>
                到對話修正
              </button>
            </SportCard>
          </main>
        </SportScreen>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col bg-[var(--sp-bg)]">
        <SportScreen className="sp-meal-edit-screen">
          <header className="sp-meal-edit-header">
            <SportIconButton aria-label="返回" className="sp-meal-edit-back" onClick={onBack}>
              <SportChevronLeftIcon size={18} stroke={2} />
            </SportIconButton>
            <div className="sp-meal-edit-title">
              <h1>編輯餐點</h1>
              <div>餐點紀錄</div>
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
            <div>AI 估算</div>
          </div>
          <div className="sp-meal-edit-header-spacer" aria-hidden="true" />
        </header>

        <main className="screen-scroll-safe sp-meal-edit-scroll">
          <MealEditImageFrame payload={payload} />

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
              <span>會保留原始紀錄</span>
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
              <button type="button" onClick={handleDelete} disabled={pending || staleBlocked}>
                {pending ? "刪除餐點中..." : "刪除餐點"}
              </button>
            </div>

            <p className="sp-meal-edit-note">
              修改後會保留原始紀錄。
            </p>
            {error ? (
              <div className="sp-meal-edit-error" role="alert">
                {error}
                {staleBlocked ? (
                  <button type="button" onClick={handleReloadStaleMeal}>
                    重新載入餐點
                  </button>
                ) : null}
              </div>
            ) : null}
          </SportCard>
        </main>

        <footer className="sp-meal-edit-footer">
          <button type="button" className="sp-meal-edit-cancel" onClick={onBack} disabled={pending}>
            取消
          </button>
          <button type="button" className="sp-meal-edit-save" onClick={handleSave} disabled={pending || staleBlocked}>
            {pending ? "儲存餐點中..." : "儲存餐點"}
          </button>
        </footer>
      </SportScreen>
    </div>
  );
}
