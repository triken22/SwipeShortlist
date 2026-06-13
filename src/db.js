import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomInt, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { linkContextForUrl } from "../public/link-context.js";

const DATA_DIR = resolve(process.env.SWIPE_DATA_DIR || "./data");
const DB_PATH = resolve(process.env.SWIPE_DB_PATH || `${DATA_DIR}/swipe-shortlist.sqlite`);

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA journal_mode = WAL");

const DEFAULT_CARD_IMAGE = "/assets/link-card.svg";
const RETIRED_IMAGE_PATHS = new Set(["/assets/mare-blu.png", "/assets/beach-thumb.png", "/assets/mare-thumb.png"]);
const DEFAULT_TITLE = "Private shortlist";
const DEFAULT_DEADLINE_LABEL = "Aim to decide today";
const MAX_LINKS = 50;
const AIRBNB_DOMAINS = ["airbnb.com", "airbnb.co.uk", "airbnb.de", "airbnb.fr", "airbnb.es", "airbnb.it", "airbnb.ca", "airbnb.com.au"];
const BOOKING_DOMAINS = ["booking.com"];
const TRUSTED_IMAGE_SOURCES = [
  { sourceDomains: AIRBNB_DOMAINS, imageDomains: ["muscache.com", "airbnb.com"] },
  { sourceDomains: BOOKING_DOMAINS, imageDomains: ["bstatic.com", "booking.com"] },
];

function cleanImageUrl(raw, sourceUrl = "") {
  if (!raw || typeof raw !== "string") return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return null;
    if (/placeholder|spacer|pixel|1x1|blank|icon-16/i.test(url.pathname)) return null;
    if (!sourceUrl || isTrustedImageForSource(url.hostname, sourceUrl)) return url.toString();
    return null;
  } catch {
    return null;
  }
}

function hostMatchesDomain(hostname, domains) {
  const normalized = String(hostname || "").replace(/^www\./i, "").toLowerCase();
  return domains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

function isTrustedImageForSource(imageHostname, sourceUrl) {
  let sourceHostname;
  try {
    sourceHostname = new URL(sourceUrl).hostname;
  } catch {
    return false;
  }
  return TRUSTED_IMAGE_SOURCES.some(
    (entry) => hostMatchesDomain(sourceHostname, entry.sourceDomains) && hostMatchesDomain(imageHostname, entry.imageDomains)
  );
}
const GENERIC_URL_PATH_PARTS = new Set([
  "accommodation",
  "accommodations",
  "detail",
  "details",
  "hotel",
  "hotels",
  "listing",
  "listings",
  "property",
  "properties",
  "room",
  "rooms",
  "stay",
  "stays",
]);

// Known travel/product domain patterns for better fallback titles.
const KNOWN_DOMAIN_FALLBACKS = [
  { domains: AIRBNB_DOMAINS, title: "Airbnb stay" },
  { domains: BOOKING_DOMAINS, title: "Booking.com accommodation" },
  { pattern: /(^|\.)vrbo\.[a-z.]{2,}$/, title: "Vrbo rental" },
  { pattern: /(^|\.)expedia\.[a-z.]{2,}$/, title: "Expedia listing" },
  { pattern: /(^|\.)hotels\.[a-z.]{2,}$/, title: "Hotels.com accommodation" },
  { pattern: /(^|\.)opentable\.[a-z.]{2,}$/, title: "OpenTable restaurant" },
  { pattern: /(^|\.)yelp\.[a-z.]{2,}$/, title: "Yelp listing" },
  { pattern: /(^|\.)amazon\.[a-z.]{2,}$/, title: "Amazon product" },
  { pattern: /(^|\.)ebay\.[a-z.]{2,}$/, title: "eBay listing" },
  { pattern: /(^|\.)etsy\.[a-z.]{2,}$/, title: "Etsy product" },
];

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shortlists (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      deadline_label TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY,
      shortlist_id INTEGER NOT NULL REFERENCES shortlists(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      source_domain TEXT NOT NULL,
      source_url TEXT NOT NULL,
      location TEXT NOT NULL,
      price_label TEXT NOT NULL,
      facts_json TEXT NOT NULL,
      trust_label TEXT NOT NULL,
      image_path TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS voters (
      id INTEGER PRIMARY KEY,
      shortlist_id INTEGER NOT NULL REFERENCES shortlists(id) ON DELETE CASCADE,
      voter_key TEXT,
      name TEXT NOT NULL,
      initials TEXT NOT NULL,
      is_owner INTEGER NOT NULL DEFAULT 0,
      UNIQUE(shortlist_id, name)
    );

    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY,
      shortlist_id INTEGER NOT NULL REFERENCES shortlists(id) ON DELETE CASCADE,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      voter_id INTEGER NOT NULL REFERENCES voters(id) ON DELETE CASCADE,
      vote TEXT NOT NULL CHECK (vote IN ('yes', 'no', 'hold', 'strong_yes')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(card_id, voter_id)
    );
  `);

  ensureColumn("voters", "voter_key", "TEXT");
  db.exec(`
    UPDATE voters
    SET voter_key = 'legacy-' || id
    WHERE voter_key IS NULL OR voter_key = '';

    CREATE UNIQUE INDEX IF NOT EXISTS voters_shortlist_key_idx
    ON voters(shortlist_id, voter_key)
    WHERE voter_key IS NOT NULL;
  `);

  // Phase 1: voter_token for magic link identity
  ensureColumn("voters", "voter_token", "TEXT");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS voters_shortlist_token_idx
    ON voters(shortlist_id, voter_token)
    WHERE voter_token IS NOT NULL;
  `);

  // Phase 1: deadline and finalization for shortlists
  ensureColumn("shortlists", "deadline", "TEXT");
  ensureColumn("shortlists", "finalized", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("shortlists", "finalized_at", "TEXT");

  // Phase 2: tiebreaker columns
  ensureColumn("shortlists", "tiebreaker", "TEXT");
  ensureColumn("shortlists", "tiebreaker_winner_card_id", "INTEGER");

  // Phase 2: universal decisions
  ensureColumn("cards", "description", "TEXT");
  ensureColumn("cards", "image_url", "TEXT");

  // Phase 2: Extend votes CHECK constraint to include 'abstain'
  try {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("INSERT INTO votes (shortlist_id, card_id, voter_id, vote) VALUES (0, 0, 0, 'abstain')");
    db.exec("DELETE FROM votes WHERE voter_id = 0");
    db.exec("PRAGMA foreign_keys = ON");
  } catch {
    // Constraint missing — recreate votes table with extended check
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`
      DROP TABLE IF EXISTS votes_new;
      CREATE TABLE votes_new (
        id INTEGER PRIMARY KEY,
        shortlist_id INTEGER NOT NULL REFERENCES shortlists(id) ON DELETE CASCADE,
        card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        voter_id INTEGER NOT NULL REFERENCES voters(id) ON DELETE CASCADE,
        vote TEXT NOT NULL CHECK (vote IN ('yes', 'no', 'hold', 'strong_yes', 'abstain')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(card_id, voter_id)
      );
      INSERT INTO votes_new SELECT * FROM votes;
      DROP TABLE votes;
      ALTER TABLE votes_new RENAME TO votes;
    `);
    db.exec("PRAGMA foreign_keys = ON");
  }

  // Phase 3: Auto-cleanup shortlists older than 90 days (best-effort)
  try {
    db.exec("DELETE FROM shortlists WHERE created_at < datetime('now', '-90 days')");
  } catch {
    // no-op
  }
}

export function createShortlist({ title = DEFAULT_TITLE, participants = [], deadlineLabel = DEFAULT_DEADLINE_LABEL, deadline = null, links = [], cards = null } = {}) {
  const code = nextCode();
  let cardsToCreate;
  if (Array.isArray(cards)) {
    if (cards.length === 0) {
      throw new Error("Each card needs a valid http or https source URL.");
    }
    cardsToCreate = cardsFromDraftCards(cards);
    if (!cardsToCreate.length) {
      throw new Error("Each card needs a valid http or https source URL.");
    }
  } else {
    const normalizedLinks = normalizeLinks(links);
    cardsToCreate = cardsFromLinks(normalizedLinks);
    if (!cardsToCreate.length) {
      throw new Error("Paste at least one valid http or https link.");
    }
  }

  const participantNames = normalizeParticipants(participants);
  const cleanDeadlineVal = deadline && typeof deadline === "string" ? deadline.trim() : null;

  const insertShortlist = db.prepare("INSERT INTO shortlists (code, title, deadline_label, deadline) VALUES (?, ?, ?, ?)");
  const insertCard = db.prepare(`
    INSERT INTO cards (
      shortlist_id, title, source_domain, source_url, description, image_url,
      location, price_label, facts_json, trust_label, image_path, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertVoter = db.prepare("INSERT INTO voters (shortlist_id, voter_key, voter_token, name, initials, is_owner) VALUES (?, ?, ?, ?, ?, ?)");

  const baseUrl = process.env.SHORTLIST_BASE_URL || `http://localhost:${process.env.PORT || 8092}`;

  db.exec("BEGIN");
  try {
    const shortlistResult = insertShortlist.run(code, cleanTitle(title), cleanDeadline(deadlineLabel), cleanDeadlineVal);
    const shortlistId = Number(shortlistResult.lastInsertRowid);
    cardsToCreate.forEach((card, index) => {
      insertCard.run(
        shortlistId,
        card.title,
        card.sourceDomain,
        card.sourceUrl,
        card.description || null,
        card.imageUrl || null,
        card.location,
        card.priceLabel,
        JSON.stringify(card.facts),
        card.trustLabel,
        card.imagePath,
        index + 1
      );
    });

    const magicLinks = {};
    participantNames.forEach((name, index) => {
      const voterToken = generateVoterToken();
      const voterKey = `magic-${index + 1}-${slugFor(name)}`;
      insertVoter.run(shortlistId, voterKey, voterToken, name, initialsFor(name), index === 0 ? 1 : 0);
      magicLinks[name] = `${baseUrl}/#/vote/${code}?t=${voterToken}`;
    });

    db.exec("COMMIT");
    const shortlist = getShortlist(code, { includeVotes: false });
    return { ...shortlist, magicLinks };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getShortlist(code, { includeVotes = false } = {}) {
  const shortlist = db.prepare("SELECT * FROM shortlists WHERE code = ?").get(code);
  if (!shortlist) return null;

  const cards = db.prepare("SELECT * FROM cards WHERE shortlist_id = ? ORDER BY sort_order").all(shortlist.id).map(cardFromRow);
  const voters = includeVotes ? db.prepare("SELECT * FROM voters WHERE shortlist_id = ? ORDER BY id").all(shortlist.id).map(voterFromRow) : [];
  const votes = includeVotes ? getVotes(shortlist.id) : [];
  const votedCount = db
    .prepare("SELECT COUNT(DISTINCT voter_id) AS count FROM votes WHERE shortlist_id = ?")
    .get(shortlist.id).count;
  const completedVoterCount = cards.length
    ? db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM (
            SELECT voter_id
            FROM votes
            WHERE shortlist_id = ?
            GROUP BY voter_id
            HAVING COUNT(DISTINCT card_id) >= ?
          )
        `)
        .get(shortlist.id, cards.length).count
    : 0;

  // Phase 1: lazy auto-finalize check
  if (!shortlist.finalized && shortlist.deadline && new Date(shortlist.deadline) <= new Date()) {
    finalizeShortlist(shortlist.id);
    shortlist.finalized = 1;
    shortlist.finalized_at = new Date().toISOString();
  }

  return {
    id: shortlist.id,
    code: shortlist.code,
    title: shortlist.title,
    deadlineLabel: shortlist.deadline_label,
    deadline: shortlist.deadline || null,
    finalized: Boolean(shortlist.finalized),
    finalizedAt: shortlist.finalized_at || null,
    cards,
    voters,
    votedCount,
    completedVoterCount,
    votes,
    participation: includeVotes ? getParticipationData(shortlist.id, cards.length) : null
  };
}

export function recordVote({ code, cardId, voterKey, voterName = "Guest", vote }) {
  const shortlist = db.prepare("SELECT * FROM shortlists WHERE code = ?").get(code);
  if (!shortlist) return null;

  // Phase 1: Cannot vote after finalization
  if (shortlist.finalized) throw new Error("Voting is closed — this decision has been finalized.");

  const voter = ensureVoter(shortlist.id, { voterKey, voterName });

  const card = db.prepare("SELECT * FROM cards WHERE shortlist_id = ? AND id = ?").get(shortlist.id, cardId);
  if (!card) throw new Error("Unknown card");

  db.prepare(`
    INSERT INTO votes (shortlist_id, card_id, voter_id, vote)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(card_id, voter_id) DO UPDATE SET vote = excluded.vote, updated_at = CURRENT_TIMESTAMP
  `).run(shortlist.id, cardId, voter.id, vote);

  return getResults(code);
}

export function deleteVote({ code, cardId, voterKey, voterName = "Guest" }) {
  const shortlist = db.prepare("SELECT * FROM shortlists WHERE code = ?").get(code);
  if (!shortlist) return null;

  // Phase 1: Cannot undo after finalization
  if (shortlist.finalized) throw new Error("Voting is closed — this decision has been finalized.");

  const voter = findVoter(shortlist.id, { voterKey, voterName });
  if (!voter) throw new Error("Unknown voter");

  const card = db.prepare("SELECT * FROM cards WHERE shortlist_id = ? AND id = ?").get(shortlist.id, cardId);
  if (!card) throw new Error("Unknown card");

  db.prepare("DELETE FROM votes WHERE shortlist_id = ? AND card_id = ? AND voter_id = ?").run(shortlist.id, cardId, voter.id);
  return getResults(code);
}

export function hasVoterVoted(code, voter = {}) {
  const shortlist = db.prepare("SELECT id FROM shortlists WHERE code = ?").get(code);
  if (!shortlist) return false;
  const existing = findVoter(shortlist.id, normalizeVoterInput(voter));
  if (!existing) return false;
  const row = db.prepare("SELECT COUNT(*) AS count FROM votes WHERE shortlist_id = ? AND voter_id = ?").get(shortlist.id, existing.id);
  return Number(row?.count || 0) > 0;
}

export function hasVoterCompleted(code, voter = {}) {
  const shortlist = db.prepare("SELECT id FROM shortlists WHERE code = ?").get(code);
  if (!shortlist) return false;
  const existing = findVoter(shortlist.id, normalizeVoterInput(voter));
  if (!existing) return false;

  // Phase 1: Check if shortlist is finalized — if so, no completion check needed
  if (shortlist.finalized) return true;

  const cardCount = Number(db.prepare("SELECT COUNT(*) AS count FROM cards WHERE shortlist_id = ?").get(shortlist.id)?.count || 0);
  if (!cardCount) return false;

  const voteCount = Number(
    db.prepare("SELECT COUNT(DISTINCT card_id) AS count FROM votes WHERE shortlist_id = ? AND voter_id = ?").get(shortlist.id, existing.id)
      ?.count || 0
  );
  return voteCount >= cardCount;
}

export function getResults(code, { isPublic = false } = {}) {
  // Always load votes for scoring — strip voter identities from response for public
  const shortlist = getShortlist(code, { includeVotes: true });
  if (!shortlist) return null;

  const votersById = new Map(shortlist.voters.map((voter) => [voter.id, voter]));
  const votesByCard = new Map();
  (shortlist.votes || []).forEach((vote) => {
    const group = votesByCard.get(vote.cardId) || [];
    // For public results, don't attach voter object to votes
    group.push(isPublic ? { vote: vote.vote, cardId: vote.cardId } : { ...vote, voter: votersById.get(vote.voterId) });
    votesByCard.set(vote.cardId, group);
  });

  const rankedCards = shortlist.cards
    .map((card) => {
      const cardVotes = votesByCard.get(card.id) || [];
      const yesCount = cardVotes.filter((vote) => vote.vote === "yes" || vote.vote === "strong_yes").length;
      const strongYesCount = cardVotes.filter((vote) => vote.vote === "strong_yes").length;
      const holdCount = cardVotes.filter((vote) => vote.vote === "hold").length;
      const noCount = cardVotes.filter((vote) => vote.vote === "no").length;
      const abstainCount = cardVotes.filter((vote) => vote.vote === "abstain").length;
      return {
        ...card,
        votes: isPublic ? [] : cardVotes,
        yesCount,
        strongYesCount,
        holdCount,
        noCount,
        abstainCount,
        score: yesCount * 2 + strongYesCount + holdCount - noCount * 3
      };
    })
    .sort((a, b) => b.score - a.score || a.sortOrder - b.sortOrder);

  const winner = rankedCards[0] || null;
  const runnerUp = rankedCards[1] || null;

  // Detect ties
  const ties = [];
  if (winner && runnerUp && winner.score === runnerUp.score) {
    for (let i = 0; i < rankedCards.length; i++) {
      if (rankedCards[i].score === rankedCards[0].score) {
        ties.push({ card: rankedCards[i], score: rankedCards[i].score });
      } else {
        break;
      }
    }
  }

  // Load tiebreaker info
  const shortlistRow = db.prepare("SELECT tiebreaker, tiebreaker_winner_card_id FROM shortlists WHERE id = ?").get(shortlist.id);
  const tiebreaker = shortlistRow?.tiebreaker || null;
  const tiebreakerWinnerCardId = shortlistRow?.tiebreaker_winner_card_id || null;

  // If tiebreaker resolved, re-rank with winner first
  let finalWinner = winner;
  if (tiebreakerWinnerCardId) {
    const tieWinCard = rankedCards.find((c) => c.id === tiebreakerWinnerCardId);
    if (tieWinCard) {
      finalWinner = tieWinCard;
      // Re-sort with tiebreaker winner first among ties
      rankedCards.sort((a, b) => {
        if (a.id === tiebreakerWinnerCardId) return -1;
        if (b.id === tiebreakerWinnerCardId) return 1;
        return b.score - a.score || a.sortOrder - b.sortOrder;
      });
    }
  }

  const rationale = finalWinner ? getWinnerRationale(rankedCards, shortlist, tiebreaker) : null;
  return {
    shortlist,
    winner: finalWinner,
    backups: rankedCards.slice(1, 3),
    rationale,
    ties: ties.length > 0 ? ties : undefined,
    tiebreaker: tiebreaker || undefined,
    tiebreakerWinnerCardId: tiebreakerWinnerCardId || undefined
  };
}

// Phase 2: Resolve a tie by setting the tiebreaker
export function resolveTie(code, { tiebreaker, winnerCardId }) {
  if (!["creator_pick", "first_wins"].includes(tiebreaker)) throw new Error("Invalid tiebreaker type");
  const shortlist = db.prepare("SELECT id FROM shortlists WHERE code = ?").get(code);
  if (!shortlist) return null;

  if (tiebreaker === "first_wins") {
    const firstTied = db
      .prepare("SELECT id FROM cards WHERE shortlist_id = ? ORDER BY sort_order LIMIT 1")
      .get(shortlist.id);
    if (!firstTied) throw new Error("No cards found");
    db.prepare("UPDATE shortlists SET tiebreaker = ?, tiebreaker_winner_card_id = ? WHERE id = ?")
      .run(tiebreaker, firstTied.id, shortlist.id);
  } else if (tiebreaker === "creator_pick" && winnerCardId) {
    db.prepare("UPDATE shortlists SET tiebreaker = ?, tiebreaker_winner_card_id = ? WHERE id = ?")
      .run(tiebreaker, winnerCardId, shortlist.id);
  }

  return getResults(code);
}

function getWinnerRationale(rankedCards, shortlist, tiebreaker = null) {
  if (!rankedCards.length) return null;
  const winner = rankedCards[0];
  const runnerUp = rankedCards[1];

  const totalVoters = shortlist.completedVoterCount || shortlist.voters.length || 1;
  const winnerVoterCount = winner.votes?.length || totalVoters;
  const vetoThreshold = Math.ceil(winnerVoterCount / 2);
  const hasVeto = winner.noCount >= vetoThreshold && winner.noCount > 0;
  // If a tiebreaker was resolved, the tie should not be reported as pending
  const tied = !tiebreaker && runnerUp && winner.score === runnerUp.score;
  const isContested = winner.noCount > winner.yesCount;

  let summary, detail;
  if (tied && runnerUp) {
    summary = "split";
    detail = `Tied between "${winner.title}" and "${runnerUp.title}" — needs group discussion`;
  } else if (hasVeto) {
    summary = "vetoed";
    detail = `"${winner.title}" received ${winner.noCount} No — ${winner.noCount >= winnerVoterCount ? "everyone" : "half of"} the group objects`;
  } else if (isContested) {
    summary = "contested";
    detail = `"${winner.title}" has more No votes than positive votes — consider the backup options`;
  } else {
    const posCount = winner.yesCount;
    summary = "clear";
    detail = posCount > 0
      ? `"${winner.title}" received ${posCount} positive vote${posCount !== 1 ? "s" : ""} and no strong objections`
      : `"${winner.title}" had the weakest objections — no strong No signals`;
  }

  // If tiebreaker resolved, update summary and detail
  const resolvedSummary = tiebreaker ? "clear" : summary;
  const resolvedDetail = tiebreaker
    ? `"${winner.title}" won after breaking the tie`
    : detail;

  return {
    summary: resolvedSummary,
    detail: resolvedDetail,
    noCount: winner.noCount,
    yesCount: winner.yesCount,
    holdCount: winner.holdCount,
    hasBackup: !!runnerUp,
    backupTitle: runnerUp?.title || null,
    backupUrl: runnerUp?.sourceUrl || null,
    tied: tied && !!runnerUp,
    tiebreakerResolved: !!tiebreaker,
    copyText: getCopyText(winner, runnerUp, resolvedSummary)
  };
}

function getCopyText(winner, runnerUp, summary) {
  let text = `Final pick: ${winner.title}\n${winner.sourceUrl}`;
  if (runnerUp && summary !== "split") {
    text += `\n\nBackup: ${runnerUp.title}\n${runnerUp.sourceUrl}`;
  } else if (summary === "split") {
    text += `\n\n(Tied with ${runnerUp.title} — ${runnerUp.sourceUrl})`;
  }
  text += `\n\nDecided with SwipeShortlist`;
  return text;
}

export function getWinnerRationalePublic(rankedCards, shortlist, tiebreaker = null) {
  return getWinnerRationale(rankedCards, shortlist, tiebreaker);
}

function nextCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = `FAMILY-${randomInt(100000, 1000000)}`;
    const existing = db.prepare("SELECT code FROM shortlists WHERE code = ?").get(code);
    if (!existing) return code;
  }
  return `FAMILY-${Date.now().toString(36).toUpperCase()}`;
}

function normalizeLinks(links) {
  const rawLinks = Array.isArray(links)
    ? links
    : String(links || "")
        .split(/\s+/)
        .filter(Boolean);

  return Array.from(
    new Set(
      rawLinks
        .map((link) => String(link || "").trim().replace(/[),.;]+$/g, ""))
        .filter(Boolean)
    )
  ).slice(0, MAX_LINKS);
}

function cardsFromLinks(links) {
  return links
    .map((link, index) => {
      try {
        const url = new URL(link);
        if (!["http:", "https:"].includes(url.protocol)) return null;
        const domain = url.hostname.replace(/^www\./, "");
        const linkContext = linkContextForUrl(url.toString());
        const facts = linkContext?.facts || ["Imported link", "One-tap vote", "Needs check"];
        return {
          title: linkContext?.title || titleFromUrl(url),
          sourceDomain: domain,
          sourceUrl: linkContext?.canonicalUrl || url.toString(),
          location: linkContext?.location || domain,
          priceLabel: "Price to verify",
          facts,
          trustLabel: linkContext?.trustLabel || "Imported from pasted link · verify details before deciding",
          imagePath: DEFAULT_CARD_IMAGE
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function cardsFromDraftCards(draftCards) {
  return draftCards
    .slice(0, MAX_LINKS)
    .map((card) => {
      // Support both link-based and manual cards
      let title = String(card.title || "").trim();

      let sourceUrl = "";
      let sourceDomain = "";
      let linkContext = null;

      if (card.sourceUrl && !card.sourceUrl.startsWith("manual-")) {
        try {
          const url = new URL(card.sourceUrl);
          if (!["http:", "https:"].includes(url.protocol)) return null;
          sourceUrl = url.toString();
          sourceDomain = url.hostname.replace(/^www\./, "");
          linkContext = linkContextForUrl(sourceUrl);
        } catch {
          // Not a valid URL, treat as manual card
        }
      }

      // Fall back to URL-derived title if none provided
      if (!title && sourceUrl) {
        try {
          const url = new URL(sourceUrl);
          title = linkContext?.title || titleFromUrl(url);
        } catch {
          title = `Link from ${sourceDomain || "web"}`;
        }
      }

      // Manual cards without title are invalid
      if (!title) return null;

      const facts = Array.isArray(card.facts) ? card.facts.map((f) => String(f || "").trim()).filter(Boolean) : [];
      const fallbackFacts = linkContext?.facts || (sourceDomain ? ["Imported link", "Needs check"] : []);
      const hasFacts = facts.length > 0;

      return {
        title: title.slice(0, 72),
        sourceDomain: sourceDomain || "Manual entry",
        sourceUrl: sourceUrl || "",
        description: String(card.description || "").trim().slice(0, 200) || null,
        imageUrl: (card.imagePath && cleanImageUrl(card.imagePath, sourceUrl)) || null,
        location: (card.location || linkContext?.location || sourceDomain || "Manual option").slice(0, 80),
        priceLabel: (card.priceLabel || (sourceDomain ? "Price to verify" : "")).slice(0, 40),
        facts: hasFacts ? facts.slice(0, 6) : fallbackFacts,
        trustLabel: hasFacts
          ? "Context from your pasted text · verify details before deciding"
          : (linkContext?.trustLabel || (sourceDomain ? "Imported from pasted link · verify details before deciding" : "Manual entry · no source link")),
        imagePath: (card.imagePath && cleanImageUrl(card.imagePath, sourceUrl)) || DEFAULT_CARD_IMAGE
      };
    })
    .filter(Boolean);
}

function titleFromUrl(url) {
  const pathBits = url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/\.[a-z0-9]+$/i, ""))
    .filter(Boolean)
    .filter(isUsefulPathPart);
  const raw = pathBits.at(-1) || "";
  const title = raw
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (title && title.length > 1) {
    return title.replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 72);
  }
  // Honest fallback: domain-aware title for known travel/product sites,
  // otherwise "Link from <domain>".
  const domain = url.hostname.replace(/^www\./, "");
  for (const fb of KNOWN_DOMAIN_FALLBACKS) {
    const matches = fb.domains ? hostMatchesDomain(domain, fb.domains) : fb.pattern.test(domain);
    if (matches) {
      return fb.title;
    }
  }
  return `Link from ${domain}`;
}

function isUsefulPathPart(part) {
  const normalized = part.toLowerCase();
  return (
    !/^\d{4,}$/.test(normalized) &&
    !/^[a-z]{2}(?:-[a-z]{2})?$/.test(normalized) &&
    !GENERIC_URL_PATH_PARTS.has(normalized)
  );
}

function initialsFor(name) {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return initials || "G";
}

function cardFromRow(row) {
  // Phase 1: universal decisions — update cardFromRow for nullable source_url + new columns
  return {
    id: row.id,
    title: row.title,
    sourceDomain: row.source_domain,
    sourceUrl: row.source_url,
    description: row.description || null,
    imageUrl: row.image_url || null,
    location: row.location,
    priceLabel: row.price_label,
    facts: JSON.parse(row.facts_json),
    trustLabel: row.trust_label,
    imagePath: row.image_path,
    sortOrder: row.sort_order
  };
}

function voterFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    initials: row.initials,
    isOwner: Boolean(row.is_owner)
  };
}

function getVotes(shortlistId) {
  return db
    .prepare("SELECT card_id, voter_id, vote, created_at, updated_at FROM votes WHERE shortlist_id = ?")
    .all(shortlistId)
    .map((row) => ({
      cardId: row.card_id,
      voterId: row.voter_id,
      vote: row.vote,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function normalizeVoterInput(voter) {
  if (typeof voter === "string") return { voterName: voter };
  return voter || {};
}

function ensureVoter(shortlistId, voter) {
  const voterKey = cleanVoterKey(voter.voterKey || "");
  const existing = findVoter(shortlistId, voter);
  if (existing) {
    if (voterKey && String(existing.voter_key || "").startsWith("legacy-")) {
      db.prepare("UPDATE voters SET voter_key = ? WHERE id = ?").run(voterKey, existing.id);
      return db.prepare("SELECT * FROM voters WHERE id = ?").get(existing.id);
    }
    return existing;
  }

  const name = uniqueVoterName(shortlistId, cleanVoterName(voter.voterName));
  const nextVoterKey = voterKey || fallbackVoterKey(name);
  const result = db
    .prepare("INSERT INTO voters (shortlist_id, voter_key, name, initials, is_owner) VALUES (?, ?, ?, ?, 0)")
    .run(shortlistId, nextVoterKey, name, initialsFor(name));
  return db.prepare("SELECT * FROM voters WHERE id = ?").get(Number(result.lastInsertRowid));
}

function findVoter(shortlistId, voter) {
  const voterKey = cleanVoterKey(voter.voterKey || "");
  const rawName = String(voter.voterName || "").trim();
  if (voterKey) {
    const byKey = db.prepare("SELECT * FROM voters WHERE shortlist_id = ? AND voter_key = ?").get(shortlistId, voterKey);
    if (byKey) return byKey;
    if (rawName) {
      // Match by name if the existing voter was pre-created via magic link (has voter_token)
      // This prevents duplicate voters when magic link participants vote via the API
      const byNameWithToken = db
        .prepare(
          `SELECT * FROM voters
           WHERE shortlist_id = ? AND lower(name) = lower(?)
           AND voter_token IS NOT NULL AND voter_token != ''`
        )
        .get(shortlistId, cleanVoterName(rawName));
      if (byNameWithToken) return byNameWithToken;

      // Legacy fallback for old voters
      const legacyByName = db
        .prepare(
          `SELECT *
           FROM voters
           WHERE shortlist_id = ?
             AND lower(name) = lower(?)
             AND voter_key LIKE 'legacy-%'`
        )
        .get(shortlistId, cleanVoterName(rawName));
      if (legacyByName) return legacyByName;
    }
    return null;
  }

  if (!rawName) return null;

  const fallbackKey = fallbackVoterKey(cleanVoterName(rawName));
  const byFallbackKey = db.prepare("SELECT * FROM voters WHERE shortlist_id = ? AND voter_key = ?").get(shortlistId, fallbackKey);
  if (byFallbackKey) return byFallbackKey;

  return db
    .prepare(
      `SELECT *
       FROM voters
       WHERE shortlist_id = ?
         AND lower(name) = lower(?)
         AND (voter_key IS NULL OR voter_key = '' OR voter_key LIKE 'legacy-%')`
    )
    .get(shortlistId, cleanVoterName(rawName));
}

function cleanTitle(title) {
  const clean = String(title || "").trim().replace(/\s+/g, " ").slice(0, 80);
  return clean || DEFAULT_TITLE;
}

function cleanDeadline(label) {
  const clean = String(label || "").trim().replace(/\s+/g, " ").slice(0, 80);
  return clean || DEFAULT_DEADLINE_LABEL;
}

function cleanVoterName(name) {
  const clean = String(name || "").trim().replace(/\s+/g, " ").slice(0, 40);
  return clean || "Guest";
}

function cleanVoterKey(key) {
  const clean = String(key || "")
    .trim()
    .replace(/[^a-zA-Z0-9:._-]/g, "")
    .slice(0, 80);
  return /[a-zA-Z0-9]/.test(clean) ? clean : "";
}

function fallbackVoterKey(name) {
  return cleanVoterKey(`name:${cleanVoterName(name)}`) || "name:Guest";
}

function normalizeParticipants(participants) {
  if (!Array.isArray(participants)) return [];
  return Array.from(new Set(participants.map(cleanVoterName))).filter(Boolean).slice(0, 20);
}

function uniqueVoterName(shortlistId, name) {
  const base = cleanVoterName(name);
  let candidate = base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const existing = db.prepare("SELECT id FROM voters WHERE shortlist_id = ? AND lower(name) = lower(?)").get(shortlistId, candidate);
    if (!existing) return candidate;
    candidate = `${base} ${suffix}`;
  }
  return `${base} ${randomInt(1000, 10000)}`;
}

function slugFor(value) {
  return cleanVoterKey(
    String(value || "guest")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
  );
}

// Phase 1: Generate a cryptographically random voter token for magic links
function generateVoterToken() {
  return randomBytes(16).toString("base64url");
}

// Phase 1: Resolve a voter token to a voter identity
export function resolveVoterByToken(code, token) {
  if (!token || !code) return null;
  const shortlist = db.prepare("SELECT id FROM shortlists WHERE code = ?").get(code);
  if (!shortlist) return null;
  const voter = db
    .prepare("SELECT * FROM voters WHERE shortlist_id = ? AND voter_token = ?")
    .get(shortlist.id, token);
  if (!voter) return null;
  return voterFromRow(voter);
}

// Phase 1: Finalize a shortlist (compute results, set finalized flags)
function finalizeShortlist(shortlistId) {
  const now = new Date().toISOString();
  db.prepare("UPDATE shortlists SET finalized = 1, finalized_at = ? WHERE id = ? AND finalized = 0").run(now, shortlistId);
}

// Phase 1: Check if a shortlist is past its deadline (and finalize if so)
export function checkAndFinalize(code) {
  const shortlist = db.prepare("SELECT id, deadline, finalized FROM shortlists WHERE code = ?").get(code);
  if (!shortlist) return null;
  if (!shortlist.finalized && shortlist.deadline && new Date(shortlist.deadline) <= new Date()) {
    finalizeShortlist(shortlist.id);
    return true;
  }
  return Boolean(shortlist.finalized);
}

// Phase 1: Get participation data per voter for a shortlist
function getParticipationData(shortlistId, totalCards) {
  const voters = db.prepare("SELECT * FROM voters WHERE shortlist_id = ? ORDER BY id").all(shortlistId);
  totalCards = totalCards || Number(db.prepare("SELECT COUNT(*) AS count FROM cards WHERE shortlist_id = ?").get(shortlistId)?.count || 0);

  return voters.map((voter) => {
    const votedCards = Number(
      db.prepare("SELECT COUNT(DISTINCT card_id) AS count FROM votes WHERE shortlist_id = ? AND voter_id = ?")
        .get(shortlistId, voter.id)?.count || 0
    );
    return {
      name: voter.name,
      initials: String(voter.initials || voter.name[0] || "?").slice(0, 2).toUpperCase(),
      isOwner: Boolean(voter.is_owner),
      completedCardCount: votedCards,
      totalCards,
      isCompleted: totalCards > 0 && votedCards >= totalCards
    };
  });
}

// Phase 1: Get participation data for the dashboard endpoint
export function getParticipation(code) {
  const shortlist = db.prepare("SELECT id FROM shortlists WHERE code = ?").get(code);
  if (!shortlist) return null;
  const totalCards = Number(db.prepare("SELECT COUNT(*) AS count FROM cards WHERE shortlist_id = ?").get(shortlist.id)?.count || 0);
  return { participants: getParticipationData(shortlist.id, totalCards) };
}
