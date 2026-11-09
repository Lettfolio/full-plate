/**
 * The default Empire world: 12 invented cities in 5 regions, invented countries, invented suppliers.
 * Real brands in docs/BRIEF.md are research only; nothing here names one. A later content pass can
 * replace this with JSON (the shapes are the City/Region/Supplier types).
 *
 * District ids are sim-core district archetypes; a city lists which kinds of neighbourhood it has.
 */
import type { City, Region, Supplier } from "./types";

export const DEFAULT_REGIONS: Region[] = [
  { id: "isles", name: "The Isles", commissary: false, x: 452, y: 160 },
  { id: "mainland", name: "The Mainland", commissary: false, x: 680, y: 130 },
  { id: "westland", name: "Westland", commissary: false, x: 170, y: 230 },
  { id: "sunrise", name: "Sunrise Coast", commissary: false, x: 920, y: 240 },
  { id: "crescent", name: "The Crescent", commissary: false, x: 664, y: 398 },
];

type CitySeed = Omit<City, "entered" | "localised" | "tradition" | "championStrength"> & { championStrength?: number };

const CITY_SEEDS: CitySeed[] = [
  // The Isles (home): the fork happens in Harbourton.
  { id: "harbourton", name: "Harbourton", country: "Albrenn", regionId: "isles", population: 2_500_000, districts: ["high_street", "student_quarter", "business_park", "seaside"], costIndex: 1, dietaryRules: [], x: 452, y: 262 },
  { id: "kingsbridge", name: "Kingsbridge", country: "Albrenn", regionId: "isles", population: 1_200_000, districts: ["high_street", "student_quarter", "business_park"], costIndex: 0.95, dietaryRules: [], x: 484, y: 168 },
  { id: "glenmoor", name: "Glenmoor", country: "Caledh", regionId: "isles", population: 800_000, districts: ["high_street", "seaside"], costIndex: 0.9, dietaryRules: [], x: 432, y: 60 },
  // The Mainland
  { id: "velmont", name: "Velmont", country: "Velland", regionId: "mainland", population: 3_000_000, districts: ["high_street", "business_park", "student_quarter"], costIndex: 1.1, dietaryRules: [], localChampion: "Maison Frites", championStrength: 0.3, x: 668, y: 150 },
  { id: "port_sarn", name: "Port Sarn", country: "Ostria", regionId: "mainland", population: 1_500_000, districts: ["high_street", "seaside"], costIndex: 1.05, dietaryRules: [], x: 592, y: 110 },
  // Westland
  { id: "bayview", name: "Bayview", country: "Westrian Union", regionId: "westland", population: 5_000_000, districts: ["high_street", "business_park", "student_quarter", "seaside"], costIndex: 1.15, dietaryRules: [], localChampion: "Big Sky Burgers", championStrength: 0.5, x: 196, y: 184 },
  { id: "sierra_vista", name: "Sierra Vista", country: "Westrian Union", regionId: "westland", population: 2_000_000, districts: ["high_street", "business_park"], costIndex: 1.05, dietaryRules: [], x: 186, y: 300 },
  // Sunrise Coast
  { id: "kaito", name: "Kaito", country: "Nihara", regionId: "sunrise", population: 9_000_000, districts: ["high_street", "business_park", "student_quarter"], costIndex: 1.1, dietaryRules: [], x: 858, y: 110 },
  { id: "manara", name: "Manara", country: "Isla Verde", regionId: "sunrise", population: 8_000_000, districts: ["high_street", "student_quarter", "seaside"], costIndex: 0.55, dietaryRules: [], localChampion: "Jolly Hen", championStrength: 0.8, x: 922, y: 414 },
  { id: "vasant", name: "Vasant", country: "Saravan", regionId: "sunrise", population: 12_000_000, districts: ["high_street", "business_park", "student_quarter"], costIndex: 0.45, dietaryRules: ["no-beef", "no-pork"], localChampion: "Chaat Express", championStrength: 0.4, x: 900, y: 236 },
  // The Crescent
  { id: "qamar", name: "Qamar", country: "Al-Rimal", regionId: "crescent", population: 3_000_000, districts: ["high_street", "business_park", "seaside"], costIndex: 0.9, dietaryRules: ["halal"], x: 700, y: 446 },
  { id: "seren", name: "Seren", country: "Tevah", regionId: "crescent", population: 1_500_000, districts: ["high_street", "seaside"], costIndex: 1.05, dietaryRules: ["kosher"], x: 556, y: 366 },
];

export function defaultCities(contentDistrictIds: readonly string[], homeCityId = "harbourton"): City[] {
  return CITY_SEEDS.map((c) => {
    const districts = c.districts.filter((d) => contentDistrictIds.includes(d));
    return {
      ...c,
      districts: districts.length ? districts : contentDistrictIds.slice(0, 2),
      championStrength: c.championStrength ?? 0,
      entered: c.id === homeCityId,
      localised: false,
      tradition: false,
    };
  });
}

export const DEFAULT_SUPPLIERS: Supplier[] = [
  { id: "spudline", name: "Spudline Farms (fries)", category: "potatoes", discountPct: 0.05, failureRisk: 0.04, signed: false, exclusive: false },
  { id: "meadow_beef", name: "Meadow Beef Co.", category: "beef", discountPct: 0.06, failureRisk: 0.06, signed: false, exclusive: false },
  { id: "greenleaf", name: "Greenleaf Produce", category: "salad", discountPct: 0.03, failureRisk: 0.08, signed: false, exclusive: false },
  { id: "bunworks", name: "Bunworks Bakery", category: "bread", discountPct: 0.03, failureRisk: 0.03, signed: false, exclusive: false },
];

export const FIRST_NAMES = ["Amira", "Ben", "Chloe", "Dev", "Ellie", "Femi", "Grace", "Hamid", "Isla", "Jon", "Kiran", "Lena", "Marcus", "Nia", "Owen", "Priya", "Quinn", "Rosa", "Sam", "Tariq", "Uma", "Vik", "Wen", "Yusuf", "Zara"];
export const LAST_NAMES = ["Abara", "Barnes", "Chen", "Dlamini", "Evans", "Farouk", "Gill", "Hughes", "Ivanova", "Jones", "Kaur", "Lopez", "Mensah", "Nakamura", "Okafor", "Patel", "Quigley", "Reyes", "Singh", "Tanaka", "Usman", "Varga", "Walsh", "Xu", "Young"];

export const DISTRICT_SHORT: Record<string, string> = {
  high_street: "High St",
  student_quarter: "Campus",
  business_park: "Business Park",
  seaside: "Seafront",
};
