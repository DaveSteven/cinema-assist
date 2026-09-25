import { describe, expect, it } from "vitest";
import type { Seat } from "../../src/domain/seat.js";
import { rankSeatGroups, summarizeSeats } from "../../src/services/seat-ranking-service.js";
import { readFixtureJson } from "../helpers.js";

const seats = readFixtureJson("seats-standard.json") as Seat[];

const baseOptions = {
  ticketCount: 2,
  requireAdjacent: true,
  allowedSeatTypes: ["standard"],
  maxSurchargeYen: 0,
  screenSide: "top" as const,
};

describe("summarizeSeats", () => {
  it("counts availability, wheelchair and per-type rows", () => {
    const summary = summarizeSeats(seats);

    expect(summary.total).toBe(24);
    expect(summary.available).toBe(23);
    expect(summary.selectable).toBe(22);
    expect(summary.wheelchair).toBe(1);

    const standard = summary.byType.find((type) => type.seatType === "standard");
    const premium = summary.byType.find((type) => type.seatType === "premiumClass");
    expect(standard?.surchargeYen).toBe(0);
    expect(premium?.surchargeYen).toBe(1600);
    expect(premium?.priceCategory).toBe("プレミアムクラス");
  });

  it("keeps same-type seats with different surcharges in separate rows", () => {
    const summary = summarizeSeats([
      makeSeatFrom(seats, "standard", 0),
      makeSeatFrom(seats, "standard", 500, "T"),
    ]);
    const standardRows = summary.byType.filter((type) => type.seatType === "standard");
    expect(standardRows).toHaveLength(2);
    expect(standardRows.map((row) => row.surchargeYen).sort()).toEqual([0, 500]);
  });

  it("keeps known and unknown prices as separate rows", () => {
    const summary = summarizeSeats([
      { ...baseSeat(), seatType: "premiumClass", surchargeYen: 1600 },
      { ...baseSeat(), seatType: "premiumClass", surchargeYen: undefined },
    ]);
    const premiumRows = summary.byType.filter((type) => type.seatType === "premiumClass");
    expect(premiumRows).toHaveLength(2);
    expect(premiumRows.some((row) => row.surchargeYen === undefined)).toBe(true);
    expect(premiumRows.some((row) => row.surchargeYen === 1600)).toBe(true);
  });
});

function baseSeat(): Seat {
  return {
    section: "",
    row: "A",
    number: 1,
    label: "a1",
    available: true,
    selectable: true,
    wheelchair: false,
    seatType: "standard",
    surchargeYen: 0,
  };
}

function makeSeatFrom(
  source: readonly Seat[],
  seatType: string,
  surchargeYen: number,
  row = "A",
): Seat {
  return {
    ...baseSeat(),
    row,
    number: source.length + surchargeYen,
    seatType,
    surchargeYen,
  };
}

describe("rankSeatGroups", () => {
  it("picks the target row near 65% back and never suggests premium by default", () => {
    const groups = rankSeatGroups(seats, baseOptions);

    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0]?.targetRow).toBe("C");
    expect(groups.every((group) => group.seats.every((seat) => seat.seatType === "standard"))).toBe(
      true,
    );
  });

  it("flips the target row when the screen is below the seats", () => {
    const groups = rankSeatGroups(seats, { ...baseOptions, screenSide: "bottom" });
    expect(groups[0]?.targetRow).toBe("B");
  });

  it("is independent of DOM order and derives rows from coordinates", () => {
    const reversed = [...seats].reverse();
    const normalGroups = rankSeatGroups(seats, baseOptions);
    const reversedGroups = rankSeatGroups(reversed, baseOptions);
    expect(reversedGroups[0]?.targetRow).toBe(normalGroups[0]?.targetRow);
    expect(reversedGroups[0]?.seats.map((seat) => `${seat.row}${seat.number}`)).toEqual(
      normalGroups[0]?.seats.map((seat) => `${seat.row}${seat.number}`),
    );
  });

  it("supports single, double and triple groups", () => {
    expect(rankSeatGroups(seats, { ...baseOptions, ticketCount: 1 }).length).toBeGreaterThan(0);
    expect(rankSeatGroups(seats, { ...baseOptions, ticketCount: 3 }).length).toBeGreaterThan(0);
  });

  it("excludes wheelchair and unavailable seats", () => {
    const groups = rankSeatGroups(seats, { ...baseOptions, ticketCount: 1 });
    expect(groups.every((group) => group.seats[0]?.wheelchair === false)).toBe(true);
    expect(groups.every((group) => group.seats[0]?.available === true)).toBe(true);
  });

  it("rejects groups that combine different seat types", () => {
    const groups = rankSeatGroups(seats, {
      ...baseOptions,
      allowedSeatTypes: ["standard", "premiumClass"],
      maxSurchargeYen: 2000,
    });
    expect(
      groups.every((group) => new Set(group.seats.map((seat) => seat.seatType)).size === 1),
    ).toBe(true);
  });

  it("includes premium seats only when allowed and under the surcharge cap", () => {
    const allowed = rankSeatGroups(seats, {
      ...baseOptions,
      allowedSeatTypes: ["standard", "premiumClass"],
      maxSurchargeYen: 2000,
    });
    expect(
      allowed.some((group) => group.seats.some((seat) => seat.seatType === "premiumClass")),
    ).toBe(true);

    const capped = rankSeatGroups(seats, {
      ...baseOptions,
      allowedSeatTypes: ["standard", "premiumClass"],
      maxSurchargeYen: 1000,
    });
    expect(capped.every((group) => group.seats.every((seat) => seat.seatType === "standard"))).toBe(
      true,
    );
  });

  it("rejects seats with an unknown surcharge even when the type is allowed", () => {
    const mystery: Seat = {
      section: "",
      row: "C",
      number: 3,
      label: "c3",
      available: true,
      selectable: true,
      wheelchair: false,
      seatType: "mystery",
      x: 180,
      y: 320,
    };
    const replaced = seats.map((seat) => (seat.row === "C" && seat.number === 3 ? mystery : seat));
    const groups = rankSeatGroups(replaced, {
      ...baseOptions,
      allowedSeatTypes: ["standard", "mystery"],
      maxSurchargeYen: 0,
    });
    expect(groups.every((group) => group.seats.every((seat) => seat.seatType !== "mystery"))).toBe(
      true,
    );
  });

  it("honours requireAdjacent for gaps in the row", () => {
    const gapped = seats.filter(
      (seat) => !(seat.row === "C" && (seat.number === 3 || seat.number === 4)),
    );
    const adjacent = rankSeatGroups(gapped, { ...baseOptions, ticketCount: 2 });
    const relaxed = rankSeatGroups(gapped, {
      ...baseOptions,
      ticketCount: 2,
      requireAdjacent: false,
    });

    const gapGroup = (groups: ReturnType<typeof rankSeatGroups>): boolean =>
      groups.some(
        (group) =>
          group.seats[0]?.row === "C" && group.seats.map((seat) => seat.number).join(",") === "2,5",
      );

    expect(gapGroup(adjacent)).toBe(false);
    expect(gapGroup(relaxed)).toBe(true);
  });

  it("does not recommend excluded rows", () => {
    const groups = rankSeatGroups(seats, { ...baseOptions, excludedRows: ["C"] });
    expect(groups.every((group) => group.seats[0]?.row !== "C")).toBe(true);
  });

  it("adds a preferred-row bonus", () => {
    const groups = rankSeatGroups(seats, { ...baseOptions, preferredRows: ["A"] });
    const rowA = groups.find((group) => group.seats[0]?.row === "A");
    expect(rowA?.reasons).toContain("preferred row");
  });

  it("reflects the aisle preference", () => {
    const prefer = rankSeatGroups(seats, { ...baseOptions, aislePreference: "prefer" });
    const avoid = rankSeatGroups(seats, { ...baseOptions, aislePreference: "avoid" });
    expect(prefer.some((group) => group.reasons.includes("aisle"))).toBe(true);
    expect(avoid.some((group) => group.reasons.includes("aisle avoided"))).toBe(true);
  });

  it("prefers standard seats in the first two rows before Premium Class", () => {
    const anchored: Seat[] = [];
    for (const [index, row] of ["A", "B", "C", "D", "E", "F"].entries()) {
      for (let number = 1; number <= 7; number += 1) {
        anchored.push({
          ...baseSeat(),
          row,
          number,
          label: `${row}${number}`,
          seatType: row === "E" ? "premiumClass" : "standard",
          priceCategory: row === "E" ? "プレミアムクラス" : undefined,
          surchargeYen: row === "E" ? 1600 : 0,
          x: number * 40,
          y: 100 + index * 60,
        });
      }
    }

    const groups = rankSeatGroups(anchored, { ...baseOptions, ticketCount: 3 });

    expect(groups[0]?.seats.map((seat) => seat.row)).toEqual(["D", "D", "D"]);
    expect(groups.every((group) => ["C", "D"].includes(group.seats[0]?.row ?? ""))).toBe(true);
    expect(groups[0]?.reasons).toContain("premium anchor: 1 row toward screen");
  });

  it("prefers the centered second anchor row over edge seats in the first anchor row", () => {
    const anchored = [
      ...[1, 2, 3].map((number, index) => ({
        ...baseSeat(),
        row: "C",
        number,
        label: `C${number}`,
        x: 450 + index * 50,
        y: 220,
      })),
      ...[1, 2, 3].map((number, index) => ({
        ...baseSeat(),
        row: "D",
        number,
        label: `D${number}`,
        x: 850 + index * 50,
        y: 280,
      })),
      ...[1, 2, 3].map((number, index) => ({
        ...baseSeat(),
        row: "E",
        number,
        label: `E${number}`,
        seatType: "premiumClass",
        surchargeYen: 1600,
        x: 450 + index * 50,
        y: 340,
      })),
    ];

    const groups = rankSeatGroups(anchored, {
      ...baseOptions,
      ticketCount: 3,
      screenCenterX: 500,
      screenWidth: 1000,
    });

    expect(groups[0]?.seats.map((seat) => seat.row)).toEqual(["C", "C", "C"]);
    expect(groups[0]?.reasons).toContain("premium anchor: 2 rows toward screen");
  });

  it("reverses the Premium anchor direction when the screen is below", () => {
    const anchored = ["A", "B", "C", "D", "E"].flatMap((row, index) =>
      [1, 2, 3].map((number) => ({
        ...baseSeat(),
        row,
        number,
        label: `${row}${number}`,
        seatType: row === "B" ? "premiumClass" : "standard",
        surchargeYen: row === "B" ? 1600 : 0,
        x: number * 40,
        y: 100 + index * 60,
      })),
    );

    const groups = rankSeatGroups(anchored, {
      ...baseOptions,
      screenSide: "bottom",
      ticketCount: 3,
    });

    expect(groups[0]?.seats.map((seat) => seat.row)).toEqual(["C", "C", "C"]);
    expect(groups.every((group) => ["C", "D"].includes(group.seats[0]?.row ?? ""))).toBe(true);
  });

  it("falls back to geometric ranking when Premium-adjacent rows have no valid group", () => {
    const anchored = ["A", "B", "C", "D"].flatMap((row, index) =>
      [1, 2, 3].map((number) => ({
        ...baseSeat(),
        row,
        number,
        label: `${row}${number}`,
        seatType: row === "D" ? "premiumClass" : "standard",
        surchargeYen: row === "D" ? 1600 : 0,
        available: row === "A",
        selectable: row === "A",
        x: number * 40,
        y: 100 + index * 60,
      })),
    );

    const groups = rankSeatGroups(anchored, { ...baseOptions, ticketCount: 3 });

    expect(groups[0]?.seats.map((seat) => seat.row)).toEqual(["A", "A", "A"]);
    expect(groups[0]?.reasons.some((reason) => reason.startsWith("premium anchor:"))).toBe(false);
  });
});
