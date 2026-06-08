import { useEffect, useState } from "react";
import { deleteMeal, getMeals, MealRevisionConflictError, updateMeal } from "../api.js";
import { formatLocalDate } from "../lib/time.js";
import * as groupedDraft from "../meal-edit-grouped-draft.js";
import { refreshAfterMealMutation } from "../meal-edit-refresh.js";
import { useStore } from "../store.js";
import type { MealEditPayload } from "../types.js";
import type {
  GroupedMealDraftField,
  GroupedMealDraftFieldError,
  GroupedMealDraftFieldErrors,
  GroupedMealDraftRow,
} from "../meal-edit-grouped-draft.js";
import { PersistedAssetImage } from "./PersistedAssetImage.js";
import { SportChevronLeftIcon, SportCloseIcon, SportEditIcon, SportPlusIcon } from "./SportIcons.js";
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

const MEAL_REVISION_REQUIRED = "MEAL_REVISION_REQUIRED";
const MEAL_REVISION_STALE = "MEAL_REVISION_STALE";
const STALE_EDIT_ERROR_COPY = "餐點已被更新，請重新載入最新餐點後再編輯。";
const MISSING_REVISION_ERROR_COPY = "餐點版本已失效，請重新載入最新餐點後再編輯。";
const STALE_DELETE_ERROR_COPY = "餐點已被更新，未刪除。請重新載入最新餐點後再決定是否刪除。";
const GROUPED_INVALID_SAVE_COPY = "尚未儲存。請先修正標示的項目。";
const GROUPED_REFRESH_FAILED_COPY = "餐點已儲存，但畫面暫時無法更新。請重新整理後確認。";
const GROUPED_FINAL_DELETE_COPY = "至少要保留一個項目；若要移除整筆餐點，請使用刪除餐點。";

const GROUPED_EMPTY_ROW: GroupedMealDraftRow = {
  name: "",
  calories: "",
  protein: "",
  carbs: "",
  fat: "",
};

const GROUPED_FIELD_ERROR_COPY: Record<GroupedMealDraftFieldError, string> = {
  required: "請填寫數值。",
  invalid: "請輸入 0 或以上的數字。",
  negative: "請輸入 0 或以上的數字。",
};

function formatMealItemMacro(value: number, unit: "kcal" | "g") {
  return `${Math.round(value)} ${unit}`;
}

function formatGroupedMacro(value: number | string) {
  const numericValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numericValue) ? String(Math.round(numericValue)) : "0";
}

function formatGroupedItemSummary(row: GroupedMealDraftRow) {
  const name = row.name.trim() || "未命名項目";
  return `${name} · ${formatGroupedMacro(row.calories)} kcal · P${formatGroupedMacro(row.protein)} · C${formatGroupedMacro(row.carbs)} · F${formatGroupedMacro(row.fat)}`;
}

function getGroupedFieldErrorCopy(field: GroupedMealDraftField, error: GroupedMealDraftFieldError) {
  if (field === "name") {
    return "請輸入項目名稱。";
  }
  return GROUPED_FIELD_ERROR_COPY[error];
}

type GroupedMealRowProps = {
  row: GroupedMealDraftRow;
  index: number;
  expanded: boolean;
  pending: boolean;
  errors: GroupedMealDraftFieldErrors;
  finalDeleteError: string | null;
  onToggle: (index: number) => void;
  onChange: (index: number, field: GroupedMealDraftField, value: string) => void;
  onDelete: (index: number) => void;
};

function GroupedMealRow(props: GroupedMealRowProps) {
  const {
    row,
    index,
    expanded,
    pending,
    errors,
    finalDeleteError,
    onToggle,
    onChange,
    onDelete,
  } = props;
  const rowName = row.name.trim() || `項目 ${index + 1}`;
  const expandedClassName = expanded ? " sp-meal-edit-grouped-row-expanded" : "";

  return (
    <div className={`sp-meal-edit-grouped-row${expandedClassName}`}>
      <div className="sp-meal-edit-grouped-summary">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "收合" : "展開"}項目：${rowName}`}
          disabled={pending}
          onClick={() => onToggle(index)}
        >
          <span>{formatGroupedItemSummary(row)}</span>
        </button>
        <div className="sp-meal-edit-grouped-row-actions">
          <button
            type="button"
            className="sp-meal-edit-grouped-row-action"
            aria-expanded={expanded}
            aria-label={`${expanded ? "收合項目：" : "展開項目："}${rowName}`}
            disabled={pending}
            onClick={() => onToggle(index)}
          >
            <SportEditIcon size={16} stroke={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sp-meal-edit-grouped-row-action sp-meal-edit-grouped-row-action-delete"
            aria-label={`刪除項目：${rowName}`}
            disabled={pending}
            onClick={() => onDelete(index)}
          >
            <SportCloseIcon size={16} stroke={2} aria-hidden="true" />
          </button>
        </div>
      </div>

      {expanded ? (
        <div>
          <label
            className={`sp-meal-edit-field sp-meal-edit-name-field${errors.name ? " sp-meal-edit-field-error" : ""}`}
          >
            <span>項目名稱</span>
            <input
              value={row.name}
              disabled={pending}
              aria-describedby={errors.name ? `grouped-row-${index}-name-error` : undefined}
              onChange={(event) => onChange(index, "name", event.target.value)}
            />
            {errors.name ? (
              <small id={`grouped-row-${index}-name-error`}>
                {getGroupedFieldErrorCopy("name", errors.name)}
              </small>
            ) : null}
          </label>

          <div className="sp-meal-edit-macro-grid">
            {NUTRITION_FIELDS.map((field) => {
              const fieldError = errors[field.key];
              return (
                <label
                  key={field.key}
                  className={`sp-meal-edit-field sp-meal-edit-macro-field${fieldError ? " sp-meal-edit-field-error" : ""}`}
                >
                  <span>{field.label}</span>
                  <div>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="decimal"
                      value={row[field.key]}
                      disabled={pending}
                      aria-describedby={fieldError ? `grouped-row-${index}-${field.key}-error` : undefined}
                      onChange={(event) => onChange(index, field.key, event.target.value)}
                    />
                    <small>{field.unit}</small>
                  </div>
                  {fieldError ? (
                    <small id={`grouped-row-${index}-${field.key}-error`}>
                      {getGroupedFieldErrorCopy(field.key, fieldError)}
                    </small>
                  ) : null}
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      {finalDeleteError ? (
        <div className="sp-meal-edit-grouped-final-delete-error" role="alert">
          {finalDeleteError}
        </div>
      ) : null}
    </div>
  );
}

function GroupedMealEditor({
  items,
  pending,
  staleBlocked,
  expandedIndex,
  rowErrors,
  finalDeleteError,
  onToggle,
  onChange,
  onAdd,
  onDelete,
  onDeleteMeal,
}: {
  items: GroupedMealDraftRow[];
  pending: boolean;
  staleBlocked: boolean;
  expandedIndex: number | null;
  rowErrors: GroupedMealDraftFieldErrors[];
  finalDeleteError: string | null;
  onToggle: (index: number) => void;
  onChange: (index: number, field: GroupedMealDraftField, value: string) => void;
  onAdd: () => void;
  onDelete: (index: number) => void;
  onDeleteMeal: () => void;
}) {
  const totals = groupedDraft.computeGroupedMealDraftTotals(items);

  return (
    <SportCard className="sp-meal-edit-grouped-card">
      <div className="sp-meal-edit-grouped-header">
        <div>
          <div className="sp-meal-edit-grouped-label">組合餐點</div>
          <h2>編輯項目</h2>
        </div>
        <div className="sp-meal-edit-grouped-totals" aria-label="目前項目總計">
          <span>{formatMealItemMacro(totals.calories, "kcal")}</span>
          <span>P{formatGroupedMacro(totals.protein)}</span>
          <span>C{formatGroupedMacro(totals.carbs)}</span>
          <span>F{formatGroupedMacro(totals.fat)}</span>
        </div>
      </div>

      <div aria-label="項目明細">
        {items.map((item, index) => (
          <GroupedMealRow
            key={index}
            row={item}
            index={index}
            expanded={expandedIndex === index}
            pending={pending || staleBlocked}
            errors={rowErrors[index] ?? {}}
            finalDeleteError={finalDeleteError && expandedIndex === index ? finalDeleteError : null}
            onToggle={onToggle}
            onChange={onChange}
            onDelete={onDelete}
          />
        ))}
      </div>

      <button type="button" className="sp-meal-edit-grouped-add" disabled={pending || staleBlocked} onClick={onAdd}>
        <SportPlusIcon size={16} stroke={2} />
        <span>新增項目</span>
      </button>

      <div className="sp-meal-edit-delete-row">
        <button type="button" onClick={onDeleteMeal} disabled={pending || staleBlocked}>
          {pending ? "刪除餐點中..." : "刪除餐點"}
        </button>
      </div>

      <p className="sp-meal-edit-note">
        修改後會保留原始紀錄。
      </p>
    </SportCard>
  );
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
  const setDailySummary = useStore((s) => s.setDailySummary);
  const setMeals = useStore((s) => s.setMeals);
  const redactChatReceiptIdentity = useStore((s) => s.redactChatReceiptIdentity);
  const recordMealMutation = useStore((s) => s.recordMealMutation);
  const recoverGuestSession = useStore((s) => s.recoverGuestSession);
  const payload = secondaryScreen?.screen === "mealEdit" ? secondaryScreen.payload : undefined;
  const origin = secondaryScreen?.screen === "mealEdit" ? secondaryScreen.origin : undefined;
  const isGroupedPayload = Boolean(payload && payload.itemCount > 1);
  const [draft, setDraft] = useState<DraftState | null>(() => (payload && !isGroupedPayload ? createDraft(payload) : null));
  const [groupedDraftRows, setGroupedDraftRows] = useState<GroupedMealDraftRow[]>(() =>
    payload && isGroupedPayload && payload.items ? groupedDraft.createGroupedMealDraftRows(payload.items) : [],
  );
  const [initialGroupedDraftRows, setInitialGroupedDraftRows] = useState<GroupedMealDraftRow[]>(() =>
    payload && isGroupedPayload && payload.items ? groupedDraft.createGroupedMealDraftRows(payload.items) : [],
  );
  const [expandedGroupedRowIndex, setExpandedGroupedRowIndex] = useState<number | null>(() =>
    payload && isGroupedPayload && payload.items && payload.items.length > 0 ? 0 : null,
  );
  const [groupedRowErrors, setGroupedRowErrors] = useState<GroupedMealDraftFieldErrors[]>([]);
  const [groupedFinalDeleteError, setGroupedFinalDeleteError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleBlocked, setStaleBlocked] = useState(false);
  const [staleAffectedDate, setStaleAffectedDate] = useState<string | null>(null);

  useEffect(() => {
    const nextGroupedRows = payload && payload.itemCount > 1 && payload.items
      ? groupedDraft.createGroupedMealDraftRows(payload.items)
      : [];
    setDraft(payload && payload.itemCount <= 1 ? createDraft(payload) : null);
    setGroupedDraftRows(nextGroupedRows);
    setInitialGroupedDraftRows(nextGroupedRows.map((row) => ({ ...row })));
    setExpandedGroupedRowIndex(nextGroupedRows.length > 0 ? 0 : null);
    setGroupedRowErrors([]);
    setGroupedFinalDeleteError(null);
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

  function updateGroupedRow(index: number, field: GroupedMealDraftField, value: string) {
    setGroupedDraftRows((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
    setGroupedRowErrors((rows) => rows.map((row, rowIndex) => {
      if (rowIndex !== index || !row[field]) {
        return row;
      }
      const { [field]: _removed, ...remaining } = row;
      void _removed;
      return remaining;
    }));
    setGroupedFinalDeleteError(null);
  }

  function handleGroupedAddItem() {
    const nextRows = [...groupedDraftRows, { ...GROUPED_EMPTY_ROW }];
    setGroupedDraftRows(nextRows);
    setGroupedRowErrors((rows) => [...rows, {}]);
    setExpandedGroupedRowIndex(nextRows.length - 1);
    setGroupedFinalDeleteError(null);
    setError(null);
  }

  function handleGroupedToggleRow(index: number) {
    setExpandedGroupedRowIndex((currentIndex) => currentIndex === index ? null : index);
    setGroupedFinalDeleteError(null);
  }

  function handleGroupedDeleteRow(index: number) {
    if (groupedDraftRows.length <= 1) {
      setGroupedFinalDeleteError(GROUPED_FINAL_DELETE_COPY);
      setExpandedGroupedRowIndex(index);
      return;
    }

    const nextRows = groupedDraftRows.filter((_, rowIndex) => rowIndex !== index);
    setGroupedDraftRows(nextRows);
    setGroupedRowErrors((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
    setExpandedGroupedRowIndex(Math.min(index, nextRows.length - 1));
    setGroupedFinalDeleteError(null);
    setError(null);
  }

  function handleGroupedExit() {
    if (groupedDraft.isGroupedMealDraftDirty(initialGroupedDraftRows, groupedDraftRows)) {
      if (!window.confirm("放棄尚未儲存的變更？")) {
        return;
      }
    }
    onBack();
  }

  async function handleSave() {
    if (!payload || staleBlocked) {
      return;
    }

    if (payload.itemCount > 1) {
      if (!payload.items || payload.items.length === 0) {
        setError("找不到項目明細");
        return;
      }

      const validation = groupedDraft.validateGroupedMealDraftRows(groupedDraftRows);
      setGroupedRowErrors(validation.rows);
      if (!validation.valid) {
        setExpandedGroupedRowIndex(validation.firstInvalidIndex ?? 0);
        setError(GROUPED_INVALID_SAVE_COPY);
        return;
      }

      setPending(true);
      setError(null);
      try {
        const groupedItems = groupedDraft.buildGroupedMealUpdateItems(groupedDraftRows);
        const response = await updateMeal(payload.mealId, {
          expectedMealRevisionId: payload.mealRevisionId,
          items: groupedItems,
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
          setError(GROUPED_REFRESH_FAILED_COPY);
          return;
        }
        onBack();
      } catch (err) {
        if (err instanceof Error && err.message === "UNAUTHORIZED") {
          void recoverGuestSession();
        } else if (err instanceof MealRevisionConflictError) {
          await handleMealRevisionConflict(err, "save");
        } else {
          setError("餐點暫時無法儲存，請稍後再試。");
        }
      } finally {
        setPending(false);
      }
      return;
    }

    if (!draft) {
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

  const backLabel = origin === "home" ? "返回首頁" : origin === "chat" ? "返回對話" : origin === "history" ? "返回歷史" : "返回";

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
    const hasAuthoritativeItems = Boolean(payload.items && payload.items.length > 0);

    return (
      <div className="absolute inset-0 z-50 flex flex-col bg-[var(--sp-bg)]">
        <SportScreen className="sp-meal-edit-screen">
          <header className="sp-meal-edit-header">
            <SportIconButton aria-label={backLabel} className="sp-meal-edit-back" onClick={handleGroupedExit}>
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
            {hasAuthoritativeItems ? (
              <>
                <GroupedMealEditor
                  items={groupedDraftRows}
                  pending={pending}
                  staleBlocked={staleBlocked}
                  expandedIndex={expandedGroupedRowIndex}
                  rowErrors={groupedRowErrors}
                  finalDeleteError={groupedFinalDeleteError}
                  onToggle={handleGroupedToggleRow}
                  onChange={updateGroupedRow}
                  onAdd={handleGroupedAddItem}
                  onDelete={handleGroupedDeleteRow}
                  onDeleteMeal={handleDelete}
                />
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
              </>
            ) : (
              <SportCard className="sp-meal-edit-grouped-empty" variant="flat">
                <h2>找不到項目明細</h2>
                <p>請重新載入餐點後再編輯；若仍無法載入，請回到「對話」修正。</p>
              </SportCard>
            )}
          </main>

          {hasAuthoritativeItems ? (
            <footer className="sp-meal-edit-footer">
              <button type="button" className="sp-meal-edit-cancel" onClick={handleGroupedExit} disabled={pending}>
                取消
              </button>
              <button type="button" className="sp-meal-edit-save" onClick={handleSave} disabled={pending || staleBlocked}>
                {pending ? "儲存餐點中..." : "儲存餐點"}
              </button>
            </footer>
          ) : null}
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
