export interface PublicMealItemInput {
  foodName: string;
  position: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface PublicMealItem {
  name: string;
  position: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export function projectPublicMealItems(items: readonly PublicMealItemInput[]): PublicMealItem[] {
  return items.map((item) => ({
    name: item.foodName,
    position: item.position,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
  }));
}
