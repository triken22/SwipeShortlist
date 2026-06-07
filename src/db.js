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
}

const fallbackImages = ["/assets/mare-blu.png", "/assets/beach-thumb.png", "/assets/mare-thumb.png"];

const baseSampleCards = [
  {
    title: "Mare Blu Suites",
    sourceDomain: "booking.com",
    sourceUrl: "https://www.booking.com/searchresults.html?ss=Crete%2C%20Greece",
    location: "Crete, Greece",
    priceLabel: "EUR 1,240 / 7 nights",
    facts: ["3h flight", "Pool", "Family room", "4.6"],
    trustLabel: "Demo card · verify total price before booking",
    imagePath: "/assets/mare-blu.png"
  },
  {
    title: "Beachfront Apartment",
    sourceDomain: "airbnb.com",
    sourceUrl: "https://www.airbnb.com/s/Split--Croatia/homes",
    location: "Split, Croatia",
    priceLabel: "EUR 1,090 / 7 nights",
    facts: ["Sea view", "Kitchen", "2 bedrooms", "4.5"],
    trustLabel: "Demo card · verify total price before booking",
    imagePath: "/assets/beach-thumb.png"
  },
  {
    title: "Sunrise Resort",
    sourceDomain: "expedia.com",
    sourceUrl: "https://www.expedia.com/Hotel-Search?destination=Malta",
    location: "Malta",
    priceLabel: "EUR 1,480 / 7 nights",
    facts: ["Pool", "Breakfast", "Kids club", "4.4"],
    trustLabel: "Demo card · verify total price before booking",
    imagePath: "/assets/mare-thumb.png"
  }
];

const extraSampleCards = [
  ["Pine Cove Hotel", "booking.com", "https://www.booking.com/searchresults.html?ss=Algarve", "Algarve, Portugal", "EUR 1,180 / 7 nights", ["Pool", "Breakfast", "Family room", "4.5"]],
  ["Harbor Family Villa", "airbnb.com", "https://www.airbnb.com/s/Algarve--Portugal/homes", "Tavira, Portugal", "EUR 1,320 / 7 nights", ["Kitchen", "Parking", "2 bedrooms", "4.7"]],
  ["Olive Garden Stay", "expedia.com", "https://www.expedia.com/Hotel-Search?destination=Corfu", "Corfu, Greece", "EUR 1,360 / 7 nights", ["Garden", "Breakfast", "Beach shuttle", "4.4"]],
  ["Blue Bay Rooms", "booking.com", "https://www.booking.com/searchresults.html?ss=Rhodes", "Rhodes, Greece", "EUR 1,110 / 7 nights", ["Sea view", "Pool", "Family room", "4.3"]],
  ["Lagoon Apartment", "airbnb.com", "https://www.airbnb.com/s/Malta/homes", "Sliema, Malta", "EUR 1,060 / 7 nights", ["Kitchen", "Balcony", "Washer", "4.6"]],
  ["Sunset Kids Resort", "expedia.com", "https://www.expedia.com/Hotel-Search?destination=Cyprus", "Paphos, Cyprus", "EUR 1,520 / 7 nights", ["Kids club", "Pool", "Breakfast", "4.5"]],
  ["Old Town Guesthouse", "booking.com", "https://www.booking.com/searchresults.html?ss=Dubrovnik", "Dubrovnik, Croatia", "EUR 1,290 / 7 nights", ["Old town", "2 rooms", "AC", "4.4"]],
  ["Citrus Coast Flat", "airbnb.com", "https://www.airbnb.com/s/Sicily--Italy/homes", "Sicily, Italy", "EUR 970 / 7 nights", ["Kitchen", "Sea nearby", "Parking", "4.5"]],
  ["Aegean Pool House", "booking.com", "https://www.booking.com/searchresults.html?ss=Naxos", "Naxos, Greece", "EUR 1,410 / 7 nights", ["Pool", "Terrace", "Family room", "4.8"]],
  ["Marina View Suite", "expedia.com", "https://www.expedia.com/Hotel-Search?destination=Split", "Split, Croatia", "EUR 1,220 / 7 nights", ["Marina", "Breakfast", "AC", "4.3"]],
  ["Fig Tree Retreat", "airbnb.com", "https://www.airbnb.com/s/Cyprus/homes", "Protaras, Cyprus", "EUR 1,140 / 7 nights", ["Garden", "Washer", "2 bedrooms", "4.6"]],
  ["Baystone Hotel", "booking.com", "https://www.booking.com/searchresults.html?ss=Madeira", "Madeira, Portugal", "EUR 1,260 / 7 nights", ["Pool", "Breakfast", "Sea view", "4.4"]],
  ["White Sand Studios", "expedia.com", "https://www.expedia.com/Hotel-Search?destination=Sardinia", "Sardinia, Italy", "EUR 1,340 / 7 nights", ["Beach", "Kitchenette", "AC", "4.5"]],
  ["Garden Pool Rooms", "booking.com", "https://www.booking.com/searchresults.html?ss=Kos", "Kos, Greece", "EUR 1,080 / 7 nights", ["Pool", "Family room", "Breakfast", "4.2"]],
  ["Beach Gate Villa", "airbnb.com", "https://www.airbnb.com/s/Mallorca--Spain/homes", "Mallorca, Spain", "EUR 1,580 / 7 nights", ["Villa", "Pool", "Parking", "4.7"]],
  ["Cove Breakfast Hotel", "expedia.com", "https://www.expedia.com/Hotel-Search?destination=Crete", "Crete, Greece", "EUR 1,190 / 7 nights", ["Breakfast", "Pool", "Beach nearby", "4.4"]],
  ["Terrace Family Loft", "airbnb.com", "https://www.airbnb.com/s/Lisbon--Portugal/homes", "Lisbon Coast, Portugal", "EUR 1,030 / 7 nights", ["Terrace", "Washer", "Kitchen", "4.5"]],
  ["Seabreeze Resort", "booking.com", "https://www.booking.com/searchresults.html?ss=Malta", "Gozo, Malta", "EUR 1,250 / 7 nights", ["Pool", "Sea view", "Family room", "4.6"]]
].map(([title, sourceDomain, sourceUrl, location, priceLabel, facts], index) => ({
  title,
  sourceDomain,
  sourceUrl,
  location,
  priceLabel,
  facts,
  trustLabel: "Demo card · verify total price before booking",
  imagePath: fallbackImages[(index + baseSampleCards.length) % fallbackImages.length]
}));

const sampleCards = [...baseSampleCards, ...extraSampleCards];

export function createShortlist({ title = "Summer hotels", participants = ["You", "Anna", "Tom", "Mia"], deadlineLabel = "Aim to decide by 21:00", links = [] } = {}) {
  const code = nextCode();
  const cardsToCreate = cardsFromLinks(links);
  const insertShortlist = db.prepare("INSERT INTO shortlists (code, title, deadline_label) VALUES (?, ?, ?)");
  const insertCard = db.prepare(`
    INSERT INTO cards (
      shortlist_id, title, source_domain, source_url, location, price_label,
      facts_json, trust_label, image_path, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertVoter = db.prepare("INSERT INTO voters (shortlist_id, name, initials, is_owner) VALUES (?, ?, ?, ?)");
  const insertVote = db.prepare(`
    INSERT INTO votes (shortlist_id, card_id, voter_id, vote)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(card_id, voter_id) DO UPDATE SET vote = excluded.vote, updated_at = CURRENT_TIMESTAMP
  `);

  db.exec("BEGIN");
  try {
    const shortlistResult = insertShortlist.run(code, title, deadlineLabel);
    const shortlistId = Number(shortlistResult.lastInsertRowid);
    const cardIds = cardsToCreate.map((card, index) => {
      const result = insertCard.run(
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
      return Number(result.lastInsertRowid);
    });

    const voterIds = participants.map((name, index) => {
      const result = insertVoter.run(shortlistId, name, initialsFor(name), index === 0 ? 1 : 0);
      return { id: Number(result.lastInsertRowid), name };
    });

    const firstCard = cardIds[0];
    voterIds
      .filter((voter) => voter.name !== "You")
      .forEach((voter) => insertVote.run(shortlistId, firstCard, voter.id, voter.name === "Mia" ? "strong_yes" : "yes"));

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
  const voters = db.prepare("SELECT * FROM voters WHERE shortlist_id = ? ORDER BY id").all(shortlist.id).map(voterFromRow);
  const votes = includeVotes ? getVotes(shortlist.id) : [];
  const votedCount = db
    .prepare("SELECT COUNT(DISTINCT voter_id) AS count FROM votes WHERE shortlist_id = ?")
    .get(shortlist.id).count;

  return {
    id: shortlist.id,
    code: shortlist.code,
    title: shortlist.title,
    deadlineLabel: shortlist.deadline_label,
    cards,
    voters,
    votedCount,
    votes
  };
}

export function recordVote({ code, cardId, voterName = "You", vote }) {
  const shortlist = db.prepare("SELECT * FROM shortlists WHERE code = ?").get(code);
  if (!shortlist) return null;

  const voter = db
    .prepare("SELECT * FROM voters WHERE shortlist_id = ? AND lower(name) = lower(?)")
    .get(shortlist.id, voterName);
  if (!voter) throw new Error("Unknown voter");

  const card = db.prepare("SELECT * FROM cards WHERE shortlist_id = ? AND id = ?").get(shortlist.id, cardId);
  if (!card) throw new Error("Unknown card");

  db.prepare(`
    INSERT INTO votes (shortlist_id, card_id, voter_id, vote)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(card_id, voter_id) DO UPDATE SET vote = excluded.vote, updated_at = CURRENT_TIMESTAMP
  `).run(shortlist.id, cardId, voter.id, vote);

  return getResults(code);
}

export function hasVoterVoted(code, voterName = "You") {
  if (!voterName) return false;
  const row = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM votes
      JOIN shortlists ON shortlists.id = votes.shortlist_id
      JOIN voters ON voters.id = votes.voter_id
      WHERE shortlists.code = ? AND lower(voters.name) = lower(?)
    `)
    .get(code, voterName);
  return Number(row?.count || 0) > 0;
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
      const holdCount = cardVotes.filter((vote) => vote.vote === "hold").length;
      const noCount = cardVotes.filter((vote) => vote.vote === "no").length;
      return {
        ...card,
        votes: cardVotes,
        yesCount,
        holdCount,
        noCount,
        score: yesCount * 2 + holdCount - noCount * 3
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

function cardsFromLinks(links) {
  const parsedLinks = Array.isArray(links)
    ? links
    : String(links || "")
        .split(/\s+/)
        .filter(Boolean);

  const cards = parsedLinks
    .map((link, index) => {
      try {
        const url = new URL(link);
        const domain = url.hostname.replace(/^www\./, "");
        return {
          title: titleFromUrl(url),
          sourceDomain: domain,
          sourceUrl: url.toString(),
          location: "Open source link",
          priceLabel: "Price to verify",
          facts: ["Imported", "One-tap vote", "Needs check"],
          trustLabel: "Imported from pasted link · verify before booking",
          imagePath: fallbackImages[index % fallbackImages.length]
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(0, 50);

  return cards.length ? cards : sampleCards;
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
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
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
