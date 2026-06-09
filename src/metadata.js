import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

// ── SSRF-safe URL validation ──────────────────────────

const PRIVATE_IPV4_RANGES = [
  [10, 0, 0, 0, 8],
  [127, 0, 0, 0, 8],
  [169, 254, 0, 0, 16],
  [172, 16, 0, 0, 12],
  [192, 168, 0, 0, 16],
  [0, 0, 0, 0, 8],
  [100, 64, 0, 0, 10],
];

function ipInRange(ipParts, range) {
  const [a, b, c, d, bits] = range;
  if (bits <= 8) return ipParts[0] >= a && ipParts[0] < a + (1 << (8 - (bits % 8 === 0 ? 8 : bits % 8)));
  if (bits <= 16) return ipParts[0] === a && ipParts[1] >= b && ipParts[1] < b + (1 << (16 - bits));
  if (bits <= 24) return ipParts[0] === a && ipParts[1] === b && ipParts[2] >= c && ipParts[2] < c + (1 << (24 - bits));
  return ipParts[0] === a && ipParts[1] === b && ipParts[2] === c && ipParts[3] >= d;
}

export function isPrivateIPv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return true;
  return PRIVATE_IPV4_RANGES.some((range) => ipInRange(parts, range));
}

export function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80") || lower.startsWith("fe8")) return true;
  // IPv4-mapped IPv6 — extract embedded IPv4
  const v4match = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4match) return isPrivateIPv4(v4match[1]);
  return false;
}

export function isPrivateIP(ip) {
  if (isIP(ip) === 4) return isPrivateIPv4(ip);
  if (isIP(ip) === 6) return isPrivateIPv6(ip);
  return true;
}

export async function isSafeUrl(urlStr) {
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const hostname = url.hostname;
  if (isIP(hostname)) return !isPrivateIP(hostname);

  try {
    const addresses = await dnsLookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) return false;
    for (const addr of addresses) {
      if (isPrivateIP(typeof addr === "string" ? addr : addr.address)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ── HTML metadata extraction ──────────────────────────

export function extractMetadata(html) {
  const result = {};

  // <title>
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) result.title = titleMatch[1].replace(/\s+/g, " ").trim().slice(0, 200);

  // <meta> tags — match both name and property variants
  const metaPattern = /<meta[^>]+(?:name|property)=["']([^"']+)["'][^>]*>/gi;
  let metaMatch;
  while ((metaMatch = metaPattern.exec(html)) !== null) {
    const name = metaMatch[1].toLowerCase();
    const contentMatch = metaMatch[0].match(/content\s*=\s*["']([^"']*)["']/i);
    if (!contentMatch) continue;
    const content = contentMatch[1].replace(/\s+/g, " ").trim().slice(0, 500);
    if (!content) continue;

    if (name === "description") result.description = result.description || content;
    if (name === "og:title" || name === "twitter:title") result.ogTitle = result.ogTitle || content;
    if (name === "og:description" || name === "twitter:description") result.ogDescription = result.ogDescription || content;
    if (name === "og:image" || name === "twitter:image") result.ogImage = result.ogImage || content;
    if (name === "og:site_name") result.siteName = result.siteName || content;
  }

  return result;
}

// ── Fetch metadata from URL (SSRF-safe) ───────────────

export async function fetchMetadata(urlStr) {
  if (!(await isSafeUrl(urlStr))) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(urlStr, {
      signal: controller.signal,
      headers: {
        "user-agent": "SwipeShortlist/1.0",
        accept: "text/html, application/xhtml+xml",
      },
    });

    // Validate final URL after redirects
    if (response.url !== urlStr) {
      if (!(await isSafeUrl(response.url))) return null;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return null;
    }

    // Read body with a 64 KB limit
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > 65536) break;
      chunks.push(chunk);
    }
    const html = Buffer.concat(chunks).toString("utf8");
    const meta = extractMetadata(html);

    return {
      url: urlStr,
      title: meta.ogTitle || meta.title || null,
      description: meta.ogDescription || meta.description || null,
      siteName: meta.siteName || null,
      ogImage: meta.ogImage || null,
      fetched: true,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
