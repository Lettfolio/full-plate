/**
 * Minimal ContentPack for sim-core tests and headless runs.
 * Independent of @full-plate/content: 2 segments, 1 district, 6 dishes, 6 ingredients,
 * 2 archetypes, 2 traits, 2 events. UK pence, NLW-anchored wages.
 */
import type { ContentPack, SegmentDef } from "../src/types";
import { SERVICE_TICKS } from "../src/types";

/** Bell-ish arrival curve peaking at lunch (tick ~12) and dinner (tick ~84). */
function curve(lunch: number, dinner: number): number[] {
  const raw = Array.from({ length: SERVICE_TICKS }, (_, t) => {
    const l = Math.exp(-(((t - 12) / 10) ** 2));
    const d = Math.exp(-(((t - 84) / 14) ** 2));
    return lunch * l + dinner * d + 0.02;
  });
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((x) => Math.round((x / total) * 1e6) / 1e6);
}

const families: SegmentDef = {
  id: "families",
  name: "Families",
  priceSensitivity: 0.6,
  qualityWeight: 0.5,
  speedWeight: 0.6,
  averageBudget: 1800,
  partySizeWeights: [0.05, 0.3, 0.25, 0.4],
  arrivalCurve: curve(0.7, 1),
  tipRate: 0.08,
};

const foodies: SegmentDef = {
  id: "foodies",
  name: "Foodies",
  priceSensitivity: 0.2,
  qualityWeight: 0.9,
  speedWeight: 0.3,
  averageBudget: 3200,
  partySizeWeights: [0.15, 0.6, 0.15, 0.1],
  arrivalCurve: curve(0.3, 1),
  tipRate: 0.12,
};

export const fixtureContent: ContentPack = {
  ingredients: [
    { id: "beef", name: "Beef", unitCost: 320, shelfLifeDays: 4 },
    { id: "fish", name: "Haddock", unitCost: 280, shelfLifeDays: 2, seasonality: [5, 6, 7, 8, 9] },
    { id: "potato", name: "Potatoes", unitCost: 30, shelfLifeDays: 14 },
    { id: "veg", name: "Seasonal veg", unitCost: 60, shelfLifeDays: 5, seasonality: [6, 7, 8, 9, 10] },
    { id: "flour", name: "Flour & dairy", unitCost: 50, shelfLifeDays: 10 },
    { id: "fruit", name: "Fruit", unitCost: 70, shelfLifeDays: 6, seasonality: [6, 7, 8] },
  ],
  dishes: [
    {
      id: "burger", name: "Steak burger", course: "main", cuisine: "american",
      ingredients: [{ id: "beef", qty: 1 }, { id: "potato", qty: 2 }, { id: "flour", qty: 1 }],
      prepTicks: 3, skillRequired: 30, baseAppeal: { families: 0.8, foodies: 0.4 }, qualityCeiling: 75, suggestedPrice: 1450,
    },
    {
      id: "fishchips", name: "Fish & chips", course: "main", cuisine: "british",
      ingredients: [{ id: "fish", qty: 1 }, { id: "potato", qty: 2 }, { id: "flour", qty: 1 }],
      prepTicks: 3, skillRequired: 35, baseAppeal: { families: 0.7, foodies: 0.5 }, qualityCeiling: 80, suggestedPrice: 1550,
    },
    {
      id: "steak", name: "Sirloin & greens", course: "main", cuisine: "french",
      ingredients: [{ id: "beef", qty: 2 }, { id: "veg", qty: 2 }],
      prepTicks: 4, skillRequired: 60, baseAppeal: { families: 0.3, foodies: 0.9 }, qualityCeiling: 95, suggestedPrice: 2600,
    },
    {
      id: "soup", name: "Soup of the day", course: "starter", cuisine: "british",
      ingredients: [{ id: "veg", qty: 2 }, { id: "flour", qty: 1 }],
      prepTicks: 1, skillRequired: 15, baseAppeal: { families: 0.4, foodies: 0.4 }, qualityCeiling: 70, suggestedPrice: 650,
    },
    {
      id: "crumble", name: "Fruit crumble", course: "dessert", cuisine: "british",
      ingredients: [{ id: "fruit", qty: 2 }, { id: "flour", qty: 1 }],
      prepTicks: 2, skillRequired: 25, baseAppeal: { families: 0.6, foodies: 0.5 }, qualityCeiling: 80, suggestedPrice: 700,
    },
    {
      id: "lemonade", name: "Homemade lemonade", course: "drink", cuisine: "cafe",
      ingredients: [{ id: "fruit", qty: 1 }],
      prepTicks: 1, skillRequired: 5, baseAppeal: { families: 0.6, foodies: 0.3 }, qualityCeiling: 70, suggestedPrice: 350,
    },
  ],
  segments: [families, foodies],
  districts: [
    {
      id: "highstreet",
      name: "High Street",
      monthlyRent: 350_000,
      depositMonths: 3,
      footfall: 40, // potential parties per day
      segmentMix: { families: 0.65, foodies: 0.35 },
      seasonCurve: [0.7, 0.75, 0.9, 1, 1.05, 1.1, 1.15, 1.15, 1, 0.95, 0.85, 1.05],
      blurb: "Steady shoppers, families at the weekend.",
    },
  ],
  staffArchetypes: [
    {
      id: "line-cook", role: "chef",
      nameSamples: ["Priya", "Tom", "Aisha", "Callum", "Mei"],
      skillRange: [35, 70], speedRange: [40, 75], charmRange: [10, 40],
      wageRange: [1271, 1650], traits: ["perfectionist", "cheerful"],
    },
    {
      id: "server", role: "server",
      nameSamples: ["Jade", "Ollie", "Sofia", "Kwame", "Ellie"],
      skillRange: [20, 50], speedRange: [45, 80], charmRange: [40, 85],
      wageRange: [1271, 1400], traits: ["cheerful", "perfectionist"],
    },
  ],
  traits: [
    { id: "perfectionist", name: "Perfectionist", description: "Better plates, slower hands.", effects: { skill: 1.1, speed: 0.9, mistakeRate: 0.6 } },
    { id: "cheerful", name: "Cheerful", description: "Lifts the room; shrugs off bad days.", effects: { charm: 1.15, moodDecay: 0.7 } },
  ],
  events: [
    {
      id: "food-blogger", title: "A food blogger is in town",
      body: "A local blogger asks for a free tasting menu in exchange for a write-up.",
      weight: 2,
      when: { minDay: 3 },
      choices: [
        { id: "host", label: "Host them (−£60)", effects: { cash: -6_000, popularity: 4, footfallMultDays: { mult: 1.15, days: 5 } } },
        { id: "decline", label: "Politely decline", effects: {} },
      ],
    },
    {
      id: "boiler", title: "The boiler has packed in",
      body: "No hot water in the kitchen. A plumber can come today, at a price.",
      weight: 1,
      choices: [
        { id: "fix", label: "Call the plumber (−£250)", effects: { cash: -25_000 } },
        { id: "kettle", label: "Make do with kettles", effects: { staffMood: -8, prestige: -1 } },
      ],
    },
  ],
  balance: {
    startingCash: 2_000_000,
    loanPrincipal: 3_000_000,
    loanTermDays: 1095,
    loanApr: 0.08,
    fitOutCost: 3_500_000,
    reputationDecay: 0.2,
    reviewRatePer10Covers: 0.6,
    startingTables: 6,
    maxTables: 14,
    seatsPerTable: 4,
    wasteShares: { prep: 0.45, plate: 0.34, spoil: 0.21 },
    weekendFootfallMult: 1.3,
    targetYear1Survival: 0.75,
  },
};
