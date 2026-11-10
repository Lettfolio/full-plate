/**
 * Round 12 (D, bundle relief): the settings sheet's body and the owner's Evening are lazy chunks. The sheet still opens
 * from a cold start (Suspense, then the dialog), and neither module is imported statically by the main chunk's files.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SettingsMenu } from "../components/Settings";

afterEach(cleanup);
const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("bundle relief (R12-D)", () => {
  it("the settings sheet opens from a cold chunk", async () => {
    render(<SettingsMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const sheet = await screen.findByRole("dialog", { name: "Settings" });
    expect(sheet.textContent).toContain("Text size");
    expect(sheet.textContent).toContain("Font licence");
  });

  it("App and Settings import the Evening and the sheet body only through import()", () => {
    expect(src("App.tsx")).not.toMatch(/^import [^;]*from "\.\/screens\/Evening"/m);
    expect(src("App.tsx")).toMatch(/import\("\.\/screens\/Evening"\)/);
    expect(src("components/Settings.tsx")).not.toMatch(/^import [^;]*from "\.\/SettingsBody"/m);
    expect(src("components/Settings.tsx")).not.toMatch(/^import [^;]*from "\.\/Dialog"/m);
  });
});
