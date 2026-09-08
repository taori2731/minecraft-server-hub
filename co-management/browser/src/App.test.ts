import { describe, expect, it } from "vitest";
import { formatFieldValue } from "./App";

describe("co-management change confirmation values", () => {
  it("formats the before and after values with the same visible unit", () => {
    expect(formatFieldValue("viewDistance", 8)).toBe("8 チャンク");
    expect(formatFieldValue("expRate", 2.5)).toBe("2.5 倍");
    expect(formatFieldValue("pvp", true)).toBe("有効");
    expect(formatFieldValue("pvp", false)).toBe("無効");
    expect(formatFieldValue("serverDescription", undefined)).toBe("未設定");
  });
});
