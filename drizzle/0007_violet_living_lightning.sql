ALTER TABLE meal_transactions ADD COLUMN meal_period TEXT CHECK (meal_period IN ('breakfast','lunch','dinner','late_night'));
