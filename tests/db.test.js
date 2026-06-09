import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

test("rejects empty shortlist creation instead of seeding placeholder cards", async () => {
  const temp = mkdtempSync(join(tmpdir(), "swipe-shortlist-"));
  process.env.SWIPE_DB_PATH = join(temp, "test.sqlite");
  const dbModule = await import(`../src/db.js?case=${Date.now()}`);

  try {
    dbModule.migrate();
    assert.throws(() => dbModule.createShortlist({ title: "Test trip" }), /valid http or https link/);
  } finally {
    dbModule.db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("imports pasted links as votable cards without fake price certainty", async () => {
  const temp = mkdtempSync(join(tmpdir(), "swipe-shortlist-links-"));
  process.env.SWIPE_DB_PATH = join(temp, "test.sqlite");
  const dbModule = await import(`../src/db.js?case=links-${Date.now()}`);

  try {
    dbModule.migrate();
    const shortlist = dbModule.createShortlist({
      links: ["https://example.org/family-hotel", "https://example.net/beach-apartment"]
    });

    assert.equal(shortlist.cards.length, 2);
    assert.equal(shortlist.voters.length, 0);
    assert.equal(shortlist.cards[0].priceLabel, "Price to verify");
    assert.match(shortlist.cards[0].trustLabel, /verify details before deciding/);
    assert.equal(shortlist.cards[0].imagePath, "/assets/link-card.svg");
    assert.match(shortlist.code, /^FAMILY-\d{6}$/);
    assert.equal(dbModule.hasVoterVoted(shortlist.code, { voterKey: "alice" }), false);
    assert.equal(dbModule.hasVoterCompleted(shortlist.code, { voterKey: "alice" }), false);

    const afterNo = dbModule.recordVote({
      code: shortlist.code,
      cardId: shortlist.cards[0].id,
      voterKey: "alice",
      voterName: "You",
      vote: "no"
    });
    assert.equal(afterNo.winner.title, shortlist.cards[1].title);
    assert.equal(dbModule.hasVoterVoted(shortlist.code, { voterKey: "alice" }), true);
    assert.equal(dbModule.hasVoterCompleted(shortlist.code, { voterKey: "alice" }), false);

    const afterYes = dbModule.recordVote({
      code: shortlist.code,
      cardId: shortlist.cards[1].id,
      voterKey: "alice",
      voterName: "You",
      vote: "yes"
    });
    assert.equal(afterYes.winner.title, shortlist.cards[1].title);
    assert.equal(dbModule.hasVoterCompleted(shortlist.code, { voterKey: "alice" }), true);

    dbModule.recordVote({
      code: shortlist.code,
      cardId: shortlist.cards[0].id,
      voterKey: "bob",
      voterName: "You",
      vote: "hold"
    });
    const withTwoVoters = dbModule.getResults(shortlist.code).shortlist;
    assert.deepEqual(
      withTwoVoters.voters.map((voter) => voter.name),
      ["You", "You 2"]
    );

    dbModule.deleteVote({
      code: shortlist.code,
      cardId: shortlist.cards[1].id,
      voterKey: "alice",
      voterName: "You"
    });
    assert.equal(dbModule.hasVoterVoted(shortlist.code, { voterKey: "alice" }), true);
    assert.equal(dbModule.hasVoterCompleted(shortlist.code, { voterKey: "alice" }), false);

    dbModule.deleteVote({
      code: shortlist.code,
      cardId: shortlist.cards[0].id,
      voterKey: "alice",
      voterName: "You"
    });
    assert.equal(dbModule.hasVoterVoted(shortlist.code, { voterKey: "alice" }), false);
  } finally {
    dbModule.db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("omitted voter key cannot act as an existing keyed voter", async () => {
  const temp = mkdtempSync(join(tmpdir(), "swipe-shortlist-keyed-"));
  process.env.SWIPE_DB_PATH = join(temp, "test.sqlite");
  const dbModule = await import(`../src/db.js?case=keyed-${Date.now()}`);

  try {
    dbModule.migrate();
    const shortlist = dbModule.createShortlist({
      links: ["https://example.org/family-hotel", "https://example.net/beach-apartment"]
    });

    dbModule.recordVote({
      code: shortlist.code,
      cardId: shortlist.cards[0].id,
      voterKey: "real-browser-key",
      voterName: "You",
      vote: "yes"
    });

    dbModule.recordVote({
      code: shortlist.code,
      cardId: shortlist.cards[1].id,
      voterName: "You",
      vote: "no"
    });

    assert.equal(dbModule.hasVoterCompleted(shortlist.code, { voterKey: "real-browser-key", voterName: "You" }), false);
    assert.equal(dbModule.hasVoterCompleted(shortlist.code, { voterName: "You" }), false);

    const voters = dbModule.getResults(shortlist.code).shortlist.voters.map((voter) => ({
      name: voter.name,
      isOwner: voter.isOwner
    }));
    assert.deepEqual(voters, [
      { name: "You", isOwner: false },
      { name: "You 2", isOwner: false }
    ]);
  } finally {
    dbModule.db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("creates shortlist from structured draft cards with user-edited context", async () => {
  const temp = mkdtempSync(join(tmpdir(), "swipe-shortlist-draft-"));
  process.env.SWIPE_DB_PATH = join(temp, "test.sqlite");
  const dbModule = await import(`../src/db.js?case=draft-${Date.now()}`);

  try {
    dbModule.migrate();
    const cards = [
      { sourceUrl: "https://example.org/bali-resort", title: "Bali Beach Resort", priceLabel: "$150/night", location: "Bali, Indonesia", facts: ["Beachfront", "Pool", "Breakfast included"] },
      { sourceUrl: "https://example.net/ubud-inn", title: "Ubud Garden Inn", priceLabel: "$85/night", location: "Ubud, Bali", facts: ["Rice terrace view"] }
    ];
    const shortlist = dbModule.createShortlist({ title: "Bali Trip", cards });
    assert.equal(shortlist.cards.length, 2);
    assert.equal(shortlist.cards[0].title, "Bali Beach Resort");
    assert.equal(shortlist.cards[0].priceLabel, "$150/night");
    assert.equal(shortlist.cards[0].location, "Bali, Indonesia");
    assert.deepEqual(shortlist.cards[0].facts, ["Beachfront", "Pool", "Breakfast included"]);
    assert.match(shortlist.cards[0].trustLabel, /pasted text/);
    assert.equal(shortlist.cards[1].title, "Ubud Garden Inn");
    assert.equal(shortlist.cards[1].priceLabel, "$85/night");
    assert.equal(shortlist.cards[1].location, "Ubud, Bali");
    assert.deepEqual(shortlist.cards[1].facts, ["Rice terrace view"]);
    assert.match(shortlist.code, /^FAMILY-\d{6}$/);
  } finally {
    dbModule.db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("empty cleaned voter keys are treated as absent", async () => {
  const temp = mkdtempSync(join(tmpdir(), "swipe-shortlist-empty-key-"));
  process.env.SWIPE_DB_PATH = join(temp, "test.sqlite");
  const dbModule = await import(`../src/db.js?case=empty-key-${Date.now()}`);

  try {
    dbModule.migrate();
    const shortlist = dbModule.createShortlist({
      links: ["https://example.org/family-hotel", "https://example.net/beach-apartment"]
    });

    assert.doesNotThrow(() => {
      dbModule.recordVote({
        code: shortlist.code,
        cardId: shortlist.cards[0].id,
        voterKey: "!!!",
        voterName: "You",
        vote: "yes"
      });
      dbModule.recordVote({
        code: shortlist.code,
        cardId: shortlist.cards[1].id,
        voterKey: "...",
        voterName: "You",
        vote: "hold"
      });
    });

    assert.equal(dbModule.hasVoterCompleted(shortlist.code, { voterName: "You" }), true);
  } finally {
    dbModule.db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("rejects empty cards array", async () => {
  const temp = mkdtempSync(join(tmpdir(), "swipe-shortlist-empty-"));
  process.env.SWIPE_DB_PATH = join(temp, "test.sqlite");
  const dbModule = await import(`../src/db.js?case=empty-${Date.now()}`);

  try {
    dbModule.migrate();
    assert.throws(() => dbModule.createShortlist({ cards: [] }), /valid http or https source URL/);
    assert.throws(() => dbModule.createShortlist({ cards: [{ sourceUrl: "not-a-url" }] }), /valid http or https source URL/);
  } finally {
    dbModule.db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("generates clear winner rationale", async () => {
  const temp = mkdtempSync(join(tmpdir(), "swipe-shortlist-rationale-"));
  process.env.SWIPE_DB_PATH = join(temp, "test.sqlite");
  const dbModule = await import(`../src/db.js?case=rationale-${Date.now()}`);

  try {
    dbModule.migrate();
    const shortlist = dbModule.createShortlist({
      cards: [
        { sourceUrl: "https://example.org/a" },
        { sourceUrl: "https://example.org/b" }
      ]
    });

    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[0].id, voterKey: "voter1", voterName: "You", vote: "yes" });
    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[0].id, voterKey: "voter2", voterName: "You 2", vote: "yes" });
    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[1].id, voterKey: "voter1", voterName: "You", vote: "no" });
    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[1].id, voterKey: "voter2", voterName: "You 2", vote: "hold" });

    const results = dbModule.getResults(shortlist.code);
    assert.equal(results.rationale.summary, "clear");
    assert.match(results.rationale.detail, /positive/);
    assert.equal(results.rationale.noCount, 0);
    assert.equal(results.rationale.yesCount, 2);
    assert.equal(results.rationale.hasBackup, true);
    assert.match(results.rationale.copyText, /Final pick/);
  } finally {
    dbModule.db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("detects tie in rationale", async () => {
  const temp = mkdtempSync(join(tmpdir(), "swipe-shortlist-tie-"));
  process.env.SWIPE_DB_PATH = join(temp, "test.sqlite");
  const dbModule = await import(`../src/db.js?case=tie-${Date.now()}`);

  try {
    dbModule.migrate();
    const shortlist = dbModule.createShortlist({
      cards: [
        { sourceUrl: "https://example.org/a" },
        { sourceUrl: "https://example.org/b" }
      ]
    });

    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[0].id, voterKey: "voter1", voterName: "You", vote: "yes" });
    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[1].id, voterKey: "voter1", voterName: "You", vote: "yes" });

    const results = dbModule.getResults(shortlist.code);
    assert.equal(results.rationale.tied, true);
    assert.equal(results.rationale.summary, "split");
    assert.match(results.rationale.detail, /Tied/);
  } finally {
    dbModule.db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("detects veto in rationale when half or more vote no on winner", async () => {
  const temp = mkdtempSync(join(tmpdir(), "swipe-shortlist-veto-"));
  process.env.SWIPE_DB_PATH = join(temp, "test.sqlite");
  const dbModule = await import(`../src/db.js?case=veto-${Date.now()}`);

  try {
    dbModule.migrate();
    const shortlist = dbModule.createShortlist({
      cards: [
        { sourceUrl: "https://example.org/a" },
        { sourceUrl: "https://example.org/b" }
      ]
    });

    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[0].id, voterKey: "voter1", voterName: "You", vote: "yes" });
    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[0].id, voterKey: "voter2", voterName: "You 2", vote: "no" });
    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[1].id, voterKey: "voter1", voterName: "You", vote: "no" });
    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[1].id, voterKey: "voter2", voterName: "You 2", vote: "hold" });

    const results = dbModule.getResults(shortlist.code);
    assert.equal(results.rationale.summary, "vetoed");
    assert.match(results.rationale.detail, /No/);
    assert.equal(results.rationale.noCount, 1);
  } finally {
    dbModule.db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("detects contested winner when no exceeds positive but below veto threshold", async () => {
  const temp = mkdtempSync(join(tmpdir(), "swipe-shortlist-contested-"));
  process.env.SWIPE_DB_PATH = join(temp, "test.sqlite");
  const dbModule = await import(`../src/db.js?case=contested-${Date.now()}`);

  try {
    dbModule.migrate();
    const shortlist = dbModule.createShortlist({
      cards: [
        { sourceUrl: "https://example.org/a" },
        { sourceUrl: "https://example.org/b" }
      ]
    });

    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[0].id, voterKey: "v1", voterName: "V1", vote: "no" });
    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[0].id, voterKey: "v2", voterName: "V2", vote: "no" });
    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[0].id, voterKey: "v3", voterName: "V3", vote: "yes" });
    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[0].id, voterKey: "v4", voterName: "V4", vote: "hold" });
    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[0].id, voterKey: "v5", voterName: "V5", vote: "no" });
    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[1].id, voterKey: "v1", voterName: "V1", vote: "yes" });
    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[1].id, voterKey: "v2", voterName: "V2", vote: "hold" });
    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[1].id, voterKey: "v3", voterName: "V3", vote: "no" });
    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[1].id, voterKey: "v4", voterName: "V4", vote: "no" });
    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[1].id, voterKey: "v5", voterName: "V5", vote: "hold" });

    const results = dbModule.getResults(shortlist.code);
    assert.equal(results.rationale.summary, "contested");
    assert.match(results.rationale.detail, /more No/);
    assert.equal(results.rationale.noCount, 2);
  } finally {
    dbModule.db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("locks results until voter completes all cards", async () => {
  const temp = mkdtempSync(join(tmpdir(), "swipe-shortlist-lock-"));
  process.env.SWIPE_DB_PATH = join(temp, "test.sqlite");
  const dbModule = await import(`../src/db.js?case=lock-${Date.now()}`);

  try {
    dbModule.migrate();
    const shortlist = dbModule.createShortlist({
      cards: [
        { sourceUrl: "https://example.org/a" },
        { sourceUrl: "https://example.org/b" },
        { sourceUrl: "https://example.org/c" }
      ]
    });

    assert.equal(dbModule.hasVoterCompleted(shortlist.code, { voterKey: "voter1" }), false);
    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[0].id, voterKey: "voter1", voterName: "You", vote: "yes" });
    assert.equal(dbModule.hasVoterCompleted(shortlist.code, { voterKey: "voter1" }), false);
    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[1].id, voterKey: "voter1", voterName: "You", vote: "yes" });
    assert.equal(dbModule.hasVoterCompleted(shortlist.code, { voterKey: "voter1" }), false);
    dbModule.recordVote({ code: shortlist.code, cardId: shortlist.cards[2].id, voterKey: "voter1", voterName: "You", vote: "yes" });
    assert.equal(dbModule.hasVoterCompleted(shortlist.code, { voterKey: "voter1" }), true);
  } finally {
    dbModule.db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
