const AIRBNB_HOST_RE = /(^|\.)airbnb\.[a-z.]+$/i;
const BOOKING_HOST_RE = /(^|\.)booking\.com$/i;

const TRACKING_PARAMS = new Set([
  "unique_share_id",
  "viralityEntryPoint",
  "s",
  "source_impression_id",
  "share_id",
  "check_in",
  "check_out",
  "adults",
  "children",
  "infants",
  "pets",
  "guests",
  "locale",
  "currency",
]);

export function linkContextForUrl(urlStr) {
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    return null;
  }

  const hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
  if (AIRBNB_HOST_RE.test(hostname)) return airbnbContext(url);
  if (BOOKING_HOST_RE.test(hostname)) return bookingContext(url);
  return null;
}

function airbnbContext(url) {
  const roomMatch = url.pathname.match(/\/rooms\/(\d+)/i);
  const listingId = roomMatch?.[1] || "";
  const canonicalUrl = listingId ? `${url.origin}/rooms/${listingId}` : cleanUrl(url).toString();
  const facts = ["Airbnb listing", "Price and availability must be checked on Airbnb"];
  if (listingId) facts.splice(1, 0, `Listing ID ${listingId}`);

  return {
    providerName: "Airbnb",
    kind: "stay",
    title: "Airbnb stay",
    location: "Airbnb",
    canonicalUrl,
    facts,
    trustLabel: "Airbnb link context from URL · verify price and availability",
  };
}

function bookingContext(url) {
  const hotelMatch = url.pathname.match(/\/hotel\/[^/]+\/([^/?#]+?)(?:\.html)?$/i);
  const listingSlug = hotelMatch?.[1] || "";
  const title = listingSlug ? titleFromSlug(listingSlug) : "Booking.com stay";
  const canonicalUrl = cleanUrl(url).toString();
  const facts = ["Booking.com listing", "Price and availability must be checked on Booking.com"];

  return {
    providerName: "Booking.com",
    kind: "stay",
    title,
    location: "Booking.com",
    canonicalUrl,
    facts,
    trustLabel: "Booking.com link context from URL · verify price and availability",
  };
}

function cleanUrl(url) {
  const cleaned = new URL(url.toString());
  for (const param of [...cleaned.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(param) || param.startsWith("utm_")) {
      cleaned.searchParams.delete(param);
    }
  }
  cleaned.hash = "";
  return cleaned;
}

function titleFromSlug(slug) {
  return slug
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .slice(0, 72);
}
