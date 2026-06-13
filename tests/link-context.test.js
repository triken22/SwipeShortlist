import test from "node:test";
import assert from "node:assert/strict";
import { linkContextForUrl } from "../public/link-context.js";

test("Airbnb share URLs produce honest deterministic context", () => {
  const context = linkContextForUrl(
    "https://www.airbnb.co.uk/rooms/1426755644990955296?unique_share_id=35a7bace-fc03-4510-ab95-5a0fb2f013f3&viralityEntryPoint=1&s=76"
  );

  assert.equal(context.providerName, "Airbnb");
  assert.equal(context.title, "Airbnb stay");
  assert.equal(context.location, "Airbnb");
  assert.equal(context.canonicalUrl, "https://www.airbnb.co.uk/rooms/1426755644990955296");
  assert.ok(context.facts.includes("Listing ID 1426755644990955296"));
  assert.ok(context.facts.includes("Price and availability must be checked on Airbnb"));
});

test("Airbnb canonical URLs keep trip parameters and drop share tracking", () => {
  const context = linkContextForUrl(
    "https://www.airbnb.co.uk/rooms/1426755644990955296?check_in=2026-07-18&check_out=2026-08-01&adults=2&children=1&unique_share_id=abc&s=76"
  );

  const canonical = new URL(context.canonicalUrl);
  assert.equal(canonical.pathname, "/rooms/1426755644990955296");
  assert.equal(canonical.searchParams.get("check_in"), "2026-07-18");
  assert.equal(canonical.searchParams.get("check_out"), "2026-08-01");
  assert.equal(canonical.searchParams.get("adults"), "2");
  assert.equal(canonical.searchParams.get("children"), "1");
  assert.equal(canonical.searchParams.has("unique_share_id"), false);
  assert.equal(canonical.searchParams.has("s"), false);
});

test("Airbnb country domains produce the same deterministic context", () => {
  const context = linkContextForUrl("https://www.airbnb.nl/rooms/1426755644990955296?s=76");

  assert.equal(context.providerName, "Airbnb");
  assert.equal(context.canonicalUrl, "https://www.airbnb.nl/rooms/1426755644990955296");
  assert.ok(context.facts.includes("Listing ID 1426755644990955296"));
});

test("Booking hotel URLs produce honest deterministic context", () => {
  const context = linkContextForUrl("https://www.booking.com/hotel/es/family-suite.html?utm_source=chat");

  assert.equal(context.providerName, "Booking.com");
  assert.equal(context.title, "Family Suite");
  assert.equal(context.location, "Booking.com");
  assert.equal(context.canonicalUrl, "https://www.booking.com/hotel/es/family-suite.html");
  assert.ok(context.facts.includes("Booking.com listing"));
});

test("Booking canonical URLs keep trip parameters and drop tracking", () => {
  const context = linkContextForUrl(
    "https://www.booking.com/hotel/es/family-suite.html?check_in=2026-07-18&check_out=2026-08-01&group_adults=2&group_children=1&utm_source=chat"
  );

  const canonical = new URL(context.canonicalUrl);
  assert.equal(canonical.pathname, "/hotel/es/family-suite.html");
  assert.equal(canonical.searchParams.get("check_in"), "2026-07-18");
  assert.equal(canonical.searchParams.get("check_out"), "2026-08-01");
  assert.equal(canonical.searchParams.get("group_adults"), "2");
  assert.equal(canonical.searchParams.get("group_children"), "1");
  assert.equal(canonical.searchParams.has("utm_source"), false);
});

test("unknown domains do not receive provider-specific context", () => {
  assert.equal(linkContextForUrl("https://example.org/family-suite"), null);
});

test("spoofed provider hosts do not receive Airbnb context", () => {
  assert.equal(linkContextForUrl("https://airbnb.evil.com/rooms/1426755644990955296"), null);
});
