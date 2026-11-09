/**
 * Round 5: the trade words the game uses, each with a plain label a 10-year-old can read and a one-line explanation.
 * Shown through <Term> (components/Term.tsx). The numbers stay real; only the words get explained.
 */
export interface GlossaryEntry {
  /** The real word, as the trade says it. */
  term: string;
  /** The plain-English label shown first. */
  plain: string;
  /** One line: what it means here. */
  explain: string;
}

export const GLOSSARY = {
  // the restaurant
  covers: { term: "covers", plain: "Guests", explain: "one cover is one guest's meal; restaurants count guests this way." },
  footfall: { term: "footfall", plain: "People walking past", explain: "how many people pass the door each day; more passers-by means more guests." },
  prestige: { term: "prestige", plain: "Fancy reputation", explain: "how posh and special people think you are; it lets you charge more." },
  popularity: { term: "popularity", plain: "How liked you are", explain: "how many people want to eat here; it brings guests through the door." },
  margin: { term: "margin", plain: "Profit per plate", explain: "what you keep from each plate after paying for the food in it." },
  eightySix: { term: "86", plain: "Take off today's menu", explain: "kitchen slang: to 86 a dish means to stop selling it (usually because it ran out)." },
  takings: { term: "takings", plain: "Money in", explain: "everything guests paid today, before any costs." },
  rota: { term: "rota", plain: "Who works which days", explain: "the weekly timetable of who is on shift; every shift on it gets paid." },
  spoilage: { term: "spoilage", plain: "Food that goes off", explain: "stock that passed its use-by day before anyone cooked it, so it goes in the bin." },
  tronc: { term: "tronc", plain: "Shared tips", explain: "tips pooled and shared fairly between the team (the law says the owner can't keep them)." },
  // the menu matrix
  mmStar: { term: "Star", plain: "Star dish", explain: "popular and makes good money: keep it just as it is." },
  mmPloughhorse: { term: "Plough-horse", plain: "Hard worker", explain: "popular but makes little money: nudge the price up a bit." },
  mmPuzzle: { term: "Puzzle", plain: "Puzzle", explain: "makes good money but few people order it: make it easier to notice or cheaper." },
  mmDog: { term: "Dog", plain: "Dud", explain: "unpopular and makes little money: think about taking it off." },
  // Stars path
  prestigeTracks: { term: "prestige tracks", plain: "Food guides", explain: "the guides and critics who score you; stars come from them." },
  stagiaires: { term: "stagiaires", plain: "Trainee cooks", explain: "young cooks who work in your kitchen to learn; paying them is fair, not paying them is risky." },
  consistency: { term: "consistency", plain: "Same every time", explain: "how reliably every plate comes out just as good as the last one." },
  // Empire path
  royalty: { term: "royalty", plain: "Money the brand gets from each shop", explain: "a share of every franchise shop's sales, paid to your HQ." },
  adFund: { term: "ad fund", plain: "Advert money from each shop", explain: "a share of each franchise shop's sales that pays for adverts for the whole brand." },
  franchiseFee: { term: "franchise fee", plain: "Joining fee", explain: "what a new franchise owner pays once to open a shop with your name." },
  landRent: { term: "rent on your land", plain: "Rent for your plots", explain: "a share of sales franchise owners pay when their shop sits on land you own." },
  take: { term: "take", plain: "Your share of their sales", explain: "royalty + ad fund + rent added up: what HQ gets from each franchise pound." },
  franchise: { term: "franchise", plain: "Someone else's shop with your name", explain: "a local owner pays to run a shop under your brand and pays you a share of sales." },
  company: { term: "company-owned", plain: "Your own shop", explain: "you build it, you pay for it and you keep all its profit." },
  licence: { term: "licence", plain: "Licensed shop", explain: "another company runs your brand in their country and pays you a small share." },
  standardisation: { term: "standardisation", plain: "How alike your shops are", explain: "the same menu cooked the same way everywhere; it fits more tables and a takeaway counter." },
  brandConsistency: { term: "consistency", plain: "How alike this shop is", explain: "how closely this shop follows your formula; low means guests get surprises." },
  recognition: { term: "recognition", plain: "How many people know you", explain: "how well people in a region know your brand; it brings guests and franchise owners." },
  saturation: { term: "saturation", plain: "Too many shops here", explain: "your own shops stealing each other's guests when a city has too many of them." },
  costIndex: { term: "cost index", plain: "How pricey the city is", explain: "×1.00 is normal; above that, building and running a shop here costs more." },
  hqCash: { term: "HQ cash", plain: "Money at headquarters", explain: "the brand's own bank account, separate from the till of the shop you run." },
  facility: { term: "development facility", plain: "Bank loan for building", explain: "money the bank will lend for new shops; it grows as more shops open." },
  overdraft: { term: "overdraft", plain: "Owing the bank", explain: "HQ has spent more than it had; the bank charges interest every month." },
  association: { term: "franchisee association", plain: "Shop owners' club", explain: "unhappy franchise owners team up and block moves they don't like." },
  franchiseeMood: { term: "franchisee mood", plain: "How happy shop owners are", explain: "below the danger line they form an association against you." },
  margin7d: { term: "margin (7 days)", plain: "Profit this week", explain: "what the shop made over the last 7 days after all its costs." },
  crewSkill: { term: "crew skill", plain: "How good the team is", explain: "the local cooks' and servers' average skill, out of 100." },
  plot: { term: "property", plain: "Buy the land", explain: "own the land under a shop (40% deposit, the rest on a 25-year mortgage); franchisees then pay you rent." },
  remodel: { term: "remodel", plain: "Do up the shop", explain: "a refit that brings an old shop back in line with your formula." },
  // Round 6: the board meeting
  boardMeeting: { term: "board meeting", plain: "Monthly money meeting", explain: "once a month the people who run HQ look at the money and make one big choice." },
  refurb: { term: "refurb", plain: "Make it feel new", explain: "fixing up a tired shop so its wage and repair bills drop back for a while." },
  feeHoliday: { term: "fee holiday", plain: "A break from paying you", explain: "a franchise owner skips the royalty for a while to get back on their feet." },
  supplyMarkup: { term: "supply markup", plain: "Extra on the food you sell them", explain: "HQ buys food for every shop; a markup means franchise owners pay HQ a little more than it cost." },
  hqCosts: { term: "HQ overheads", plain: "Running HQ", explain: "offices, staff, mortgages and interest: what HQ itself costs each month." },
  driveThru: { term: "drive-thru", plain: "Order from your car", explain: "a lane where drivers order and collect without parking; more guests, bigger plot." },
  localise: { term: "localise", plain: "A menu for that city", explain: "changing the menu so it follows the local food rules, so guests there stop staying away." },
  campaign: { term: "brand campaign", plain: "Adverts", explain: "paying for adverts in one region so more people there know your name." },
} satisfies Record<string, GlossaryEntry>;

export type TermId = keyof typeof GLOSSARY;
