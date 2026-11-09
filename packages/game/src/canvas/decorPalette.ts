/**
 * Round 10 (decorating): art colours for the decor items RestaurantView draws (decorArt.ts) — part two of the owner's
 * floor palette (floorPalette.ts), kept apart so it loads with the decor art chunk. Not theme tokens — like wood and
 * steel in floorPalette — except where decorArt reuses a token (tomato gingham, basil board, plum velvet…).
 * `worn` is what a tired item fades toward.
 */
export const DECOR_ART = {
  worn: "#bdb4a4", scuff: "#5e4a38",
  checkDark: "#5b534c", checkLight: "#efe9de", terrazzo: "#e4dccf", parquetA: "#c48a4e", parquetB: "#a9733e", parquetLine: "#7d522a",
  rugA: "#b5523c", rugB: "#e3b26a", rugFringe: "#f3e4c4",
  sunnyTop: "#f2c94c", sunny: "#dcaa2c", sunnyFace: "#b5841b", stripeA: "#ead8c6", stripeB: "#c98f7a",
  panelTop: "#7a5132", panel: "#5b3a22", panelFace: "#3e2716", damaskTop: "#7a3659", damask: "#5f2846", damaskFace: "#421b31", gilt: "#d9b25a",
  lantern: "#f6b26b", lanternGlow: "#ffe1b0", brass: "#c9a14a", brassDeep: "#8f6b25", crystal: "#eef6fb", crystalEdge: "#a9c3d3",
  cushionA: "#e8907a", cushionB: "#f0c46c", leather: "#4a2a1c", leatherTop: "#6b3e29", velvet: "#2f5d4a", velvetTop: "#3f7a61",
  linen: "#fbfaf6", linenFold: "#e4ded2", marble: "#f0ede7", marbleVein: "#b9b3aa", marbleRim: "#c9c3b8",
  chalk: "#2f3b33", chalkText: "#f4f1ea", frame: "#8a5d33", neonBoard: "#1e1a26", neon: "#ff6fae", goldText: "#e3b54a", board: "#151311",
  herb: "#6aa84f", palm: "#3f8a4a", palmDeep: "#2c6a37", bloomA: "#f28db2", bloomB: "#f6d36b", bloomC: "#b78be0",
  radio: "#c4412b", speaker: "#2b2622", jukeboxBody: "#7a3b2a", piano: "#1c1a19", pianoKey: "#fbfaf6",
  cakeA: "#f4a6b8", cakeB: "#f7e2b5", cakeC: "#6b3e29", menuGlow: "#fff2c2", train: "#c4412b", track: "#6f6a64",
  sheet: "#e9e5dc", sheetFold: "#cfc8bb", cone: "#f08a24",
};
