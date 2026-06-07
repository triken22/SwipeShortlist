import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

test("creates a shortlist and ranks a winner after votes", async () => {
  const temp = mkdtempSync(join(tmpdir(), "swipe-shortlist-"));
  process.env.SWIPE_DB_PATH = join(temp, "test.sqlite");
  const dbModule = await import(`../src/db.js?case=${Date.now()}`);

  try {
    dbModule.migrate();
    const shortlist = dbModule.createShortlist({ title: "Test trip" });
    assert.equal(shortlist.title, "Test trip");
    assert.equal(shortlist.cards.length, 21);
    assert.equal(shortlist.voters.length, 4);

    const results = dbModule.recordVote({
      code: shortlist.code,
      cardId: shortlist.cards[0].id,
      voterName: "You",
      vote: "yes"
    });

    assert.equal(results.winner.title, "Mare Blu Suites");
    assert.equal(results.winner.yesCount, 4);
    assert.equal(dbModule.hasVoterVoted(shortlist.code, "You"), true);
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
    assert.equal(shortlist.cards[0].priceLabel, "Price to verify");
    assert.match(shortlist.cards[0].trustLabel, /verify before booking/);
    assert.match(shortlist.code, /^FAMILY-\d{6}$/);
    assert.equal(dbModule.hasVoterVoted(shortlist.code, "You"), false);

    const afterNo = dbModule.recordVote({
      code: shortlist.code,
      cardId: shortlist.cards[0].id,
      voterName: "You",
      vote: "no"
    });
    assert.equal(afterNo.winner.title, shortlist.cards[1].title);

    const afterYes = dbModule.recordVote({
      code: shortlist.code,
      cardId: shortlist.cards[1].id,
      voterName: "You",
      vote: "yes"
    });
    assert.equal(afterYes.winner.title, shortlist.cards[1].title);

    dbModule.deleteVote({
      code: shortlist.code,
      cardId: shortlist.cards[1].id,
      voterName: "You"
    });
    assert.equal(dbModule.hasVoterVoted(shortlist.code, "You"), true);

    dbModule.deleteVote({
      code: shortlist.code,
      cardId: shortlist.cards[0].id,
      voterName: "You"
    });
    assert.equal(dbModule.hasVoterVoted(shortlist.code, "You"), false);
  } finally {
    dbModule.db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
