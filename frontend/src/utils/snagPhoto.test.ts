import { describe, expect, it } from "vitest";

import {
  directionsUrl,
  locationAddress,
  parseCoordinates,
  usableLocation,
} from "./snagPhoto";

const DPR = "Prestige Tech Park, Bengaluru (Lat: 12.9716, Lon: 77.5946)";

describe("parseCoordinates", () => {
  it("reads the DPR format", () => {
    expect(parseCoordinates(DPR)).toEqual({ lat: 12.9716, lon: 77.5946 });
    expect(parseCoordinates("X (Lat: -33.8688, Lon: -151.2093)")).toEqual({
      lat: -33.8688,
      lon: -151.2093,
    });
  });

  it("returns null without coordinates", () => {
    for (const v of [null, undefined, "", "Prestige Tech Park", "Location Not Found (Error)"]) {
      expect(parseCoordinates(v)).toBeNull();
    }
  });
});

describe("locationAddress", () => {
  it("splits the address off the coordinates", () => {
    expect(locationAddress(DPR)).toBe("Prestige Tech Park, Bengaluru");
    expect(locationAddress(null)).toBe("");
  });
});

describe("directionsUrl", () => {
  // The same URLs `services/test_snag_photo.py` pins for the PDF's Map link.
  it("uses the coordinates when there are any", () => {
    expect(directionsUrl(DPR)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=12.9716,77.5946"
    );
  });

  it("links an address without coordinates by its text", () => {
    expect(directionsUrl("Tech Park, Bengaluru")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=Tech%20Park,%20Bengaluru"
    );
  });

  it("gives no link without a location", () => {
    expect(directionsUrl(null)).toBeNull();
    expect(directionsUrl("   ")).toBeNull();
  });
});

describe("usableLocation", () => {
  it("keeps a location with real coordinates", () => {
    expect(usableLocation(DPR)).toBe(DPR);
  });

  it("drops DPR's GPS failure strings and a null island", () => {
    expect(usableLocation("Location Not Found (Error)")).toBeNull();
    expect(usableLocation("Geolocation Not Supported")).toBeNull();
    expect(usableLocation("X (Lat: 0.0000, Lon: 0.0000)")).toBeNull();
    expect(usableLocation(null)).toBeNull();
  });
});
