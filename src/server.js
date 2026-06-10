import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { createServer } from "node:http";
import { createShortlist, deleteVote, getParticipation, getResults, getShortlist, hasVoterCompleted, migrate, recordVote, resolveTie, resolveVoterByToken } from "./db.js";
import { fetchMetadata } from "./metadata.js";

const ROOT = resolve(process.cwd());
const PUBLIC_DIR = resolve(ROOT, "public");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8092);

migrate();

// Phase 3: Simple in-memory rate limiter for public endpoints
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 60; // requests per minute per IP

function rateLimit(req) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, []);
  }

  const timestamps = rateLimitStore.get(ip).filter((t) => t > windowStart);
  timestamps.push(now);
  rateLimitStore.set(ip, timestamps);

  // Clean stale entries
  if (rateLimitStore.size > 10000) {
    for (const [key, vals] of rateLimitStore) {
      const filtered = vals.filter((t) => t > Date.now() - RATE_LIMIT_WINDOW_MS);
      if (filtered.length === 0) rateLimitStore.delete(key);
      else rateLimitStore.set(key, filtered);
    }
  }

  return timestamps.length <= RATE_LIMIT_MAX;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

    if (url.pathname === "/health") {
      return json(res, 200, { ok: true, service: "swipe-shortlist" });
    }

    if (req.method === "POST" && url.pathname === "/api/shortlists") {
      // Phase 3: Rate limit shortlist creation
      if (!rateLimit(req)) {
        return json(res, 429, { error: "Too many requests. Please wait before creating another shortlist." });
      }
      const body = await readJson(req);
      if (body.error) return json(res, 400, { error: body.error });
      const shortlist = createShortlist({
        title: body.title,
        participants: Array.isArray(body.participants) ? body.participants : [],
        deadlineLabel: body.deadlineLabel,
        deadline: body.deadline || null,
        links: body.links || [],
        cards: Array.isArray(body.cards) ? body.cards : null
      });
      return json(res, 201, shortlist);
    }

    const shortlistMatch = url.pathname.match(/^\/api\/shortlists\/([^/]+)$/);
    if (req.method === "GET" && shortlistMatch) {
      const shortlist = getShortlist(decodeURIComponent(shortlistMatch[1]));
      return shortlist ? json(res, 200, shortlist) : json(res, 404, { error: "Shortlist not found" });
    }

    // Phase 1: Resolve magic link token
    const resolveMatch = url.pathname.match(/^\/api\/shortlists\/([^/]+)\/resolve$/);
    if (req.method === "GET" && resolveMatch) {
      const code = decodeURIComponent(resolveMatch[1]);
      const token = url.searchParams.get("t") || "";
      const voter = resolveVoterByToken(code, token);
      if (!voter) return json(res, 404, { error: "Invalid or expired voting link" });
      return json(res, 200, voter);
    }

    // Phase 1: Get participation data (creator dashboard)
    const participationMatch = url.pathname.match(/^\/api\/shortlists\/([^/]+)\/participation$/);
    if (req.method === "GET" && participationMatch) {
      const code = decodeURIComponent(participationMatch[1]);
      const data = getParticipation(code);
      if (!data) return json(res, 404, { error: "Shortlist not found" });
      return json(res, 200, data);
    }

    // Phase 2: Resolve tie
    const tieMatch = url.pathname.match(/^\/api\/shortlists\/([^/]+)\/tie$/);
    if (req.method === "POST" && tieMatch) {
      const body = await readJson(req);
      if (body.error) return json(res, 400, { error: body.error });
      const code = decodeURIComponent(tieMatch[1]);
      const results = resolveTie(code, { tiebreaker: body.tiebreaker, winnerCardId: body.winnerCardId });
      if (!results) return json(res, 404, { error: "Shortlist not found" });
      return json(res, 200, results);
    }

    const voteMatch = url.pathname.match(/^\/api\/shortlists\/([^/]+)\/votes$/);
    if (req.method === "POST" && voteMatch) {
      const body = await readJson(req);
      if (body.error) return json(res, 400, { error: body.error });
      if (!["yes", "no", "hold", "strong_yes", "abstain"].includes(body.vote)) {
        return json(res, 400, { error: "Invalid vote" });
      }
      const code = decodeURIComponent(voteMatch[1]);
      const voter = {
        voterKey: body.voterKey,
        voterName: body.voterName || "Guest"
      };
      const results = recordVote({
        code,
        cardId: Number(body.cardId),
        ...voter,
        vote: body.vote
      });
      return results ? json(res, 200, voteResponsePayload(code, voter)) : json(res, 404, { error: "Shortlist not found" });
    }

    if (req.method === "DELETE" && voteMatch) {
      const body = await readJson(req);
      if (body.error) return json(res, 400, { error: body.error });
      const code = decodeURIComponent(voteMatch[1]);
      const voter = {
        voterKey: body.voterKey,
        voterName: body.voterName || "Guest"
      };
      const results = deleteVote({
        code,
        cardId: Number(body.cardId),
        ...voter
      });
      return results ? json(res, 200, voteResponsePayload(code, voter)) : json(res, 404, { error: "Shortlist not found" });
    }

    const resultMatch = url.pathname.match(/^\/api\/shortlists\/([^/]+)\/results$/);
    if (req.method === "GET" && resultMatch) {
      const code = decodeURIComponent(resultMatch[1]);

      // Phase 3: Public results endpoint — no voter identity needed
      const isPublic = url.searchParams.get("public") === "1";
      if (isPublic) {
        const results = getResults(code, { isPublic: true });
        return results ? json(res, 200, results) : json(res, 404, { error: "Shortlist not found" });
      }

      const voterKey = url.searchParams.get("voterKey") || "";
      const voterName = url.searchParams.get("voterName") || "";
      if (!hasVoterCompleted(code, { voterKey, voterName })) {
        return json(res, 200, { locked: true, error: "Finish voting before results" });
      }
      const results = getResults(code);
      return results ? json(res, 200, results) : json(res, 404, { error: "Shortlist not found" });
    }

    // Phase 3: Public results page — redirect to SPA with public mode
    const publicResultsMatch = url.pathname.match(/^\/r\/([^/]+)$/);
    if (req.method === "GET" && publicResultsMatch) {
      const code = decodeURIComponent(publicResultsMatch[1]);
      // Check if shortlist exists
      const shortlist = getShortlist(code);
      if (!shortlist) return json(res, 404, { error: "Shortlist not found" });
      // Redirect to SPA public results page
      res.writeHead(302, { Location: `/#/public/${encodeURIComponent(code)}` });
      return res.end();
    }

    if (req.method === "POST" && url.pathname === "/api/metadata") {
      const body = await readJson(req);
      if (body.error) return json(res, 400, { error: body.error });
      const rawUrls = Array.isArray(body.urls) ? body.urls.slice(0, 20) : [];
      const results = await Promise.allSettled(rawUrls.map((u) => fetchMetadata(String(u))));
      const metadata = results
        .filter((r) => r.status === "fulfilled" && r.value !== null)
        .map((r) => r.value);
      return json(res, 200, { metadata });
    }

    if (req.method === "GET" || req.method === "HEAD") {
      return serveStatic(url.pathname, res, req.method === "HEAD");
    }

    json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    if (
      error.message === "Unknown voter" ||
      error.message === "Unknown card" ||
      error.message === "Paste at least one valid http or https link." ||
      error.message === "Each card needs a valid http or https source URL." ||
      error.message === "Voting is closed — this decision has been finalized." ||
      error.message === "Invalid tiebreaker type" ||
      error.message === "No cards found"
    ) {
      return json(res, 400, { error: error.message });
    }
    console.error(error);
    json(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SwipeShortlist listening on http://${HOST}:${PORT}`);
});

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...securityHeaders()
  });
  res.end(body);
}

function voteResponsePayload(code, voter) {
  if (hasVoterCompleted(code, voter)) {
    return getResults(code);
  }

  const shortlist = getShortlist(code);
  return shortlist
    ? { locked: true, error: "Finish voting before results", shortlist }
    : null;
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 64 * 1024) return { error: "Request body too large" };
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return { error: "Invalid JSON" };
  }
}

function serveStatic(pathname, res, headOnly = false) {
  const safePath = pathname === "/" ? "/index.html" : pathname === "/favicon.ico" ? "/assets/link-card.svg" : pathname;
  const normalized = normalize(decodeURIComponent(safePath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(PUBLIC_DIR, normalized));

  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", ...securityHeaders() });
    return res.end("Not found");
  }

  res.writeHead(200, {
    "content-type": contentType(filePath),
    "cache-control": shouldCacheAsset(filePath) ? "public, max-age=86400" : "no-store",
    ...securityHeaders()
  });
  if (headOnly) return res.end();
  createReadStream(filePath).pipe(res);
}

function shouldCacheAsset(filePath) {
  return !filePath.endsWith("index.html") && !filePath.endsWith(".js") && !filePath.endsWith(".css");
}

function securityHeaders() {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()"
  };
}

function contentType(filePath) {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

// Metadata enrichment imported from ./metadata.js (SSRF-safe fetch + HTML parsing)
