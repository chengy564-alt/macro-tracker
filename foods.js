// Common whole foods, per 100 g (USDA-style approximate values).
// kcal, protein g, carbs g, fat g, sodium mg. Packaged foods come from barcode scans instead.
const F = (id, name, kcal, p, c, f, na, serving) => ({
  id: "g-" + id, name, per100: { kcal, p, c, f, na }, serving: serving ? { label: serving[0], grams: serving[1] } : null, generic: true,
});

export const GENERIC_FOODS = [
  F("rice-white", "White rice, cooked", 130, 2.7, 28.2, 0.3, 1, ["1 cup", 158]),
  F("rice-brown", "Brown rice, cooked", 123, 2.7, 25.6, 1.0, 4, ["1 cup", 195]),
  F("pasta", "Pasta, cooked", 158, 5.8, 30.9, 0.9, 1, ["1 cup", 140]),
  F("udon", "Udon noodles, cooked", 105, 2.6, 21.6, 0.4, 120),
  F("oats", "Oats, dry", 389, 16.9, 66.3, 6.9, 2, ["½ cup", 40]),
  F("bread-white", "White bread", 266, 8.9, 49, 3.3, 491, ["1 slice", 28]),
  F("bread-ww", "Whole wheat bread", 252, 12.4, 42.7, 3.5, 450, ["1 slice", 32]),
  F("potato", "Potato, boiled", 87, 1.9, 20.1, 0.1, 4),
  F("sweet-potato", "Sweet potato, baked", 90, 2.0, 20.7, 0.2, 36),

  F("chicken-thigh", "Chicken thigh, skinless, cooked", 209, 25.9, 0, 10.9, 95, ["1 thigh (boneless)", 110]),
  F("chicken-thigh-skin", "Chicken thigh, with skin, cooked", 229, 23.3, 0, 14.7, 84, ["1 thigh (boneless)", 120]),
  F("chicken-breast", "Chicken breast, skinless, cooked", 165, 31, 0, 3.6, 74, ["1 breast", 170]),
  F("beef-mince", "Ground beef 85/15, cooked", 250, 25.9, 0, 15.4, 72),
  F("steak", "Beef steak, lean, cooked", 217, 26, 0, 12, 56),
  F("pork-loin", "Pork loin, cooked", 242, 27, 0, 14, 62),
  F("salmon", "Salmon, cooked", 206, 22.1, 0, 12.4, 61, ["1 fillet", 150]),
  F("tuna-can", "Tuna, canned in water, drained", 116, 25.5, 0, 0.8, 338, ["1 can", 120]),
  F("shrimp", "Shrimp, cooked", 99, 24, 0.2, 0.3, 111),
  F("tofu", "Tofu, firm", 144, 17.3, 2.8, 8.7, 14),
  F("egg", "Egg, whole", 143, 12.6, 0.7, 9.5, 142, ["1 large egg", 50]),
  F("egg-white", "Egg white", 52, 10.9, 0.7, 0.2, 166, ["1 large white", 33]),

  F("milk-whole", "Milk, whole", 61, 3.2, 4.8, 3.3, 43, ["1 cup", 244]),
  F("milk-skim", "Milk, skim", 34, 3.4, 5.0, 0.1, 42, ["1 cup", 245]),
  F("greek-yogurt", "Greek yogurt, plain, nonfat", 59, 10.2, 3.6, 0.4, 36, ["1 cup", 245]),
  F("cheddar", "Cheddar cheese", 403, 24.9, 1.3, 33.1, 621, ["1 slice", 28]),
  F("whey", "Whey protein powder (typical)", 400, 80, 8, 6, 200, ["1 scoop", 30]),

  F("broccoli", "Broccoli, cooked", 35, 2.4, 7.2, 0.4, 41),
  F("tenderstem", "Tenderstem broccoli", 35, 3.0, 4.4, 0.4, 20, ["1 stem", 15]),
  F("spinach", "Spinach", 23, 2.9, 3.6, 0.4, 79),
  F("carrot", "Carrot", 41, 0.9, 9.6, 0.2, 69, ["1 medium", 61]),
  F("onion", "Onion", 40, 1.1, 9.3, 0.1, 4),
  F("tomato", "Tomato", 18, 0.9, 3.9, 0.2, 5, ["1 medium", 123]),
  F("cucumber", "Cucumber", 15, 0.7, 3.6, 0.1, 2),
  F("edamame", "Edamame, shelled", 121, 11.9, 8.9, 5.2, 6),
  F("kimchi", "Kimchi", 15, 1.1, 2.4, 0.5, 498),
  F("avocado", "Avocado", 160, 2.0, 8.5, 14.7, 7, ["½ avocado", 68]),
  F("banana", "Banana", 89, 1.1, 22.8, 0.3, 1, ["1 medium", 118]),
  F("apple", "Apple", 52, 0.3, 13.8, 0.2, 1, ["1 medium", 182]),
  F("blueberries", "Blueberries", 57, 0.7, 14.5, 0.3, 1),

  F("olive-oil", "Olive oil", 884, 0, 0, 100, 2, ["1 tbsp", 13.5]),
  F("butter", "Butter, salted", 717, 0.9, 0.1, 81, 643, ["1 tbsp", 14]),
  F("peanut-butter", "Peanut butter", 588, 25.1, 20, 50.4, 459, ["1 tbsp", 16]),
  F("almonds", "Almonds", 579, 21.2, 21.6, 49.9, 1, ["handful", 28]),
  F("soy-sauce", "Soy sauce", 53, 8.1, 4.9, 0.6, 5493, ["1 tbsp", 16]),
  F("furikake", "Furikake (typical)", 430, 20, 33, 22, 3000, ["1 tsp", 2.5]),
  F("honey", "Honey", 304, 0.3, 82.4, 0, 4, ["1 tbsp", 21]),
];
