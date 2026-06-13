const AIRBNB_DOMAINS = [
  "airbnb.com",
  "airbnb.co.uk",
  "airbnb.de",
  "airbnb.fr",
  "airbnb.es",
  "airbnb.it",
  "airbnb.ca",
  "airbnb.com.au",
  "airbnb.at",
  "airbnb.ch",
  "airbnb.nl",
  "airbnb.pt",
];
const BOOKING_DOMAINS = ["booking.com"];

const TRACKING_PARAMS = new Set([
  "unique_share_id",
  "viralityEntryPoint",
  "s",
  "source_impression_id",
  "share_id",
]);

export function linkContextForUrl(urlStr) {
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    return null;
  }

  const hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
  if (hostMatchesDomain(hostname, AIRBNB_DOMAINS)) return airbnbContext(url);
  if (hostMatchesDomain(hostname, BOOKING_DOMAINS)) return bookingContext(url);
  return null;
}

function hostMatchesDomain(hostname, domains) {
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function airbnbContext(url) {
  const roomMatch = url.pathname.match(/\/rooms\/(\d+)/i);
  const listingId = roomMatch?.[1] || "";
  const cleanedUrl = cleanUrl(url);
  if (listingId) cleanedUrl.pathname = `/rooms/${listingId}`;
  const canonicalUrl = cleanedUrl.toString();
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
