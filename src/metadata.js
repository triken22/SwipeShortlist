import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

const FETCH_TIMEOUT_MS = 4000;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_REDIRECTS = 3;

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
  let currentUrl = urlStr;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const target = useInjectedFetch ? null : await safeUrlTarget(currentUrl);
    if (useInjectedFetch) {
      if (!(await safeUrl(currentUrl))) return null;
    } else if (!target) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
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
      return null;
    } finally {
      clearTimeout(timeout);
    }

    if (isRedirect(response.status)) {
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

    if (response.status >= 400) return null;

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) return null;
    if (!response.body) return null;

    const html = await readLimitedBody(response.body);
    const meta = extractMetadata(html);

    let title = meta.ogTitle || meta.title || null;
    const description = meta.ogDescription || meta.description || null;
    const siteName = meta.siteName || null;
    if (isLowQualityTitle(title)) title = null;

    if (!title && !description && !siteName) {
      return null;
    }

    return {
      url: urlStr,
      title,
      description,
      siteName,
      ogImage: meta.ogImage || null,
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

function isLowQualityTitle(title) {
  return Boolean(
    title &&
      /(?:^|\b)(?:400|401|403|404|429|500|502|503|504)\b|not found|access denied|forbidden|just a moment|attention required|page unavailable|error/i.test(
        title
      )
  );
}

async function readLimitedBody(body) {
  const chunks = [];
  let total = 0;
  for await (const chunk of body) {
    const buffer = Buffer.from(chunk);
    const remaining = MAX_METADATA_BYTES - total;
    if (remaining <= 0) break;
    chunks.push(buffer.subarray(0, remaining));
    total += Math.min(buffer.byteLength, remaining);
    if (total >= MAX_METADATA_BYTES) break;
  }
  return Buffer.concat(chunks).toString("utf8");
}
