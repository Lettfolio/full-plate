import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MoneyText } from "../components/MoneyText";
import { formatPence } from "../lib/format";

describe("formatPence", () => {
  it.each([
    [0, "£0.00"],
    [5, "£0.05"],
    [123456, "£1,234.56"],
    [100000000, "£1,000,000.00"],
    [-1230, "−£12.30"],
  ])("%i → %s", (p, s) => expect(formatPence(p)).toBe(s));

  it("rounds stray fractional pence instead of printing them", () => {
    expect(formatPence(1234.6)).toBe("£12.35");
  });

  it("whole pounds and signed options", () => {
    expect(formatPence(123456, { whole: true })).toBe("£1,235");
    expect(formatPence(250, { signed: true })).toBe("+£2.50");
    expect(formatPence(0, { signed: true })).toBe("£0.00");
    expect(formatPence(-49, { whole: true })).toBe("£0"); // rounds to zero → no minus sign
  });
});

describe("<MoneyText>", () => {
  it("renders formatted pounds and colours by sign when asked", () => {
    render(<><MoneyText pence={-4500} tone /><MoneyText pence={99} /></>);
    const neg = screen.getByText("−£45.00");
    expect(neg.className).toContain("money--neg");
    expect(screen.getByText("£0.99").className).not.toContain("money--");
  });
});
