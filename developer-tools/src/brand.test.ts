import { describe, expect, it } from "vitest";
import { developerBrand } from "./brand";

describe("Developer Tools brand", () => {
  it("centralizes the current and legacy display names", () => {
    expect(developerBrand.productName).toBe("TomoNode Developer Tools");
    expect(developerBrand.consumerProductName).toBe("TomoNode");
    expect(developerBrand.legacyProductName).toBe("Minecraft Server Hub Developer Tools");
    expect(developerBrand.legacyConsumerProductName).toBe("Minecraft Server Hub");
    expect(developerBrand.descriptorEn).toBe("Game Server Manager for Windows");
  });
});
