import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomInt } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = resolve(process.env.SWIPE_DATA_DIR || "./data");
const DB_PATH = resolve(process.env.SWIPE_DB_PATH || `${DATA_DIR}/swipe-shortlist.sqlite`);

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA journal_mode = WAL");

const DEFAULT_CARD_IMAGE = "/assets/link-card.svg";
const DEFAULT_TITLE = "Private shortlist";
const DEFAULT_DEADLINE_LABEL = "Aim to decide today";
const MAX_LINKS = 50;

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

    DELETE FROM shortlists
    WHERE id IN (
      SELECT DISTINCT shortlist_id
      FROM cards
      WHERE trust_label LIKE 'Demo card%'
    );
  `);
}

export function createShortlist({ title = DEFAULT_TITLE, participants = [], deadlineLabel = DEFAULT_DEADLINE_LABEL, links = [] } = {}) {
  const code = nextCode();
  const normalizedLinks = normalizeLinks(links);
  const cardsToCreate = cardsFromLinks(normalizedLinks);
  if (!cardsToCreate.length) {
    throw new Error("Paste at least one valid http or https link.");
  }

  const participantNames = normalizeParticipants(participants);
  const insertShortlist = db.prepare("INSERT INTO shortlists (code, title, deadline_label) VALUES (?, ?, ?)");
  const insertCard = db.prepare(`
    INSERT INTO cards (
      shortlist_id, title, source_domain, source_url, location, price_label,
      facts_json, trust_label, image_path, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertVoter = db.prepare("INSERT INTO voters (shortlist_id, voter_key, name, initials, is_owner) VALUES (?, ?, ?, ?, ?)");

  db.exec("BEGIN");
  try {
    const shortlistResult = insertShortlist.run(code, cleanTitle(title), cleanDeadline(deadlineLabel));
    const shortlistId = Number(shortlistResult.lastInsertRowid);
    cardsToCreate.forEach((card, index) => {
      insertCard.run(
        shortlistId,
        card.title,
        card.sourceDomain,
        card.sourceUrl,
        card.location,
        card.priceLabel,
        JSON.stringify(card.facts),
        card.trustLabel,
        card.imagePath,
        index + 1
      );
    });

    participantNames.forEach((name, index) => {
      insertVoter.run(shortlistId, `invite-${index + 1}-${slugFor(name)}`, name, initialsFor(name), index === 0 ? 1 : 0);
    });

    db.exec("COMMIT");
    return getShortlist(code, { includeVotes: false });
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

  return {
    id: shortlist.id,
    code: shortlist.code,
    title: shortlist.title,
    deadlineLabel: shortlist.deadline_label,
    cards,
    voters,
    votedCount,
    completedVoterCount,
    votes
  };
}

export function recordVote({ code, cardId, voterKey, voterName = "Guest", vote }) {
  const shortlist = db.prepare("SELECT * FROM shortlists WHERE code = ?").get(code);
  if (!shortlist) return null;

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

  const cardCount = Number(db.prepare("SELECT COUNT(*) AS count FROM cards WHERE shortlist_id = ?").get(shortlist.id)?.count || 0);
  if (!cardCount) return false;

  const voteCount = Number(
    db.prepare("SELECT COUNT(DISTINCT card_id) AS count FROM votes WHERE shortlist_id = ? AND voter_id = ?").get(shortlist.id, existing.id)
      ?.count || 0
  );
  return voteCount >= cardCount;
}

export function getResults(code) {
  const shortlist = getShortlist(code, { includeVotes: true });
  if (!shortlist) return null;

  const votersById = new Map(shortlist.voters.map((voter) => [voter.id, voter]));
  const votesByCard = new Map();
  shortlist.votes.forEach((vote) => {
    const group = votesByCard.get(vote.cardId) || [];
    group.push({ ...vote, voter: votersById.get(vote.voterId) });
    votesByCard.set(vote.cardId, group);
  });

  const rankedCards = shortlist.cards
    .map((card) => {
      const cardVotes = votesByCard.get(card.id) || [];
      const yesCount = cardVotes.filter((vote) => vote.vote === "yes" || vote.vote === "strong_yes").length;
      const strongYesCount = cardVotes.filter((vote) => vote.vote === "strong_yes").length;
      const holdCount = cardVotes.filter((vote) => vote.vote === "hold").length;
      const noCount = cardVotes.filter((vote) => vote.vote === "no").length;
      return {
        ...card,
        votes: cardVotes,
        yesCount,
        strongYesCount,
        holdCount,
        noCount,
        score: yesCount * 2 + strongYesCount + holdCount - noCount * 3
      };
    })
    .sort((a, b) => b.score - a.score || a.sortOrder - b.sortOrder);

  const winner = rankedCards[0] || null;
  return {
    shortlist,
    winner,
    backups: rankedCards.slice(1, 3)
  };
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
        return {
          title: titleFromUrl(url),
          sourceDomain: domain,
          sourceUrl: url.toString(),
          location: domain,
          priceLabel: "Price to verify",
          facts: ["Imported link", "One-tap vote", "Needs check"],
          trustLabel: "Imported from pasted link · verify details before deciding",
          imagePath: DEFAULT_CARD_IMAGE
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function titleFromUrl(url) {
  const pathBits = url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/\.[a-z0-9]+$/i, ""))
    .filter(Boolean);
  const raw = pathBits.at(-1) || url.hostname.replace(/^www\./, "");
  const title = raw
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title ? title.replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 72) : "Imported link";
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
  return {
    id: row.id,
    title: row.title,
    sourceDomain: row.source_domain,
    sourceUrl: row.source_url,
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
  const existing = findVoter(shortlistId, voter);
  if (existing) return existing;

  const name = uniqueVoterName(shortlistId, cleanVoterName(voter.voterName));
  const voterKey = cleanVoterKey(voter.voterKey || "") || fallbackVoterKey(name);
  const result = db
    .prepare("INSERT INTO voters (shortlist_id, voter_key, name, initials, is_owner) VALUES (?, ?, ?, ?, 0)")
    .run(shortlistId, voterKey, name, initialsFor(name));
  return db.prepare("SELECT * FROM voters WHERE id = ?").get(Number(result.lastInsertRowid));
}

function findVoter(shortlistId, voter) {
  const voterKey = cleanVoterKey(voter.voterKey || "");
  if (voterKey) {
    const byKey = db.prepare("SELECT * FROM voters WHERE shortlist_id = ? AND voter_key = ?").get(shortlistId, voterKey);
    if (byKey) return byKey;
    return null;
  }

  const rawName = String(voter.voterName || "").trim();
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
