/**
 * Round 11 — E (pipeline): static guards for the red-team's pipeline findings, so they can't quietly come back.
 *   S7  the workflow grants nothing by default; only the deploy job can write Pages or mint an OIDC token
 *   S8  every action is pinned to a full commit SHA (with its tag in a comment)
 *   S9  no dev/preview server listens on the LAN unless asked (`dev:lan`); Node ≥ 22 is declared
 *   S13 the self-hosted fonts' licence ships with the game and Settings credits it
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { loadSettingsBody, SettingsMenu } from "../components/Settings";
// Round 12 (D): the sheet body is a lazy chunk; fetch it once so the sheet opens synchronously, as it does in the game
// after the header button has warmed it.
beforeAll(() => loadSettingsBody());

const ROOT = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
afterEach(cleanup);

/** The workflow's jobs, as text blocks (no YAML parser in the tree; the file is small and flat). */
function jobs(yml: string): Record<string, string> {
  const body = yml.slice(yml.indexOf("\njobs:\n") + 7);
  const out: Record<string, string> = {};
  for (const m of body.split(/\n(?=  [a-z][\w-]*:\n)/)) { const name = /^\s*([\w-]+):/.exec(m)?.[1]; if (name) out[name] = m; }
  return out;
}

describe("GitHub Pages workflow (S7, S8)", () => {
  const yml = read(".github/workflows/pages.yml");
  it("grants no permissions at workflow level; build reads, deploy writes Pages + id-token", () => {
    expect(yml).toMatch(/^permissions: \{\}$/m);
    const j = jobs(yml);
    expect(Object.keys(j).sort()).toEqual(["build", "deploy"]);
    expect(j.build).toMatch(/permissions:\n\s+contents: read\n/);
    expect(j.build).not.toMatch(/pages: write|id-token/);
    expect(j.deploy).toMatch(/pages: write/);
    expect(j.deploy).toMatch(/id-token: write/);
    expect(j.deploy).not.toMatch(/\brun:/); // the job holding the token runs no project code
    expect(yml).toMatch(/pnpm install --frozen-lockfile/);
  });
  it("pins every action to a 40-character commit SHA with its tag noted", () => {
    const uses = [...yml.matchAll(/uses:\s*(\S+)(.*)$/gm)];
    expect(uses.length).toBeGreaterThanOrEqual(6);
    for (const [, ref, rest] of uses) {
      expect(ref, ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      expect(rest, ref).toMatch(/# v\d+\.\d+\.\d+/);
    }
  });
  it("has Dependabot for actions and npm", () => {
    const d = read(".github/dependabot.yml");
    expect(d).toMatch(/package-ecosystem: github-actions/);
    expect(d).toMatch(/package-ecosystem: npm/);
  });
});

describe("dev servers and engines (S9)", () => {
  it("no package's dev/preview/demo script listens on the LAN; the game has an explicit dev:lan", () => {
    for (const dir of readdirSync(join(ROOT, "packages"))) {
      const p = join("packages", dir, "package.json");
      if (!existsSync(join(ROOT, p))) continue;
      const scripts = JSON.parse(read(p)).scripts as Record<string, string>;
      for (const [name, cmd] of Object.entries(scripts)) if (name !== "dev:lan") expect(cmd, `${p} ${name}`).not.toMatch(/--host\b(?! 127\.0\.0\.1)/);
    }
    expect(JSON.parse(read("packages/game/package.json")).scripts["dev:lan"]).toBe("vite --host");
  });
  it("declares Node ≥ 22 (engines and .nvmrc)", () => {
    expect(JSON.parse(read("package.json")).engines.node).toBe(">=22");
    expect(read(".nvmrc").trim()).toBe("22");
  });
});

describe("font licence (S13)", () => {
  it("ships OFL.txt naming both typefaces", () => {
    const ofl = read("packages/game/public/fonts-licence/OFL.txt");
    expect(ofl).toMatch(/Fredoka Project Authors/);
    expect(ofl).toMatch(/Nunito Project Authors/);
    expect(ofl).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
  });
  it("credits the fonts at the bottom of Settings with a link to the licence", () => {
    render(<SettingsMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const link = screen.getByRole("link", { name: "Font licence" });
    expect(link.getAttribute("href")).toBe("fonts-licence/OFL.txt");
    expect(link.closest("p")!.textContent).toMatch(/Fredoka and Nunito.*SIL Open Font License/);
  });
});
