import test from "node:test";
import assert from "node:assert/strict";
import { isPrivateIPv4, isPrivateIPv6, isPrivateIP, extractMetadata, fetchMetadata } from "../src/metadata.js";

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
