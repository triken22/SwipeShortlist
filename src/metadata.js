import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

const FETCH_TIMEOUT_MS = 4000;
const MAX_HEAD_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const AIRBNB_DOMAINS = ["airbnb.com", "airbnb.co.uk", "airbnb.de", "airbnb.fr", "airbnb.es", "airbnb.it", "airbnb.ca", "airbnb.com.au"];
const BOOKING_DOMAINS = ["booking.com"];
const TRUSTED_IMAGE_SOURCES = [
  { sourceDomains: AIRBNB_DOMAINS, imageDomains: ["muscache.com", "airbnb.com"] },
  { sourceDomains: BOOKING_DOMAINS, imageDomains: ["bstatic.com", "booking.com"] },
];

// Treat private, local, multicast, and reserved ranges as unsafe fetch targets.
const BLOCKED_IPV4_RANGES = [
  [0, 0, 0, 0, 8],
  [10, 0, 0, 0, 8],
  [100, 64, 0, 0, 10],
  [127, 0, 0, 0, 8],
  [169, 254, 0, 0, 16],
  [172, 16, 0, 0, 12],
  [192, 0, 0, 0, 24],
  [192, 0, 2, 0, 24],
  [192, 168, 0, 0, 16],
  [198, 18, 0, 0, 15],
  [198, 51, 100, 0, 24],
  [203, 0, 113, 0, 24],
  [224, 0, 0, 0, 4],
  [240, 0, 0, 0, 4],
];

function ipv4ToInt(parts) {
  return parts.reduce((total, part) => ((total << 8) + part) >>> 0, 0);
}

function ipInRange(ipParts, range) {
  const [a, b, c, d, bits] = range;
  const ip = ipv4ToInt(ipParts);
  const base = ipv4ToInt([a, b, c, d]);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((base & mask) >>> 0);
}

export function isPrivateIPv4(ip) {
  const partStrings = ip.split(".");
  const parts = partStrings.map(Number);
  if (
    parts.length !== 4 ||
    partStrings.some((part) => !/^\d+$/.test(part)) ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  return BLOCKED_IPV4_RANGES.some((range) => ipInRange(parts, range));
}

export function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === "::") return true;
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  const firstHextet = parseInt(lower.split(":")[0] || "0", 16);
  if (!Number.isNaN(firstHextet)) {
    if ((firstHextet & 0xfe00) === 0xfc00) return true;
    if ((firstHextet & 0xffc0) === 0xfe80) return true;
    if ((firstHextet & 0xff00) === 0xff00) return true;
    if (firstHextet === 0x2001 && lower.startsWith("2001:db8")) return true;
  }
  const mappedIPv4 = mappedIPv4FromIPv6(lower);
  if (mappedIPv4) return isPrivateIPv4(mappedIPv4);
  return false;
}

export function isPrivateIP(ip) {
  if (isIP(ip) === 4) return isPrivateIPv4(ip);
  if (isIP(ip) === 6) return isPrivateIPv6(ip);
  return true;
}

export async function isSafeUrl(urlStr) {
  return Boolean(await safeUrlTarget(urlStr));
}

async function safeUrlTarget(urlStr) {
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const hostname = url.hostname;
  if (isIP(hostname)) {
    return isPrivateIP(hostname) ? null : { url, address: hostname };
  }

  try {
    const addresses = await dnsLookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) return null;
    for (const addr of addresses) {
      if (isPrivateIP(typeof addr === "string" ? addr : addr.address)) return null;
    }
    const first = addresses[0];
    return { url, address: typeof first === "string" ? first : first.address };
  } catch {
    return null;
  }
}

export function extractMetadata(html) {
  const result = {};

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) result.title = cleanText(titleMatch[1], 200);

  const metaPattern = /<meta\b[^>]*>/gi;
  let metaMatch;
  while ((metaMatch = metaPattern.exec(html)) !== null) {
    const attrs = parseAttributes(metaMatch[0]);
    const name = (attrs.property || attrs.name || "").toLowerCase();
    const content = cleanText(attrs.content || "", 500);
    if (!content) continue;

    if (name === "description") result.description = result.description || content;
    if (name === "og:title" || name === "twitter:title") result.ogTitle = result.ogTitle || content;
    if (name === "og:description" || name === "twitter:description") result.ogDescription = result.ogDescription || content;
    if (name === "og:image" || name === "twitter:image") result.ogImage = result.ogImage || content;
    if (name === "og:site_name") result.siteName = result.siteName || content;
  }

  return result;
}

function parseAttributes(tag) {
  const attrs = {};
  const attrPattern = /([^\s"'=<>`]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let attrMatch;
  while ((attrMatch = attrPattern.exec(tag)) !== null) {
    attrs[attrMatch[1].toLowerCase()] = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";
  }
  return attrs;
}

function cleanText(value, maxLength) {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanCardText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function decodeHtmlEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return named[lower] || match;
  });
}

export async function fetchMetadata(urlStr, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const safeUrl = options.isSafe || isSafeUrl;
  const useInjectedFetch = Boolean(options.fetchImpl);
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : FETCH_TIMEOUT_MS;
  let currentUrl = urlStr;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const target = useInjectedFetch ? null : await safeUrlTarget(currentUrl);
    if (useInjectedFetch) {
      if (!(await safeUrl(currentUrl))) return null;
    } else if (!target) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;

    try {
      response = useInjectedFetch
        ? await fetchImpl(currentUrl, {
            signal: controller.signal,
            redirect: "manual",
            headers: requestHeadersFor(new URL(currentUrl)),
          })
        : await fetchPinnedTarget(target, controller.signal);
    } catch {
      clearTimeout(timeout);
      return null;
    }

    if (isRedirect(response.status)) {
      closeResponseBody(response.body);
      clearTimeout(timeout);
      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) return null;
      let nextUrl;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        return null;
      }
      if (!(await safeUrl(nextUrl))) return null;
      currentUrl = nextUrl;
      continue;
    }

    if (response.status >= 400) {
      closeResponseBody(response.body);
      clearTimeout(timeout);
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      closeResponseBody(response.body);
      clearTimeout(timeout);
      return null;
    }
    if (!response.body) {
      clearTimeout(timeout);
      return null;
    }

    let html;
    try {
      html = await readLimitedBody(response.body, { signal: controller.signal });
    } catch {
      closeResponseBody(response.body);
      clearTimeout(timeout);
      return null;
    }
    clearTimeout(timeout);
    const meta = extractMetadata(html);

    let title = meta.ogTitle || meta.title || null;
    let description = meta.ogDescription || meta.description || null;
    let siteName = meta.siteName || null;
    let ogImage = trustedMetadataImageUrl(meta.ogImage, currentUrl);
    if (isLowQualityTitle(title)) title = null;

    // If OG extraction gave nothing useful, try JSON-LD structured data.
    if (!title && !description && !siteName) {
      const structured = extractStructuredData(html);
      const structTitle = structuredTitle(structured);
      const structImg = structuredImage(structured);
      if (structTitle) title = structTitle;
      if (structImg) ogImage = trustedMetadataImageUrl(structImg, currentUrl);
    }

    // If still no useful metadata, apply deterministic domain-aware fallback.
    if (!title && !description && !siteName) {
      const fallback = extractDomainFallback(currentUrl);
      if (fallback) {
        const fallbackTitle = `${fallback.provider} ${fallback.sourceKind}`;
        const fallbackDesc = fallback.listingId
          ? `Listing ID: ${fallback.listingId}`
          : fallback.facts.join(" · ");
        return {
          url: urlStr,
          title: cleanCardText(fallbackTitle, 72),
          description: cleanCardText(fallbackDesc, 200) || null,
          siteName: fallback.provider,
          canonicalUrl: fallback.canonicalUrl || null,
          fetched: true,
          _fallback: true,
        };
      }
      return null;
    }

    return {
      url: urlStr,
      title: cleanCardText(title, 72) || null,
      description: cleanCardText(description, 200) || null,
      siteName: cleanCardText(siteName, 80) || null,
      ogImage,
      fetched: true,
    };
  }

  return null;
}

function mappedIPv4FromIPv6(lower) {
  const dotted = lower.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];

  const hex = lower.match(/^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return "";
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

function requestHeadersFor(url) {
  return {
    host: url.host,
    "user-agent": "SwipeShortlist/1.0",
    accept: "text/html, application/xhtml+xml",
  };
}

function fetchPinnedTarget(target, signal) {
  const { url, address } = target;
  const isHttps = url.protocol === "https:";
  const transport = isHttps ? https : http;
  const port = url.port || (isHttps ? 443 : 80);

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: address,
        port,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: requestHeadersFor(url),
        servername: url.hostname,
        family: isIP(address) === 6 ? 6 : 4,
      },
      (res) => {
        resolve({
          status: res.statusCode || 0,
          headers: {
            get(name) {
              const value = res.headers[String(name).toLowerCase()];
              if (Array.isArray(value)) return value.join(", ");
              return value || null;
            },
          },
          body: res,
        });
      }
    );

    const abort = () => req.destroy(new Error("aborted"));
    signal?.addEventListener("abort", abort, { once: true });
    req.on("error", reject);
    req.on("close", () => signal?.removeEventListener("abort", abort));
    req.end();
  });
}

function isRedirect(status) {
  return status >= 300 && status < 400;
}

function closeResponseBody(body) {
  if (!body) return;
  if (typeof body.destroy === "function") {
    body.destroy();
    return;
  }
  if (typeof body.cancel === "function") {
    body.cancel().catch(() => {});
  }
}

function isLowQualityTitle(title) {
  return Boolean(
    title &&
      /(?:^|\b)(?:400|401|403|404|429|500|502|503|504)\b|not found|access denied|forbidden|just a moment|attention required|page unavailable|error/i.test(
        title
      )
  );
}

function hostMatchesDomain(hostname, domains) {
  const normalized = String(hostname || "").replace(/^www\./i, "").toLowerCase();
  return domains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

function trustedMetadataImageUrl(raw, sourceUrl) {
  if (!raw) return null;
  let imageUrl;
  let sourceHostname;
  try {
    imageUrl = new URL(String(raw).trim(), sourceUrl);
    sourceHostname = new URL(sourceUrl).hostname;
  } catch {
    return null;
  }
  if (imageUrl.protocol !== "https:") return null;
  if (/placeholder|spacer|pixel|1x1|blank|icon-16/i.test(imageUrl.pathname)) return null;
  const trusted = TRUSTED_IMAGE_SOURCES.some(
    (entry) => hostMatchesDomain(sourceHostname, entry.sourceDomains) && hostMatchesDomain(imageUrl.hostname, entry.imageDomains)
  );
  return trusted ? imageUrl.toString() : null;
}

const KNOWN_DOMAIN_PROVIDERS = [
  { domains: AIRBNB_DOMAINS, provider: "Airbnb", kind: "vacation rental listing" },
  { domains: BOOKING_DOMAINS, provider: "Booking.com", kind: "accommodation listing" },
  { pattern: /(^|\.)vrbo\.[a-z.]{2,}$/i, provider: "Vrbo", kind: "vacation rental listing" },
  { pattern: /(^|\.)expedia\.[a-z.]{2,}$/i, provider: "Expedia", kind: "travel listing" },
  { pattern: /(^|\.)hotels\.[a-z.]{2,}$/i, provider: "Hotels.com", kind: "accommodation listing" },
  { pattern: /(^|\.)trivago\.[a-z.]{2,}$/i, provider: "Trivago", kind: "accommodation comparison" },
  { pattern: /(^|\.)kayak\.[a-z.]{2,}$/i, provider: "Kayak", kind: "travel search" },
  { pattern: /(^|\.)opentable\.[a-z.]{2,}$/i, provider: "OpenTable", kind: "restaurant reservation" },
  { pattern: /(^|\.)yelp\.[a-z.]{2,}$/i, provider: "Yelp", kind: "local business listing" },
  { pattern: /(^|\.)amazon\.[a-z.]{2,}$/i, provider: "Amazon", kind: "product listing" },
  { pattern: /(^|\.)ebay\.[a-z.]{2,}$/i, provider: "eBay", kind: "product listing" },
  { pattern: /(^|\.)etsy\.[a-z.]{2,}$/i, provider: "Etsy", kind: "product listing" },
];

// Known tracking / analytics query parameters stripped from share URLs.
const TRACKING_QUERY_PARAMS = new Set([
  "unique_share_id",
  "viralityEntryPoint",
  "s",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "ref",
  "source",
  "mc_cid",
  "mc_eid",
  "yclid",
  "igshid",
]);

/**
 * Remove common tracking / share-tracking parameters from a URL.
 * Returns the cleaned URL string (or the original if parsing fails).
 */
export function cleanTrackingUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    for (const param of TRACKING_QUERY_PARAMS) {
      url.searchParams.delete(param);
    }
    // If after deletion the search is empty, drop the "?" entirely.
    const cleaned = url.toString();
    // Restore trailing slash if original had one and cleaning removed it.
    return cleaned;
  } catch {
    return urlStr;
  }
}

/**
 * Extract structured data (JSON-LD) from HTML <script type="application/ld+json">.
 * Returns a flat array of parsed JSON objects (invalid blocks are silently skipped).
 */
export function extractStructuredData(html) {
  const results = [];
  const scriptPattern = /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptPattern.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1].trim());
      results.push(data);
    } catch {
      // Skip invalid JSON-LD blocks.
    }
  }
  return results;
}

/**
 * Extract a useful title from structured JSON-LD data relevant to travel/hosting.
 * Looks for @type "Product", "Hotel", "Accommodation", "LodgingBusiness", etc.
 * Returns the first matching name, or null.
 */
function structuredTitle(structured) {
  for (const entry of structured) {
    const graph = entry["@graph"] || [entry];
    for (const item of graph) {
      const type = item["@type"];
      if (typeof type === "string") {
        const lower = type.toLowerCase();
        if (
          lower.includes("product") ||
          lower.includes("hotel") ||
          lower.includes("lodging") ||
          lower.includes("accommodation") ||
          lower.includes("restaurant")
        ) {
          if (item.name) return cleanText(item.name, 200);
        }
      }
    }
  }
  return null;
}

/**
 * Extract a useful image from structured JSON-LD data.
 */
function structuredImage(structured) {
  for (const entry of structured) {
    const graph = entry["@graph"] || [entry];
    for (const item of graph) {
      if (item.image) {
        if (typeof item.image === "string") return item.image;
        if (item.image.url) return item.image.url;
        if (Array.isArray(item.image) && item.image.length > 0) {
          const first = item.image[0];
          if (typeof first === "string") return first;
          if (first.url) return first.url;
        }
      }
    }
  }
  return null;
}

/**
 * Deterministic domain-aware fallback: if OG extraction and JSON-LD both
 * yield nothing useful, produce honest structural context from the URL itself.
 * Never fakes price, availability, rating, or exact title.
 */
export function extractDomainFallback(urlStr) {
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    return null;
  }

  const hostname = url.hostname.replace(/^www\./, "").toLowerCase();

  for (const provider of KNOWN_DOMAIN_PROVIDERS) {
    const matches = provider.domains ? hostMatchesDomain(hostname, provider.domains) : provider.pattern.test(hostname);
    if (matches) {
      const result = {
        provider: provider.provider,
        sourceKind: provider.kind,
        listingId: null,
        canonicalUrl: null,
        facts: [],
      };

      // Airbnb: extract listing ID from /rooms/<id>
      if (provider.provider === "Airbnb") {
        const roomsMatch = url.pathname.match(/^\/rooms\/(\d+)/);
        if (roomsMatch) {
          result.listingId = roomsMatch[1];
          const canonicalUrl = new URL(cleanTrackingUrl(url.toString()));
          canonicalUrl.pathname = `/rooms/${roomsMatch[1]}`;
          canonicalUrl.hash = "";
          result.canonicalUrl = canonicalUrl.toString();
          result.facts.push("Price and availability must be checked on Airbnb");
        }
      }

      // Booking.com: extract hotel reference
      if (provider.provider === "Booking.com") {
        const hotelMatch = url.pathname.match(/\/hotel\/([a-z]+)\/([^/]+)/);
        if (hotelMatch) {
          result.listingId = hotelMatch[2];
          result.canonicalUrl = cleanTrackingUrl(url.toString());
          result.facts.push("Price and availability must be checked on Booking.com");
        }
      }

      return result;
    }
  }

  // No domain match — return null. The per-path fallback in titleFromUrl
  // handles generic path-based extraction; only provide domain-specific
  // context for recognized providers to avoid false positives.
  return null;
}

export async function readLimitedBody(body, options = {}) {
  const signal = options.signal;
  if (signal?.aborted) {
    closeResponseBody(body);
    throw new Error("aborted");
  }
  if (typeof body?.getReader === "function") return collectWebBody(body, signal);
  return collectAsyncBody(body, signal);
}

async function collectWebBody(body, signal) {
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  let abort;
  const abortPromise = signal
    ? new Promise((_, reject) => {
        abort = () => {
          reader.cancel().catch(() => {});
          reject(new Error("aborted"));
        };
        signal.addEventListener("abort", abort, { once: true });
      })
    : null;

  try {
    while (total < MAX_HEAD_BYTES) {
      if (signal?.aborted) throw new Error("aborted");
      const read = reader.read();
      const { done, value } = abortPromise ? await Promise.race([read, abortPromise]) : await read;
      if (done) break;
      const doneEarly = appendLimitedChunk(chunks, value, total);
      total = doneEarly.total;
      if (doneEarly.html) return doneEarly.html;
    }
  } finally {
    if (signal && abort) signal.removeEventListener("abort", abort);
    try {
      reader.releaseLock();
    } catch {
      // Ignore release failures on already-canceled readers.
    }
  }

  return htmlFromChunks(chunks);
}

async function collectAsyncBody(body, signal) {
  const chunks = [];
  let total = 0;
  const abort = () => closeResponseBody(body);
  signal?.addEventListener("abort", abort, { once: true });

  try {
    for await (const chunk of body) {
      if (signal?.aborted) throw new Error("aborted");
      const doneEarly = appendLimitedChunk(chunks, chunk, total);
      total = doneEarly.total;
      if (doneEarly.html) return doneEarly.html;
      if (total >= MAX_HEAD_BYTES) break;
    }
  } finally {
    signal?.removeEventListener("abort", abort);
  }

  return htmlFromChunks(chunks);
}

function appendLimitedChunk(chunks, chunk, total) {
  const buffer = Buffer.from(chunk);
  const remaining = MAX_HEAD_BYTES - total;
  if (remaining <= 0) return { total };
  const piece = buffer.subarray(0, remaining);
  chunks.push(piece);
  const nextTotal = total + piece.byteLength;
  const html = Buffer.concat(chunks).toString("utf8");
  const headEnd = html.toLowerCase().lastIndexOf("</head>");
  return {
    total: nextTotal,
    html: headEnd !== -1 ? html.slice(0, headEnd + 7) : "",
  };
}

function htmlFromChunks(chunks) {
  const html = Buffer.concat(chunks).toString("utf8");
  // Trim to </head> boundary if found — most useful metadata lives in <head>.
  const headEnd = html.toLowerCase().lastIndexOf("</head>");
  if (headEnd !== -1) {
    return html.slice(0, headEnd + 7);
  }
  return html;
}
