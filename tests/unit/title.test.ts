import { describe, expect, it } from "vitest";
import { formatsMatch, parseTitle, titlesMatchCore } from "../../src/domain/title.js";

describe("parseTitle", () => {
  it("normalizes half-width katakana with NFKC", () => {
    const parsed = parseTitle("ﾊｰﾄ･ｵﾌﾞ･ﾋﾞｰｽﾄ【字幕】Atmos");
    expect(parsed.core).toBe("ハートオブビースト");
    expect(parsed.formats).toEqual(["dolbyatmos", "字幕"]);
  });

  it("separates core title from format labels", () => {
    const parsed = parseTitle("ハート・オブ・ビースト【字幕】Dolby Atmos");
    expect(parsed.core).toBe("ハートオブビースト");
    expect(parsed.formats).toEqual(["dolbyatmos", "字幕"]);
  });
});

describe("titlesMatchCore", () => {
  it("matches the real half-width + Atmos alias pair", () => {
    expect(
      titlesMatchCore("ﾊｰﾄ･ｵﾌﾞ･ﾋﾞｰｽﾄ【字幕】Atmos", "ハート・オブ・ビースト【字幕】Dolby Atmos"),
    ).toBe(true);
    expect(
      formatsMatch("ﾊｰﾄ･ｵﾌﾞ･ﾋﾞｰｽﾄ【字幕】Atmos", "ハート・オブ・ビースト【字幕】Dolby Atmos"),
    ).toBe(true);
  });

  it("compares the core title exactly, without fuzzy containment", () => {
    expect(titlesMatchCore("作品A", "作品A")).toBe(true);
    expect(titlesMatchCore("作品A", "作品")).toBe(false);
    expect(titlesMatchCore("作品", "作品B")).toBe(false);
    expect(
      titlesMatchCore(
        "映画ちいかわ 人魚の島のひみつ  BESTIA enhanced",
        "ちいかわ 人魚の島のひみつ/BESTIA",
      ),
    ).toBe(false);
  });

  it("requires formats to match exactly", () => {
    expect(formatsMatch("作品【字幕】", "作品【字幕】")).toBe(true);
    expect(formatsMatch("作品【字幕】", "作品【吹替】")).toBe(false);
    expect(formatsMatch("作品【字幕】Atmos", "作品【字幕】Dolby Atmos")).toBe(true);
    expect(formatsMatch("作品", "作品【IMAX】")).toBe(false);
  });
});
