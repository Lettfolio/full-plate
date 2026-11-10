/**
 * Round 12 (D): phone layout. phone.css only ever applies behind its two phone media queries (the same strings
 * lib/layout.ts exports), and the hands-on shift asks an upright phone to turn sideways with a dialog that holds the
 * shift (lib/modal.ts modalOpen, which HandsOnShift checks every frame).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RotateCard } from "../components/RotateCard";
import { PHONE_LANDSCAPE_QUERY, PHONE_PORTRAIT_QUERY, PHONE_QUERY } from "../lib/layout";
import { modalOpen } from "../lib/modal";

const css = readFileSync(join(__dirname, "..", "phone.css"), "utf8");

/** matchMedia that answers `match(q)`; `fire()` tells listeners something changed. */
function mockMedia(match: (q: string) => boolean) {
  const listeners = new Set<() => void>();
  const mm = vi.fn((q: string) => ({ matches: match(q), media: q, addEventListener: (_: string, cb: () => void) => listeners.add(cb), removeEventListener: (_: string, cb: () => void) => listeners.delete(cb) }));
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: mm });
  return { fire: () => listeners.forEach((cb) => cb()) };
}
afterEach(() => { cleanup(); delete (window as { matchMedia?: unknown }).matchMedia; });

describe("phone.css (R12-D)", () => {
  it("has no rule outside its two media blocks, and they use lib/layout's queries", () => {
    const blocks = [...css.matchAll(/@media ([^{]+)\{/g)].map((m) => m[1]!.trim());
    expect(blocks).toEqual([PHONE_QUERY, PHONE_LANDSCAPE_QUERY]);
    // strip comments and the media blocks' bodies: nothing may be left at the top level
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    let depth = 0, top = "";
    for (const ch of noComments) { if (ch === "{") depth++; else if (ch === "}") depth--; else if (depth === 0) top += ch; }
    expect(top.replace(/@media[^\n]*/g, "").trim()).toBe("");
  });

  it("prefixes every selector with html (so lazy chunks' CSS cannot override it by load order)", () => {
    const sels = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{};]+)\{/g)].map((m) => m[1]!.trim()).filter((x) => !x.startsWith("@"));
    expect(sels.length).toBeGreaterThan(40);
    for (const s of sels) if (!s.startsWith(":root")) for (const part of s.split(",")) expect(part.trim()).toMatch(/^html( |$)/);
  });

  it("drops the old 1024 px body floor", () => {
    expect(readFileSync(join(__dirname, "..", "theme.css"), "utf8")).not.toMatch(/min-width:\s*1024px/);
  });
});

describe("turn your phone sideways (R12-D)", () => {
  it("shows on an upright phone as a modal dialog, which holds a hands-on shift", () => {
    mockMedia((q) => q === PHONE_PORTRAIT_QUERY);
    render(<RotateCard />);
    const d = screen.getByRole("dialog", { name: "Turn your phone sideways" });
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(modalOpen()).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Play it upright anyway" }));
  });

  it("'Play it upright anyway' lets the shift run; turning sideways and back asks again", () => {
    let portrait = true;
    const m = mockMedia((q) => q === PHONE_PORTRAIT_QUERY && portrait);
    render(<RotateCard />);
    fireEvent.click(screen.getByRole("button", { name: "Play it upright anyway" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(modalOpen()).toBe(false);
    act(() => { portrait = false; m.fire(); });
    act(() => { portrait = true; m.fire(); });
    expect(screen.getByRole("dialog", { name: "Turn your phone sideways" })).toBeTruthy();
  });

  it("stays away on a tablet, a desktop, or a phone held sideways", () => {
    mockMedia(() => false);
    render(<RotateCard />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
