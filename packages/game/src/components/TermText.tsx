import { Fragment, type ReactNode } from "react";
import type { TermId } from "../lib/glossary";
import { Term } from "./Term";

/**
 * Round 11b (the player is 14): sim log lines, board options, event cards, reviews and toasts are plain strings built in
 * the sim packages and content. They say the real trade words again ("Fish has run out — 86'd for today.", "HQ gives up
 * about £2,000", "A brown envelope from HMRC"); <TermText> wraps each such word in a glossary <Term> so a tap or hover
 * explains it, exactly like the words the screens write themselves.
 *
 * Case matters where a lower-case word means something else ("a vat of stock", "comp" inside "company" is excluded by
 * the word boundary). The first rule that matches at a position wins, so "royalty holiday" beats "royalty".
 */
const RULES: readonly (readonly [string, TermId])[] = [
  ["86'd|86’d", "eightySix"],
  ["[Rr]oyalty holidays?", "feeHoliday"],
  ["[Rr]oyalt(?:y|ies)", "royalty"],
  ["[Ff]ranchisees?", "franchisee"],
  ["HQ", "hq"],
  ["[Ss]atellites?", "satellite"],
  ["[Ww]holesalers?", "wholesaler"],
  ["VAT", "vat"],
  ["HMRC", "hmrc"],
  ["[Cc]all-out fees?", "callOutFee"],
  ["[Ss]ommeliers?", "sommelier"],
  ["[Tt]ronc", "tronc"],
  ["[Ff]ootfall", "footfall"],
  ["[Cc]omp(?:ed)?", "comp"],
];
const PATTERN = new RegExp(`(?<![\\w'’-])(?:${RULES.map(([re]) => `(${re})`).join("|")})(?![\\w-])`, "g");

/** The text split into plain runs and trade words (pure; the tests use it directly). */
export function termParts(text: string): (string | { word: string; id: TermId })[] {
  const out: (string | { word: string; id: TermId })[] = [];
  let at = 0;
  for (const m of text.matchAll(PATTERN)) {
    const i = m.index ?? 0;
    const g = m.slice(1).findIndex((x) => x !== undefined);
    if (g < 0) continue;
    if (i > at) out.push(text.slice(at, i));
    out.push({ word: m[0], id: RULES[g]![1] });
    at = i + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** A string with every trade word tipped. `inButton`: the terms are tap-for-tip spans that don't press the button. */
export function TermText({ text, inButton = false }: { text: string; inButton?: boolean }): ReactNode {
  const parts = termParts(text);
  if (parts.length === 1 && typeof parts[0] === "string") return text;
  return (
    <>
      {parts.map((p, i) => (typeof p === "string" ? <Fragment key={i}>{p}</Fragment> : <Term key={i} id={p.id} inline inButton={inButton}>{p.word}</Term>))}
    </>
  );
}
