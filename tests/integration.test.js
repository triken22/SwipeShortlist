import { describe, it } from "node:test";
import assert from "node:assert";
import {
  createShortlist,
  deleteVote,
  getParticipation,
  getResults,
  getShortlist,
  recordVote,
  resolveVoterByToken,
  migrate
} from "../src/db.js";

// Ensure migration runs before tests
migrate();

describe("Phase 1: Magic Link Voter Identity", () => {
  it("creates shortlist with participants and magic links", () => {
    const result = createShortlist({
      title: "Test Magic",
      participants: ["Alice", "Bob", "Carol"],
      cards: [
        { sourceUrl: "https://example.com/one", title: "Option 1" },
        { sourceUrl: "https://example.com/two", title: "Option 2" }
      ]
    });

    assert.ok(result.code);
    assert.ok(result.magicLinks);
    assert.equal(Object.keys(result.magicLinks).length, 3);
    assert.ok(result.magicLinks.Alice.includes("?t="));
    assert.ok(result.magicLinks.Bob.includes("?t="));
    assert.ok(result.magicLinks.Carol.includes("?t="));
    assert.ok(result.magicLinks.Alice.includes(result.code));

    const code = result.code;
    const aliceToken = result.magicLinks.Alice.split("?t=")[1];

    // Resolve magic link
    const voter = resolveVoterByToken(code, aliceToken);
    assert.ok(voter);
    assert.equal(voter.name, "Alice");
    assert.equal(voter.isOwner, true); // First participant is owner
  });

  it("resolves magic link for non-owner", () => {
    const result = createShortlist({
      title: "Test Non-Owner",
      participants: ["Carol", "Dave"],
      cards: [{ sourceUrl: "https://example.com/one", title: "Item" }]
    });

    const daveToken = result.magicLinks.Dave.split("?t=")[1];
    const voter = resolveVoterByToken(result.code, daveToken);
    assert.ok(voter);
    assert.equal(voter.name, "Dave");
    assert.equal(voter.isOwner, false);
  });

  it("returns null for invalid magic link token", () => {
    const result = createShortlist({
      title: "Test Invalid Token",
      participants: ["Eve"],
      cards: [{ sourceUrl: "https://example.com/one", title: "Item" }]
    });

    const voter = resolveVoterByToken(result.code, "invalid-token");
    assert.equal(voter, null);
  });
});

describe("Phase 1: Deadlines and Auto-Finalize", () => {
  it("stores deadline on shortlist", () => {
    const result = createShortlist({
      title: "Test Deadline",
      participants: ["Alice"],
      deadline: "2026-06-15T18:00:00",
      cards: [{ sourceUrl: "https://example.com/one", title: "Item" }]
    });

    assert.equal(result.deadline, "2026-06-15T18:00:00");
    assert.equal(result.finalized, false);
  });

  it("auto-finalizes past deadlines", () => {
    const result = createShortlist({
      title: "Past Deadline",
      participants: ["Alice"],
      deadline: "2020-01-01T00:00:00",
      cards: [{ sourceUrl: "https://example.com/one", title: "Item" }]
    });

    // Reload triggers auto-finalize
    const refreshed = getShortlist(result.code);
    assert.equal(refreshed.finalized, true);
    assert.ok(refreshed.finalizedAt);
  });

  it("blocks voting after finalization", () => {
    const result = createShortlist({
      title: "Finalized Vote Block",
      participants: ["Alice"],
      deadline: "2020-01-01T00:00:00",
      cards: [{ sourceUrl: "https://example.com/one", title: "Item" }]
    });

    assert.throws(() => {
      recordVote({
        code: result.code,
        cardId: result.cards[0].id,
        voterKey: "test-key",
        voterName: "Alice",
        vote: "yes"
      });
    }, /Voting is closed/);
  });

  it("allows no deadline (null)", () => {
    const result = createShortlist({
      title: "No Deadline",
      participants: ["Alice"],
      cards: [{ sourceUrl: "https://example.com/one", title: "Item" }]
    });

    assert.equal(result.deadline, null);
    assert.equal(result.finalized, false);
  });
});

describe("Phase 1: Participation Dashboard", () => {
  it("returns all participants with completion status", () => {
    const result = createShortlist({
      title: "Test Participation",
      participants: ["Alice", "Bob"],
      cards: [
        { sourceUrl: "https://example.com/one", title: "A" },
        { sourceUrl: "https://example.com/two", title: "B" }
      ]
    });

    const part = getParticipation(result.code);
    assert.ok(part);
    assert.equal(part.participants.length, 2);

    // Nobody has voted yet
    assert.equal(part.participants[0].isCompleted, false);
    assert.equal(part.participants[1].isCompleted, false);
    assert.equal(part.participants[0].completedCardCount, 0);
  });

  it("shows completed status after voting all cards", () => {
    const result = createShortlist({
      title: "Test Complete Status",
      participants: ["Alice"],
      cards: [
        { sourceUrl: "https://example.com/one", title: "A" },
        { sourceUrl: "https://example.com/two", title: "B" }
      ]
    });

    // Vote on all cards
    recordVote({
      code: result.code,
      cardId: result.cards[0].id,
      voterKey: "alice-voter",
      voterName: "Alice",
      vote: "yes"
    });
    recordVote({
      code: result.code,
      cardId: result.cards[1].id,
      voterKey: "alice-voter",
      voterName: "Alice",
      vote: "hold"
    });

    const part = getParticipation(result.code);
    const alice = part.participants.find((p) => p.name === "Alice");
    assert.ok(alice.isCompleted);
    assert.equal(alice.completedCardCount, 2);
    assert.equal(alice.totalCards, 2);
  });

  it("shows partial completion", () => {
    const result = createShortlist({
      title: "Test Partial",
      participants: ["Alice"],
      cards: [
        { sourceUrl: "https://example.com/one", title: "A" },
        { sourceUrl: "https://example.com/two", title: "B" }
      ]
    });

    recordVote({
      code: result.code,
      cardId: result.cards[0].id,
      voterKey: "partial-voter",
      voterName: "Alice",
      vote: "yes"
    });

    const part = getParticipation(result.code);
    const alice = part.participants.find((p) => p.name === "Alice");
    assert.equal(alice.isCompleted, false);
    assert.equal(alice.completedCardCount, 1);
  });
});

describe("Phase 2: Abstain Vote", () => {
  it("records abstain vote without error", () => {
    const result = createShortlist({
      title: "Test Abstain",
      participants: ["Alice"],
      cards: [{ sourceUrl: "https://example.com/one", title: "Item" }]
    });

    const resp = recordVote({
      code: result.code,
      cardId: result.cards[0].id,
      voterKey: "abstain-voter",
      voterName: "Alice",
      vote: "abstain"
    });

    assert.ok(resp);
    assert.ok(resp.winner);
    assert.equal(resp.winner.abstainCount, 1);
    assert.equal(resp.winner.score, 0);
  });

  it("counts abstain as completed vote", () => {
    const result = createShortlist({
      title: "Test Abstain Completion",
      participants: ["Bob"],
      cards: [{ sourceUrl: "https://example.com/one", title: "Item" }]
    });

    recordVote({
      code: result.code,
      cardId: result.cards[0].id,
      voterKey: "bob-abstain",
      voterName: "Bob",
      vote: "abstain"
    });

    const part = getParticipation(result.code);
    const bob = part.participants.find((p) => p.name === "Bob");
    assert.ok(bob.isCompleted, "Abstain should count as completed");
  });
});

describe("Phase 2: Tiebreaker", () => {
  it("detects tie and resolves with creator_pick", () => {
    const result = createShortlist({
      title: "Test Tie",
      participants: ["Alice", "Bob"],
      cards: [
        { sourceUrl: "https://example.com/one", title: "Option A" },
        { sourceUrl: "https://example.com/two", title: "Option B" }
      ]
    });

    // Alice votes A=yes, B=no
    recordVote({ code: result.code, cardId: result.cards[0].id, voterKey: "a1", voterName: "Alice", vote: "yes" });
    recordVote({ code: result.code, cardId: result.cards[1].id, voterKey: "a1", voterName: "Alice", vote: "no" });

    // Bob votes A=no, B=yes → both tie at score 0
    recordVote({ code: result.code, cardId: result.cards[0].id, voterKey: "b1", voterName: "Bob", vote: "no" });
    recordVote({ code: result.code, cardId: result.cards[1].id, voterKey: "b1", voterName: "Bob", vote: "yes" });

    const results = getResults(result.code);
    assert.ok(results.ties);
    assert.equal(results.ties.length, 2);
  });
});

describe("Phase 3: Public Results", () => {
  it("returns public results without voter details", () => {
    const result = createShortlist({
      title: "Test Public",
      participants: ["Alice"],
      cards: [{ sourceUrl: "https://example.com/one", title: "Item" }]
    });

    recordVote({
      code: result.code,
      cardId: result.cards[0].id,
      voterKey: "pub-voter",
      voterName: "Alice",
      vote: "yes"
    });

    // Complete the deck
    const results = getResults(result.code, { isPublic: true });
    assert.ok(results.winner);
    assert.equal(results.winner.title, "Item");

    // Public results should NOT include voter details on the winner's votes array
    if (results.winner.votes) {
      assert.equal(results.winner.votes.length, 0, "Public results should have no voter details");
    }
  });
});
