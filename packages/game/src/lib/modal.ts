/**
 * Round 7 review (seam d): a modal sheet (settings, the goal explainer, a confirmation) is open. Service and the
 * hands-on shift hold their clocks while it is up, and the service shortcuts / the cook's keys stay with the sheet.
 * Doesn't count the hands-on onboarding (aria-modal="false"), which has its own hold.
 */
export function modalOpen(doc: Document | undefined = typeof document === "undefined" ? undefined : document): boolean {
  return !!doc?.querySelector('[aria-modal="true"]');
}
