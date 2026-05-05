export function buildFullMealDisplayName(
  items: Array<{ foodName: string }>,
  fallback = "餐點",
): string {
  const names = items.map((item) => item.foodName.trim()).filter(Boolean);
  return names.length > 0 ? names.join("、") : fallback;
}

export function projectMealDisplay(
  items: Array<{ foodName: string }>,
  fallback = "餐點",
): { foodName: string; itemCount: number } {
  return {
    foodName: buildFullMealDisplayName(items, fallback),
    itemCount: items.length,
  };
}
