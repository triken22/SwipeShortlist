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
