import test from "node:test";
import assert from "node:assert/strict";
import { isPrivateIPv4, isPrivateIPv6, isPrivateIP, extractMetadata, fetchMetadata, readLimitedBody, cleanTrackingUrl, extractDomainFallback, extractStructuredData } from "../src/metadata.js";

// isPrivateIPv4

test("isPrivateIPv4 identifies loopback addresses", () => {
  assert.equal(isPrivateIPv4("127.0.0.1"), true);
  assert.equal(isPrivateIPv4("127.255.255.255"), true);
});

test("isPrivateIPv4 identifies private 10.x.x.x", () => {
  assert.equal(isPrivateIPv4("10.0.0.1"), true);
  assert.equal(isPrivateIPv4("10.255.255.255"), true);
});

test("isPrivateIPv4 identifies private 192.168.x.x", () => {
  assert.equal(isPrivateIPv4("192.168.0.1"), true);
  assert.equal(isPrivateIPv4("192.168.255.255"), true);
});

test("isPrivateIPv4 identifies private 172.16-31.x.x", () => {
  assert.equal(isPrivateIPv4("172.16.0.1"), true);
  assert.equal(isPrivateIPv4("172.31.255.255"), true);
  assert.equal(isPrivateIPv4("172.32.0.1"), false);
});

test("isPrivateIPv4 identifies link-local 169.254.x.x", () => {
  assert.equal(isPrivateIPv4("169.254.1.1"), true);
  assert.equal(isPrivateIPv4("169.254.255.255"), true);
});

test("isPrivateIPv4 identifies cloud metadata IPs", () => {
  assert.equal(isPrivateIPv4("169.254.169.254"), true);
});

test("isPrivateIPv4 identifies CGNAT 100.64.x.x", () => {
  assert.equal(isPrivateIPv4("100.64.0.1"), true);
  assert.equal(isPrivateIPv4("100.127.255.255"), true);
  assert.equal(isPrivateIPv4("100.128.0.1"), false);
});

test("isPrivateIPv4 identifies reserved and multicast ranges", () => {
  assert.equal(isPrivateIPv4("192.0.2.10"), true);
  assert.equal(isPrivateIPv4("198.51.100.10"), true);
  assert.equal(isPrivateIPv4("203.0.113.10"), true);
  assert.equal(isPrivateIPv4("224.0.0.1"), true);
  assert.equal(isPrivateIPv4("255.255.255.255"), true);
});

test("isPrivateIPv4 rejects public IPs", () => {
  assert.equal(isPrivateIPv4("8.8.8.8"), false);
  assert.equal(isPrivateIPv4("1.1.1.1"), false);
  assert.equal(isPrivateIPv4("93.184.216.34"), false);
  assert.equal(isPrivateIPv4("140.82.121.3"), false);
});

test("isPrivateIPv4 treats malformed input as private (safe default)", () => {
  assert.equal(isPrivateIPv4("not-an-ip"), true);
  assert.equal(isPrivateIPv4(""), true);
});

// isPrivateIPv6

test("isPrivateIPv6 identifies loopback ::1", () => {
  assert.equal(isPrivateIPv6("::1"), true);
  assert.equal(isPrivateIPv6("0:0:0:0:0:0:0:1"), true);
});

test("isPrivateIPv6 identifies unique-local fc00::/7", () => {
  assert.equal(isPrivateIPv6("fc00::"), true);
  assert.equal(isPrivateIPv6("fd00::1"), true);
  assert.equal(isPrivateIPv6("fd12:3456:7890::1"), true);
});

test("isPrivateIPv6 identifies link-local fe80::/10", () => {
  assert.equal(isPrivateIPv6("fe80::1"), true);
  assert.equal(isPrivateIPv6("fe80::abcd"), true);
  assert.equal(isPrivateIPv6("febf::1"), true);
});

test("isPrivateIPv6 identifies reserved ranges", () => {
  assert.equal(isPrivateIPv6("::"), true);
  assert.equal(isPrivateIPv6("2001:db8::1"), true);
  assert.equal(isPrivateIPv6("ff02::1"), true);
});

test("isPrivateIPv6 identifies IPv4-mapped private", () => {
  assert.equal(isPrivateIPv6("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateIPv6("::ffff:10.0.0.1"), true);
  assert.equal(isPrivateIPv6("::ffff:192.168.1.1"), true);
  // Hex forms of IPv4-mapped private addresses (SSRF bypass vector)
  assert.equal(isPrivateIPv6("::ffff:7f00:1"), true);   // hex form of 127.0.0.1
  assert.equal(isPrivateIPv6("::ffff:a00:1"), true);    // hex form of 10.0.0.1
  assert.equal(isPrivateIPv6("::ffff:c0a8:101"), true); // hex form of 192.168.1.1
  assert.equal(isPrivateIPv6("::ffff:ac10:1"), true);   // hex form of 172.16.0.1
  // Full 16-byte form with hex embedded IPv4
  assert.equal(isPrivateIPv6("0:0:0:0:0:ffff:7f00:1"), true);
  assert.equal(isPrivateIPv6("0:0:0:0:0:ffff:a00:1"), true);
});

test("isPrivateIPv6 rejects public IPv6", () => {
  assert.equal(isPrivateIPv6("2001:4860:4860::8888"), false);
  assert.equal(isPrivateIPv6("2606:4700:4700::1111"), false);
});

// isPrivateIP

test("isPrivateIP delegates to IPv4 and IPv6 checkers", () => {
  assert.equal(isPrivateIP("127.0.0.1"), true);
  assert.equal(isPrivateIP("::1"), true);
  assert.equal(isPrivateIP("8.8.8.8"), false);
  assert.equal(isPrivateIP("2001:4860:4860::8888"), false);
});

// extractMetadata

test("extractMetadata extracts title", () => {
  const html = "<html><head><title>Test Page</title></head><body></body></html>";
  const result = extractMetadata(html);
  assert.equal(result.title, "Test Page");
});

test("extractMetadata extracts meta description", () => {
  const html = '<html><head><meta name="description" content="A test page description"></head><body></body></html>';
  const result = extractMetadata(html);
  assert.equal(result.description, "A test page description");
});

test("extractMetadata handles meta attributes in any order", () => {
  const html = '<html><head><meta content="OG Title First" property="og:title"><meta content="Reversed desc" name="description"></head><body></body></html>';
  const result = extractMetadata(html);
  assert.equal(result.ogTitle, "OG Title First");
  assert.equal(result.description, "Reversed desc");
});

test("extractMetadata decodes common HTML entities", () => {
  const html = '<html><head><title>Tom &amp; Jerry</title><meta name="description" content="One&nbsp;line &quot;quoted&quot;"></head><body></body></html>';
  const result = extractMetadata(html);
  assert.equal(result.title, "Tom & Jerry");
  assert.equal(result.description, 'One line "quoted"');
});

test("extractMetadata extracts og:title and og:description", () => {
  const html = '<html><head><meta property="og:title" content="OG Title"><meta property="og:description" content="OG Desc"></head><body></body></html>';
  const result = extractMetadata(html);
  assert.equal(result.ogTitle, "OG Title");
  assert.equal(result.ogDescription, "OG Desc");
});

test("extractMetadata extracts twitter:image", () => {
  const html = '<html><head><meta name="twitter:image" content="https://example.com/image.jpg"></head><body></body></html>';
  const result = extractMetadata(html);
  assert.equal(result.ogImage, "https://example.com/image.jpg");
});

test("extractMetadata extracts og:site_name", () => {
  const html = '<html><head><meta property="og:site_name" content="ExampleSite"></head><body></body></html>';
  const result = extractMetadata(html);
  assert.equal(result.siteName, "ExampleSite");
});

test("extractMetadata prefers og:title over html title", () => {
  const html = '<html><head><title>HTML Title</title><meta property="og:title" content="OG Title"></head><body></body></html>';
  const result = extractMetadata(html);
  assert.equal(result.ogTitle, "OG Title");
  assert.equal(result.title, "HTML Title");
});

test("extractMetadata returns empty object for no metadata", () => {
  const html = "<html><head></head><body>No meta here</body></html>";
  const result = extractMetadata(html);
  assert.deepEqual(result, {});
});

test("extractMetadata handles tags without meta content gracefully", () => {
  const html = '<html><head><meta name="description"><meta property="og:title"></head><body></body></html>';
  const result = extractMetadata(html);
  assert.equal(Object.keys(result).length, 0);
});

test("extractMetadata trims whitespace in title", () => {
  const html = "<html><head><title>  Spaced Title  </title></head><body></body></html>";
  const result = extractMetadata(html);
  assert.equal(result.title, "Spaced Title");
});

test("extractMetadata trims whitespace in meta content", () => {
  const html = '<html><head><meta name="description" content="  Description with space  "></head><body></body></html>';
  const result = extractMetadata(html);
  assert.equal(result.description, "Description with space");
});

test("extractMetadata handles multiple identical meta tags (first wins)", () => {
  const html = '<html><head><meta name="description" content="First"><meta name="description" content="Second"></head><body></body></html>';
  const result = extractMetadata(html);
  assert.equal(result.description, "First");
});

// fetchMetadata

test("fetchMetadata validates redirect targets before fetching them", async () => {
  const calls = [];
  const result = await fetchMetadata("https://public.example/start", {
    isSafe: async (url) => {
      calls.push(`safe:${url}`);
      return !url.startsWith("http://169.254.169.254");
    },
    fetchImpl: async (url, options) => {
      calls.push(`fetch:${url}:${options.redirect}`);
      return new Response("", {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      });
    },
  });

  assert.equal(result, null);
  assert.deepEqual(calls, [
    "safe:https://public.example/start",
    "fetch:https://public.example/start:manual",
    "safe:http://169.254.169.254/latest/meta-data",
  ]);
});

test("fetchMetadata follows safe relative redirects manually", async () => {
  const fetched = [];
  const result = await fetchMetadata("https://public.example/start", {
    isSafe: async () => true,
    fetchImpl: async (url, options) => {
      fetched.push(`${url}:${options.redirect}`);
      if (url.endsWith("/start")) {
        return new Response("", {
          status: 301,
          headers: { location: "/final" },
        });
      }
      return new Response(
        '<html><head><title>Final Page</title><meta property="og:description" content="Useful card context"></head></html>',
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }
      );
    },
  });

  assert.deepEqual(fetched, [
    "https://public.example/start:manual",
    "https://public.example/final:manual",
  ]);
  assert.equal(result.title, "Final Page");
  assert.equal(result.description, "Useful card context");
});

test("fetchMetadata ignores low-quality error titles", async () => {
  const result = await fetchMetadata("https://public.example/missing", {
    isSafe: async () => true,
    fetchImpl: async () =>
      new Response("<html><head><title>404 Page Not Found - Example</title></head></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  });

  assert.equal(result, null);
});

test("fetchMetadata aborts stalled response body reads", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("<html><head><title>Slow"));
    },
  });
  const startedAt = Date.now();

  const result = await fetchMetadata("https://public.example/slow", {
    isSafe: async () => true,
    timeoutMs: 20,
    fetchImpl: async () =>
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  });

  assert.equal(result, null);
  assert.ok(Date.now() - startedAt < 1000, "stalled body read returns after the metadata deadline");
});

// --- Link Intelligence: improved body reading ---

test("readLimitedBody reads past 64KB to find </head> boundary", async () => {
  // Create HTML with padding >64KB before </head> so OG tags land after
  // the original 64KB cutoff.
  const padding = "x".repeat(66000);
  const html = `<html><head>\n${padding}<meta property="og:title" content="Deep OGTag">\n<meta property="og:site_name" content="DeepSite">\n</head><body></body></html>`;

  const response = new Response(html);
  const result = await readLimitedBody(response.body);

  // Should include the deep OG tags (trimmed at </head> boundary)
  assert.ok(result.includes("Deep OGTag"), "og:title past 64KB is captured");
  assert.ok(result.includes("DeepSite"), "og:site_name past 64KB is captured");
  // Should NOT include <body> content
  assert.ok(!result.includes("<body>"), "body is excluded by </head> trim");
});

test("fetchMetadata extracts OG metadata from response body past 64KB", async () => {
  // Simulate the Airbnb scenario where OG tags appear after ~85KB.
  const padding = "x".repeat(86000);
  const html = `<!doctype html><html><head>${padding}<meta property="og:title" content="Serviced apartment in Athens · ★4.88 · 1 bedroom">
<meta property="og:description" content="Serenity Penthouse with Terrace in Exarchia">
<meta property="og:site_name" content="Airbnb">
<meta name="description" content="Serenity Penthouse with Terrace in Exarchia">
</head><body></body></html>`;

  const result = await fetchMetadata("https://www.airbnb.co.uk/rooms/1426755644990955296", {
    isSafe: async () => true,
    fetchImpl: async () =>
      new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  });

  assert.notEqual(result, null);
  assert.equal(result.siteName, "Airbnb");
  assert.ok(result.title.includes("Serviced apartment"), `title "${result.title}" includes apartment context`);
  assert.ok(result.description.includes("Serenity"), "description includes listing description");
  assert.equal(result.fetched, true);
});

// --- Link Intelligence: domain-aware deterministic fallback ---

test("extractDomainFallback recognizes Airbnb rooms URL and returns listing ID", () => {
  const result = extractDomainFallback("https://www.airbnb.co.uk/rooms/1426755644990955296?unique_share_id=xxx&s=76");

  assert.notEqual(result, null);
  assert.equal(result.provider, "Airbnb");
  assert.equal(result.sourceKind, "vacation rental listing");
  assert.equal(result.listingId, "1426755644990955296");
  assert.equal(result.canonicalUrl, "https://www.airbnb.co.uk/rooms/1426755644990955296");
  assert.ok(result.facts.includes("Price and availability must be checked on Airbnb"));
});

test("extractDomainFallback preserves Airbnb trip parameters", () => {
  const result = extractDomainFallback(
    "https://www.airbnb.co.uk/rooms/1426755644990955296?check_in=2026-07-18&check_out=2026-08-01&adults=2&children=1&unique_share_id=xxx&s=76"
  );

  const canonical = new URL(result.canonicalUrl);
  assert.equal(canonical.searchParams.get("check_in"), "2026-07-18");
  assert.equal(canonical.searchParams.get("check_out"), "2026-08-01");
  assert.equal(canonical.searchParams.get("adults"), "2");
  assert.equal(canonical.searchParams.get("children"), "1");
  assert.equal(canonical.searchParams.has("unique_share_id"), false);
  assert.equal(canonical.searchParams.has("s"), false);
});

test("extractDomainFallback recognizes Booking.com hotel URL", () => {
  const result = extractDomainFallback("https://www.booking.com/hotel/es/some-example.html?check_in=2026-07-18&check_out=2026-08-01&group_adults=2&utm_source=chat");

  assert.notEqual(result, null);
  assert.equal(result.provider, "Booking.com");
  assert.equal(result.sourceKind, "accommodation listing");
  // Note: listingId preserves file extension from Booking.com hotel slug
  assert.equal(result.listingId, "some-example.html");
  assert.equal(result.canonicalUrl, "https://www.booking.com/hotel/es/some-example.html?check_in=2026-07-18&check_out=2026-08-01&group_adults=2");
  assert.ok(result.facts.includes("Price and availability must be checked on Booking.com"));
});

test("extractDomainFallback returns null for unrecognized domains", () => {
  const result = extractDomainFallback("https://example.org/some-page");
  // Generic fallback may extract path segment
  if (result) {
    assert.equal(result.listingId, null);
    assert.equal(result.canonicalUrl, null);
  }
});

test("extractDomainFallback returns null for unknown domain with useful path", () => {
  const result = extractDomainFallback("https://example.org/cool-resort");
  // Generic path-based fallback is intentionally omitted — only known providers get domain-aware context.
  assert.equal(result, null);
});

// --- Link Intelligence: URL cleaning ---

test("cleanTrackingUrl removes Airbnb share tracking parameters", () => {
  const cleaned = cleanTrackingUrl(
    "https://www.airbnb.co.uk/rooms/1426755644990955296?unique_share_id=35a7bace-fc03-4510-ab95-5a0fb2f013f3&viralityEntryPoint=1&s=76"
  );
  assert.ok(!cleaned.includes("unique_share_id"), "unique_share_id removed");
  assert.ok(!cleaned.includes("viralityEntryPoint"), "viralityEntryPoint removed");
  assert.ok(!cleaned.includes("&s=76"), "s param removed");
  assert.ok(cleaned.includes("/rooms/1426755644990955296"), "listing ID preserved");
});

test("cleanTrackingUrl removes utm_* parameters", () => {
  const cleaned = cleanTrackingUrl("https://example.org/page?utm_source=twitter&utm_medium=social&real=keep");
  assert.ok(!cleaned.includes("utm_source"), "utm_source removed");
  assert.ok(!cleaned.includes("utm_medium"), "utm_medium removed");
  assert.ok(cleaned.includes("real=keep"), "non-tracking params kept");
});

test("cleanTrackingUrl returns original on invalid URL", () => {
  assert.equal(cleanTrackingUrl("not-a-url"), "not-a-url");
});

// --- Link Intelligence: structured data extraction ---

test("extractStructuredData extracts JSON-LD blocks", () => {
  const html = `<html><head>
<script type="application/ld+json">{"@type":"Product","name":"Test Listing","image":"https://example.org/pic.jpg"}</script>
<script type="application/ld+json">{"@type":"Hotel","name":"Beach Hotel"}</script>
</head><body></body></html>`;

  const result = extractStructuredData(html);
  assert.equal(result.length, 2);
  assert.equal(result[0]["@type"], "Product");
  assert.equal(result[0].name, "Test Listing");
  assert.equal(result[1]["@type"], "Hotel");
});

test("extractStructuredData skips invalid JSON gracefully", () => {
  const html = `<html><head>
<script type="application/ld+json">{invalid}</script>
<script type="application/ld+json">{"@type":"Restaurant","name":"Good Eats"}</script>
</head><body></body></html>`;

  const result = extractStructuredData(html);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "Good Eats");
});

test("extractStructuredData returns empty array when no JSON-LD present", () => {
  const result = extractStructuredData("<html><head></head></html>");
  assert.deepEqual(result, []);
});

// --- Link Intelligence: fetchMetadata domain-aware fallback ---

test("fetchMetadata falls back to domain-aware context for Airbnb when OG extraction yields nothing", async () => {
  // HTML with no OG tags, no title, no description - triggers domain fallback
  const html = "<html><head><meta charset=\"utf-8\"></head><body>No useful metadata here</body></html>";

  const result = await fetchMetadata("https://www.airbnb.co.uk/rooms/1426755644990955296", {
    isSafe: async () => true,
    fetchImpl: async () =>
      new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  });

  assert.notEqual(result, null, "domain fallback returns non-null");
  assert.equal(result.siteName, "Airbnb");
  assert.ok(result.title.includes("Airbnb"), `fallback title "${result.title}" mentions Airbnb`);
  assert.ok(result.description.includes("Listing ID"), "fallback description mentions listing ID");
  assert.equal(result.fetched, true);
  assert.equal(result._fallback, true, "marks result as fallback");
});

test("fetchMetadata returns null for unrecognized domain with no OG tags", async () => {
  const result = await fetchMetadata("https://example.org/unknown-page", {
    isSafe: async () => true,
    fetchImpl: async () =>
      new Response("<html><head></head><body>nothing</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  });

  // Unknown domain with no OG metadata returns null
  assert.equal(result, null);
});

test("fetchMetadata does not apply Airbnb fallback to spoofed hosts", async () => {
  const result = await fetchMetadata("https://airbnb.evil.com/rooms/1426755644990955296", {
    isSafe: async () => true,
    fetchImpl: async () =>
      new Response("<html><head></head><body>nothing</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  });

  assert.equal(result, null);
});

test("fetchMetadata filters untrusted third-party og:image URLs", async () => {
  const html = `
    <html><head>
      <meta property="og:title" content="Trusted title">
      <meta property="og:image" content="https://tracker.example.net/pixel.jpg">
    </head></html>
  `;
  const result = await fetchMetadata("https://example.org/page", {
    isSafe: async () => true,
    fetchImpl: async () =>
      new Response(html, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  });

  assert.equal(result.title, "Trusted title");
  assert.equal(result.ogImage, null);
});

test("fetchMetadata keeps trusted Airbnb image CDN URLs", async () => {
  const html = `
    <html><head>
      <meta property="og:title" content="Airbnb stay">
      <meta property="og:image" content="https://a0.muscache.com/im/pictures/example.jpeg">
    </head></html>
  `;
  const result = await fetchMetadata("https://www.airbnb.co.uk/rooms/1426755644990955296", {
    isSafe: async () => true,
    fetchImpl: async () =>
      new Response(html, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  });

  assert.equal(result.ogImage, "https://a0.muscache.com/im/pictures/example.jpeg");
});
