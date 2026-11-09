/** Round 8 review: an open Dialog keeps Tab (and Shift+Tab) inside itself. */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Dialog } from "../components/Dialog";

afterEach(cleanup);

describe("Dialog focus trap", () => {
  it("wraps Tab from the last control to the first, and Shift+Tab from the first to the last", () => {
    render(
      <>
        <button>Behind</button>
        <Dialog title="Settings" onClose={() => {}}>
          <button>One</button>
          <button>Two</button>
        </Dialog>
      </>,
    );
    const items = [...document.querySelectorAll<HTMLElement>(".modal button")];
    const last = items[items.length - 1]!;
    last.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    screen.getByText("Behind").focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.querySelector(".modal")!.contains(document.activeElement)).toBe(true);
  });
});
