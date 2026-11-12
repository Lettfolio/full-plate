/**
 * Round 5: the trade words the game uses, each with a plain label and a one-line explanation a 12+ player gets at a
 * glance. Shown through <Term> (components/Term.tsx). The numbers stay real; only the words get explained.
 *
 * Round 11b (the player is 14): the real trade word is what the screen says (86, comp, HQ, royalty, satellite, tronc,
 * VAT…); the tip is where the plain meaning lives. Sim log lines and board options get theirs from <TermText>.
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
  vip: { term: "VIP", plain: "Special guest", explain: "very important person: a guest you go out of your way for. A VIP order is the dish they've asked to find on the menu." },
  covers: { term: "covers", plain: "Guests", explain: "one cover is one guest's meal; restaurants count guests this way." },
  footfall: { term: "footfall", plain: "People walking past", explain: "how many people pass the door each day; more passers-by means more guests." },
  prestige: { term: "prestige", plain: "Fancy reputation", explain: "how posh and special people think you are; it lets you charge more." },
  popularity: { term: "popularity", plain: "How liked you are", explain: "how many people want to eat here; it brings guests through the door." },
  margin: { term: "margin", plain: "Profit per plate", explain: "what you keep from each plate after paying for the food in it." },
  eightySix: { term: "86", plain: "Take off tonight", explain: "kitchen slang: to 86 a dish means to stop selling it for the rest of the day (usually because it ran out)." },
  comp: { term: "comp", plain: "Make their meal free", explain: "short for complimentary: the table eats for free to make up for a bad night. They leave happy; you get no money for it." },
  sommelier: { term: "sommelier", plain: "Wine expert", explain: "the person who looks after the wine list and helps guests pick a bottle." },
  callOutFee: { term: "call-out fee", plain: "Fee for coming out", explain: "what a repair engineer charges just for turning up, before any fixing." },
  vat: { term: "VAT", plain: "Tax on sales", explain: "Value Added Tax: a slice of most of what guests pay belongs to the government, not to you." },
  hmrc: { term: "HMRC", plain: "The tax office", explain: "HM Revenue & Customs, the UK government department that collects tax (and sometimes gives some back)." },
  takings: { term: "takings", plain: "Money in", explain: "everything guests paid today, before any costs." },
  rota: { term: "rota", plain: "Who works which days", explain: "the weekly timetable of who is on shift; every shift on it gets paid." },
  spoilage: { term: "spoilage", plain: "Food that goes off", explain: "stock that passed its use-by day before anyone cooked it, so it goes in the bin." },
  // Round 11 (D, U7): the career ladder keeps its real names; these say what each one means.
  commis: { term: "commis", plain: "Apprentice chef", explain: "the newest cook in the kitchen, learning one section at a time." },
  chefDePartie: { term: "chef de partie", plain: "Section chef", explain: "runs one part of the kitchen, like the grill or the puddings." },
  sousChef: { term: "sous chef", plain: "Second chef", explain: "the head chef's right hand, who runs the kitchen when the head chef is off." },
  satellite: { term: "satellite", plain: "Sister restaurant", explain: "a smaller place your group runs (a bar or a bistro) that earns money but never stars." },
  tronc: { term: "tronc", plain: "Shared tips", explain: "tips pooled and shared fairly between the team (the law says the owner can't keep them)." },
  wholesaler: { term: "wholesaler", plain: "Big supplier", explain: "a big warehouse that sells food to restaurants in bulk: easy and cheap, but nothing a food guide will notice." },
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
  royalty: { term: "royalty", plain: "A share of their takings", explain: "a share of every franchise shop's sales, paid to your head office." },
  adFund: { term: "ad fund", plain: "Advert money from each shop", explain: "a share of each franchise shop's sales that pays for adverts for the whole brand." },
  franchiseFee: { term: "franchise fee", plain: "Joining fee", explain: "what a new franchise owner pays once to open a shop with your name." },
  landRent: { term: "rent on your land", plain: "Rent for your plots", explain: "a share of sales franchise owners pay when their shop sits on land you own." },
  take: { term: "take", plain: "Your share of their sales", explain: "royalty + ad fund + rent added up: what head office gets from each franchise pound." },
  franchisee: { term: "franchisee", plain: "Shop owner", explain: "someone who pays to run a shop under your brand and sends your head office a share of its sales." },
  hq: { term: "HQ", plain: "Head office", explain: "headquarters: the brand's own office and bank account, separate from the till of the shop you run." },
  franchise: { term: "franchise", plain: "Someone else's shop with your name", explain: "a local owner pays to run a shop under your brand and pays you a share of sales." },
  company: { term: "company-owned", plain: "Your own shop", explain: "you build it, you pay for it and you keep all its profit." },
  licence: { term: "licence", plain: "Licensed shop", explain: "another company runs your brand in their country and pays you a small share." },
  standardisation: { term: "standardisation", plain: "How alike your shops are", explain: "the same menu cooked the same way everywhere; it fits more tables and a takeaway counter." },
  brandConsistency: { term: "consistency", plain: "How alike this shop is", explain: "how closely this shop follows your formula; low means guests get surprises." },
  recognition: { term: "recognition", plain: "How many people know you", explain: "how well people in a region know your brand; it brings guests and franchise owners." },
  saturation: { term: "saturation", plain: "Too many shops here", explain: "your own shops stealing each other's guests when a city has too many of them." },
  costIndex: { term: "cost index", plain: "How pricey the city is", explain: "×1.00 is normal; above that, building and running a shop here costs more." },
  hqCash: { term: "HQ cash", plain: "Head office money", explain: "HQ (head office) is the brand's own bank account, separate from the till of the shop you run." },
  facility: { term: "development facility", plain: "Bank loan for building", explain: "money the bank will lend for new shops; it grows as more shops open." },
  overdraft: { term: "overdraft", plain: "Owing the bank", explain: "head office has spent more than it had; the bank charges interest every month." },
  association: { term: "franchisee association", plain: "Shop owners' club", explain: "unhappy franchise owners team up and block moves they don't like." },
  franchiseeMood: { term: "franchisee mood", plain: "How happy shop owners are", explain: "below the danger line they form an association against you." },
  margin7d: { term: "margin (7 days)", plain: "Profit this week", explain: "what the shop made over the last 7 days after all its costs." },
  crewSkill: { term: "crew skill", plain: "How good the team is", explain: "the local cooks' and servers' average skill, out of 100." },
  plot: { term: "property", plain: "Buy the land", explain: "own the land under a shop (40% deposit, the rest on a 25-year mortgage); franchisees then pay you rent." },
  remodel: { term: "remodel", plain: "Do up the shop", explain: "a refit that brings an old shop back in line with your formula." },
  // Round 6: the board meeting
  boardMeeting: { term: "board meeting", plain: "Monthly money meeting", explain: "once a month the people who run head office look at the money and make one big choice." },
  refurb: { term: "refurb", plain: "Make it feel new", explain: "fixing up a tired shop so its wage and repair bills drop back for a while." },
  feeHoliday: { term: "royalty holiday", plain: "A break from paying you", explain: "a franchise owner skips the royalty for a while to get back on their feet." },
  supplyMarkup: { term: "supply markup", plain: "Extra on the food you sell them", explain: "head office buys food for every shop; a markup means franchise owners pay it a little more than it cost." },
  hqCosts: { term: "HQ overheads", plain: "Running head office", explain: "offices, staff, mortgages and interest: what head office itself costs each month." },
  driveThru: { term: "drive-thru", plain: "Order from your car", explain: "a lane where drivers order and collect without parking; more guests, bigger plot." },
  localise: { term: "localise", plain: "A menu for that city", explain: "changing the menu so it follows the local food rules, so guests there stop staying away." },
  campaign: { term: "brand campaign", plain: "Adverts", explain: "paying for adverts in one region so more people there know your name." },
  // Round 13 (C): the hands-on how-to's words
  pass: { term: "the pass", plain: "Where plates wait", explain: "the counter between kitchen and dining room: cooks put finished plates there and servers take them out." },
  // Round 14 (E, U17): the hands-on shift's way out, on a phone
  office: { term: "Office", plain: "Back to watching", explain: "leave the hands-on shift: the team carries on and you watch the rest of service from the office." },
  ticketRail: { term: "ticket rail", plain: "The order strip", explain: "the rail where order slips hang, one per table, oldest first, so the kitchen cooks them in turn." },
} satisfies Record<string, GlossaryEntry>;

export type TermId = keyof typeof GLOSSARY;
