import { describe, expect, it } from "vitest";
import {
  classifySeatClasses,
  normalizeSeatLabel,
  parseSeatLabel,
  seatKey,
} from "../../src/domain/seat.js";

describe("normalizeSeatLabel", () => {
  it("converts full-width labels to ascii", () => {
    expect(normalizeSeatLabel("ａ－６")).toBe("A-6");
    expect(normalizeSeatLabel("ｈ１４")).toBe("H14");
  });
});

describe("parseSeatLabel", () => {
  it("parses ascii and full-width row/number labels", () => {
    expect(parseSeatLabel("a6")).toEqual({ row: "A", number: 6 });
    expect(parseSeatLabel("ａ－６")).toEqual({ row: "A", number: 6 });
    expect(parseSeatLabel("h14")).toEqual({ row: "H", number: 14 });
    expect(seatKey("A", 6)).toBe("A6");
  });

  it("returns undefined for non seat labels", () => {
    expect(parseSeatLabel("車椅子1")).toBeUndefined();
    expect(parseSeatLabel("")).toBeUndefined();
  });
});

describe("classifySeatClasses", () => {
  it("detects standard seats", () => {
    expect(classifySeatClasses("seat seat-A seat-A6")).toEqual({
      seatType: "standard",
      wheelchair: false,
    });
  });

  it("detects known special seat types", () => {
    expect(classifySeatClasses("seat seat-A seat-A6 seat-ottoman").seatType).toBe("ottoman");
    expect(classifySeatClasses("seat seat-D seat-D4 seat-premium-class").seatType).toBe(
      "premiumClass",
    );
    expect(classifySeatClasses("seat seat-D seat-D4 seat-grand-class").seatType).toBe("grandClass");
  });

  it("flags wheelchair seats", () => {
    expect(classifySeatClasses("seat seat-A seat-A12 seat-hc")).toEqual({
      seatType: "standard",
      wheelchair: true,
    });
  });

  it("marks unrecognized special classes as unknown", () => {
    expect(classifySeatClasses("seat seat-A seat-A6 seat-brand-new-type").seatType).toBe("unknown");
  });
});
