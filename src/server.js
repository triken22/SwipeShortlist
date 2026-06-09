import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { createServer } from "node:http";
import { createShortlist, deleteVote, getResults, getShortlist, hasVoterCompleted, migrate, recordVote } from "./db.js";

const ROOT = resolve(process.cwd());
const PUBLIC_DIR = resolve(ROOT, "public");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8092);

migrate();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

    if (url.pathname === "/health") {
      return json(res, 200, { ok: true, service: "swipe-shortlist" });
    }

    if (req.method === "POST" && url.pathname === "/api/shortlists") {
      const body = await readJson(req);
      if (body.error) return json(res, 400, { error: body.error });
      const shortlist = createShortlist({
        title: body.title,
        participants: Array.isArray(body.participants) ? body.participants : [],
        deadlineLabel: body.deadlineLabel,
        links: body.links || []
      });
      return json(res, 201, shortlist);
    }

    const shortlistMatch = url.pathname.match(/^\/api\/shortlists\/([^/]+)$/);
    if (req.method === "GET" && shortlistMatch) {
      const shortlist = getShortlist(decodeURIComponent(shortlistMatch[1]));
      return shortlist ? json(res, 200, shortlist) : json(res, 404, { error: "Shortlist not found" });
    }

    const voteMatch = url.pathname.match(/^\/api\/shortlists\/([^/]+)\/votes$/);
    if (req.method === "POST" && voteMatch) {
      const body = await readJson(req);
      if (body.error) return json(res, 400, { error: body.error });
      if (!["yes", "no", "hold", "strong_yes"].includes(body.vote)) {
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
      const voterKey = url.searchParams.get("voterKey") || "";
      const voterName = url.searchParams.get("voterName") || "";
      if (!hasVoterCompleted(code, { voterKey, voterName })) {
        return json(res, 200, { locked: true, error: "Finish voting before results" });
      }
      const results = getResults(code);
      return results ? json(res, 200, results) : json(res, 404, { error: "Shortlist not found" });
    }

    if (req.method === "GET" || req.method === "HEAD") {
      return serveStatic(url.pathname, res, req.method === "HEAD");
    }

    json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    if (
      error.message === "Unknown voter" ||
      error.message === "Unknown card" ||
      error.message === "Paste at least one valid http or https link."
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
  const safePath = pathname === "/" ? "/index.html" : pathname;
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
