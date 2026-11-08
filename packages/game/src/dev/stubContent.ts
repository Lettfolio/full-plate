/**
 * A tiny, hand-written ContentPack used only for UI development while
 * @full-plate/content is being built. Selected by VITE_USE_STUBS=1 (see src/sim.ts).
 * Figures are rough UK pence; the real content package is the source of truth.
 */
import type { ContentPack, SegmentDef } from "@full-plate/sim-core";

const TICKS = 120;

/** Two-hump lunch/dinner arrival curve, normalised to sum to 1. */
function curve(lunch: number, dinner: number): number[] {
  const raw = Array.from({ length: TICKS }, (_, t) => {
    const l = Math.exp(-((t - 14) ** 2) / 60) * lunch;
    const d = Math.exp(-((t - 84) ** 2) / 200) * dinner;
    return l + d + 0.02;
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => v / sum);
}

const segments: SegmentDef[] = [
  { id: "students", name: "Students", priceSensitivity: 0.9, qualityWeight: 0.3, speedWeight: 0.5, averageBudget: 1100, partySizeWeights: [3, 4, 2, 2], arrivalCurve: curve(1, 1.4), tipRate: 0.03 },
  { id: "families", name: "Families", priceSensitivity: 0.6, qualityWeight: 0.4, speedWeight: 0.7, averageBudget: 1500, partySizeWeights: [0, 2, 3, 4], arrivalCurve: curve(1.2, 0.8), tipRate: 0.08 },
  { id: "business", name: "Business", priceSensitivity: 0.2, qualityWeight: 0.5, speedWeight: 0.9, averageBudget: 2600, partySizeWeights: [4, 3, 1, 1], arrivalCurve: curve(2, 0.5), tipRate: 0.12 },
  { id: "foodies", name: "Foodies", priceSensitivity: 0.3, qualityWeight: 0.95, speedWeight: 0.2, averageBudget: 3200, partySizeWeights: [1, 4, 1, 1], arrivalCurve: curve(0.4, 1.6), tipRate: 0.15 },
  { id: "tourists", name: "Tourists", priceSensitivity: 0.5, qualityWeight: 0.5, speedWeight: 0.5, averageBudget: 1900, partySizeWeights: [1, 4, 2, 2], arrivalCurve: curve(1.3, 1), tipRate: 0.06 },
];

const flat = (v: number) => Array.from({ length: 12 }, () => v);

export const stubContent: ContentPack = {
  ingredients: [
    { id: "bun", name: "Brioche bun", unitCost: 35, shelfLifeDays: 3 },
    { id: "beef", name: "Beef patty", unitCost: 140, shelfLifeDays: 2 },
    { id: "potato", name: "Potatoes", unitCost: 20, shelfLifeDays: 10, seasonality: [9, 10, 11] },
    { id: "cheese", name: "Mature cheddar", unitCost: 30, shelfLifeDays: 14 },
    { id: "pasta", name: "Fresh pasta", unitCost: 45, shelfLifeDays: 3 },
    { id: "tomato", name: "Tomatoes", unitCost: 25, shelfLifeDays: 5, seasonality: [6, 7, 8, 9] },
    { id: "fish", name: "Haddock fillet", unitCost: 260, shelfLifeDays: 2 },
    { id: "batter", name: "Batter mix", unitCost: 15, shelfLifeDays: 30 },
    { id: "lettuce", name: "Little gem", unitCost: 25, shelfLifeDays: 4, seasonality: [5, 6, 7, 8] },
    { id: "chocolate", name: "Dark chocolate", unitCost: 60, shelfLifeDays: 60 },
    { id: "cream", name: "Double cream", unitCost: 30, shelfLifeDays: 5 },
    { id: "lemon", name: "Lemons", unitCost: 18, shelfLifeDays: 14 },
  ],
  dishes: [
    { id: "burger", name: "Cheeseburger", course: "main", cuisine: "american", ingredients: [{ id: "bun", qty: 1 }, { id: "beef", qty: 1 }, { id: "cheese", qty: 1 }], prepTicks: 3, skillRequired: 20, baseAppeal: { students: 0.9, families: 0.8, business: 0.4, foodies: 0.3, tourists: 0.7 }, qualityCeiling: 70, suggestedPrice: 1250, blurb: "A crowd-pleaser. Hard to get wrong, hard to make special." },
    { id: "chips", name: "Triple-cooked chips", course: "side", cuisine: "british", ingredients: [{ id: "potato", qty: 2 }], prepTicks: 2, skillRequired: 10, baseAppeal: { students: 0.9, families: 0.9, business: 0.3, foodies: 0.4, tourists: 0.6 }, qualityCeiling: 75, suggestedPrice: 450, blurb: "Cheap to make, everybody orders them." },
    { id: "fishchips", name: "Fish & chips", course: "main", cuisine: "british", ingredients: [{ id: "fish", qty: 1 }, { id: "batter", qty: 1 }, { id: "potato", qty: 2 }, { id: "lemon", qty: 1 }], prepTicks: 4, skillRequired: 35, baseAppeal: { students: 0.5, families: 0.8, business: 0.5, foodies: 0.5, tourists: 0.95 }, qualityCeiling: 85, suggestedPrice: 1650, blurb: "The tourists will queue round the block for this." },
    { id: "carbonara", name: "Carbonara", course: "main", cuisine: "italian", ingredients: [{ id: "pasta", qty: 1 }, { id: "cheese", qty: 1 }, { id: "cream", qty: 1 }], prepTicks: 3, skillRequired: 40, baseAppeal: { students: 0.7, families: 0.6, business: 0.6, foodies: 0.6, tourists: 0.6 }, qualityCeiling: 85, suggestedPrice: 1350 },
    { id: "pomodoro", name: "Pasta pomodoro", course: "main", cuisine: "italian", ingredients: [{ id: "pasta", qty: 1 }, { id: "tomato", qty: 2 }], prepTicks: 2, skillRequired: 25, baseAppeal: { students: 0.8, families: 0.7, business: 0.4, foodies: 0.5, tourists: 0.5 }, qualityCeiling: 80, suggestedPrice: 1100, blurb: "Simple. Lives or dies on the tomatoes." },
    { id: "salad", name: "Little gem salad", course: "starter", cuisine: "french", ingredients: [{ id: "lettuce", qty: 1 }, { id: "lemon", qty: 1 }, { id: "cheese", qty: 1 }], prepTicks: 1, skillRequired: 15, baseAppeal: { students: 0.2, families: 0.3, business: 0.8, foodies: 0.6, tourists: 0.3 }, qualityCeiling: 80, suggestedPrice: 750 },
    { id: "bruschetta", name: "Tomato bruschetta", course: "starter", cuisine: "italian", ingredients: [{ id: "bun", qty: 1 }, { id: "tomato", qty: 2 }], prepTicks: 1, skillRequired: 20, baseAppeal: { students: 0.4, families: 0.4, business: 0.6, foodies: 0.6, tourists: 0.6 }, qualityCeiling: 80, suggestedPrice: 650 },
    { id: "fondant", name: "Chocolate fondant", course: "dessert", cuisine: "french", ingredients: [{ id: "chocolate", qty: 1 }, { id: "cream", qty: 1 }], prepTicks: 4, skillRequired: 60, baseAppeal: { students: 0.4, families: 0.7, business: 0.5, foodies: 0.9, tourists: 0.6 }, qualityCeiling: 95, suggestedPrice: 800, blurb: "Glorious when it works. A puddle when it doesn't." },
    { id: "posset", name: "Lemon posset", course: "dessert", cuisine: "british", ingredients: [{ id: "cream", qty: 1 }, { id: "lemon", qty: 1 }], prepTicks: 1, skillRequired: 20, baseAppeal: { students: 0.3, families: 0.5, business: 0.5, foodies: 0.7, tourists: 0.5 }, qualityCeiling: 85, suggestedPrice: 650 },
    { id: "lemonade", name: "Homemade lemonade", course: "drink", cuisine: "cafe", ingredients: [{ id: "lemon", qty: 2 }], prepTicks: 1, skillRequired: 5, baseAppeal: { students: 0.6, families: 0.9, business: 0.3, foodies: 0.4, tourists: 0.6 }, qualityCeiling: 80, suggestedPrice: 380 },
  ],
  segments,
  districts: [
    { id: "student", name: "Student Quarter", monthlyRent: 220000, depositMonths: 2, footfall: 900, segmentMix: { students: 0.6, families: 0.1, business: 0.05, foodies: 0.15, tourists: 0.1 }, seasonCurve: [0.8, 1, 1.1, 1, 1, 0.7, 0.5, 0.5, 1.2, 1.2, 1.1, 0.8], blurb: "Cheap rent and hungry crowds, but they count every penny." },
    { id: "high", name: "High Street", monthlyRent: 350000, depositMonths: 3, footfall: 1200, segmentMix: { students: 0.15, families: 0.35, business: 0.2, foodies: 0.1, tourists: 0.2 }, seasonCurve: [0.7, 0.75, 0.9, 1, 1, 1.05, 1.1, 1.1, 1, 0.95, 1, 1.3], blurb: "A bit of everyone. Busy Saturdays, sleepy Tuesdays." },
    { id: "business", name: "Business Park", monthlyRent: 420000, depositMonths: 3, footfall: 800, segmentMix: { students: 0, families: 0.05, business: 0.75, foodies: 0.15, tourists: 0.05 }, seasonCurve: [0.9, 1, 1, 1, 1, 1, 0.8, 0.7, 1.05, 1.05, 1.05, 0.8], blurb: "Big lunchtime spenders in a hurry. Dead after seven." },
    { id: "seaside", name: "Seaside", monthlyRent: 280000, depositMonths: 2, footfall: 1000, segmentMix: { students: 0.05, families: 0.35, business: 0.02, foodies: 0.08, tourists: 0.5 }, seasonCurve: flat(1).map((_, m) => [0.4, 0.45, 0.6, 0.8, 1.1, 1.4, 1.7, 1.7, 1.2, 0.8, 0.5, 0.5][m] ?? 1), blurb: "Heaving in August, a ghost town in February." },
  ],
  staffArchetypes: [
    { id: "line-cook", role: "chef", nameSamples: ["Priya", "Tom", "Aisha", "Marco", "Bea", "Kwame", "Lily", "Owen"], skillRange: [25, 60], speedRange: [30, 70], charmRange: [10, 40], wageRange: [1271, 1500], traits: ["perfectionist", "speedy", "grumpy", "steady", "messy"] },
    { id: "head-chef", role: "chef", nameSamples: ["Sophie", "Ravi", "Hannah", "Jules"], skillRange: [55, 85], speedRange: [40, 70], charmRange: [10, 50], wageRange: [1600, 2200], traits: ["perfectionist", "inspiring", "grumpy", "steady"] },
    { id: "server", role: "server", nameSamples: ["Ellie", "Sam", "Noor", "Finn", "Maya", "Jack", "Zara", "Leo"], skillRange: [20, 60], speedRange: [30, 80], charmRange: [30, 85], wageRange: [1271, 1400], traits: ["charming", "speedy", "chatty", "steady", "messy"] },
  ],
  traits: [
    { id: "perfectionist", name: "Perfectionist", description: "Better food, slower tickets.", effects: { skill: 1.15, speed: 0.85 } },
    { id: "speedy", name: "Speedy", description: "Gets plates out fast.", effects: { speed: 1.2, mistakeRate: 1.1 } },
    { id: "grumpy", name: "Grumpy", description: "Mood drops quickly on bad days.", effects: { moodDecay: 1.4, charm: 0.8 } },
    { id: "steady", name: "Steady", description: "Never great, never bad.", effects: { moodDecay: 0.7 } },
    { id: "messy", name: "Messy", description: "More mistakes, more waste.", effects: { mistakeRate: 1.4 } },
    { id: "charming", name: "Charming", description: "Guests forgive a lot.", effects: { charm: 1.25 } },
    { id: "chatty", name: "Chatty", description: "Lovely, but slow on the floor.", effects: { charm: 1.1, speed: 0.9 } },
    { id: "inspiring", name: "Inspiring", description: "Lifts the whole kitchen's mood.", effects: { moodDecay: 0.6, wageDemand: 1.2 } },
  ],
  events: [
    { id: "food-blogger", title: "A food blogger is in town", body: "A local food blogger with 40,000 followers asks if they can come for a free lunch in exchange for a write-up.", weight: 3, choices: [
      { id: "yes", label: "Roll out the red carpet", effects: { cash: -4000, popularity: 6 } },
      { id: "no", label: "Politely say no", effects: {} },
    ] },
    { id: "boiler", title: "The boiler has broken", body: "No hot water this morning. A plumber can come now for an emergency fee, or tomorrow for the normal rate.", weight: 2, choices: [
      { id: "now", label: "Pay the emergency call-out", effects: { cash: -32000 } },
      { id: "wait", label: "Wait and use the kettle", effects: { staffMood: -12, popularity: -3 } },
    ] },
    { id: "street-fair", title: "Street fair this week", body: "The council is closing the road for a street fair. Stalls are £150 for the week, and the crowds will be big.", weight: 2, choices: [
      { id: "stall", label: "Rent a stall (£150)", effects: { cash: -15000, footfallMultDays: { mult: 1.35, days: 5 } } },
      { id: "ignore", label: "Stay inside", effects: { footfallMultDays: { mult: 1.1, days: 5 } } },
      { id: "party", label: "Throw a staff party", effects: { cash: -8000, staffMood: 15 } },
    ] },
  ],
  balance: {
    startingCash: 1500000,
    loanPrincipal: 2500000,
    loanTermDays: 730,
    loanApr: 0.08,
    fitOutCost: 1800000,
    reputationDecay: 0.5,
    reviewRatePer10Covers: 0.8,
    startingTables: 6,
    maxTables: 14,
    seatsPerTable: 4,
    wasteShares: { prep: 0.4, plate: 0.35, spoil: 0.25 },
    weekendFootfallMult: 1.3,
    targetYear1Survival: 0.75,
  },
};
