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

test("Booking hotel URLs produce honest deterministic context", () => {
  const context = linkContextForUrl("https://www.booking.com/hotel/es/family-suite.html?utm_source=chat");

  assert.equal(context.providerName, "Booking.com");
  assert.equal(context.title, "Family Suite");
  assert.equal(context.location, "Booking.com");
  assert.equal(context.canonicalUrl, "https://www.booking.com/hotel/es/family-suite.html");
  assert.ok(context.facts.includes("Booking.com listing"));
});

test("unknown domains do not receive provider-specific context", () => {
  assert.equal(linkContextForUrl("https://example.org/family-suite"), null);
});
