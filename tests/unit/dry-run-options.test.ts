import { describe, expect, it } from "vitest";
import {
  parseAdjacentOption,
  parseMaxSurchargeOption,
  parseTargetRowRatioOption,
  parseTicketsOption,
  parseTopOption,
} from "../../src/services/dry-run-options.js";

describe("parseTicketsOption", () => {
  it("defaults and accepts 1..6", () => {
    expect(parseTicketsOption(undefined)).toBe(1);
    expect(parseTicketsOption("3")).toBe(3);
    expect(parseTicketsOption("6")).toBe(6);
  });

  it.each(["0", "7", "1.5", "abc", "-1"])("rejects %j", (value) => {
    expect(() => parseTicketsOption(value)).toThrow();
  });
});

describe("parseTargetRowRatioOption", () => {
  it("defaults and accepts 0..1", () => {
    expect(parseTargetRowRatioOption(undefined)).toBe(0.65);
    expect(parseTargetRowRatioOption("0")).toBe(0);
    expect(parseTargetRowRatioOption("0.5")).toBe(0.5);
    expect(parseTargetRowRatioOption("1")).toBe(1);
  });

  it.each(["NaN", "-0.1", "1.1", "abc"])("rejects %j", (value) => {
    expect(() => parseTargetRowRatioOption(value)).toThrow();
  });
});

describe("parseTopOption", () => {
  it("defaults and accepts 1..50", () => {
    expect(parseTopOption(undefined)).toBe(5);
    expect(parseTopOption("1")).toBe(1);
    expect(parseTopOption("50")).toBe(50);
  });

  it.each(["0", "51", "2.5", "abc"])("rejects %j", (value) => {
    expect(() => parseTopOption(value)).toThrow();
  });
});

describe("parseAdjacentOption", () => {
  it("defaults and parses explicit booleans", () => {
    expect(parseAdjacentOption(undefined)).toBe(true);
    expect(parseAdjacentOption("false")).toBe(false);
    expect(parseAdjacentOption("no")).toBe(false);
    expect(parseAdjacentOption("true")).toBe(true);
  });

  it("rejects ambiguous values", () => {
    expect(() => parseAdjacentOption("maybe")).toThrow();
    expect(() => parseAdjacentOption("flase")).toThrow();
  });
});

describe("parseMaxSurchargeOption", () => {
  it("defaults and accepts non-negative integers", () => {
    expect(parseMaxSurchargeOption(undefined)).toBe(0);
    expect(parseMaxSurchargeOption("1600")).toBe(1600);
  });

  it.each(["-1", "1.5", "abc"])("rejects %j", (value) => {
    expect(() => parseMaxSurchargeOption(value)).toThrow();
  });
});
