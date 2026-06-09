const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:8092";
const voterKey = `smoke-${Date.now()}`;

const emptyCreate = await requestRaw("/api/shortlists", {
  method: "POST",
  body: JSON.stringify({})
});
assert(emptyCreate.status === 400, "empty create is rejected instead of seeding placeholder data");

const created = await request("/api/shortlists", {
  method: "POST",
  body: JSON.stringify({
    links: [
      "https://example.org/family-hotel",
      "https://example.net/beach-apartment",
      "https://example.com/restaurant-shortlist"
    ]
  })
});
assert(created.code, "created shortlist has a code");
assert(created.cards.length === 3, "pasted links become exactly three cards");
assert(created.voters.length === 0, "created shortlist has no fake voters");
assert(created.cards.every((card) => card.priceLabel === "Price to verify"), "imported cards do not fake price certainty");

const loaded = await request(`/api/shortlists/${encodeURIComponent(created.code)}`);
assert(loaded.title === "Private shortlist", "loaded shortlist title matches");

const lockedBeforeVote = await request(`/api/shortlists/${encodeURIComponent(created.code)}/results?voterKey=${encodeURIComponent(voterKey)}&voterName=You`);
assert(lockedBeforeVote.locked === true, "results are locked before this user votes");

const partialVoteResponse = await request(`/api/shortlists/${encodeURIComponent(created.code)}/votes`, {
  method: "POST",
  body: JSON.stringify({
    cardId: loaded.cards[0].id,
    voterKey,
    voterName: "You",
    vote: "no"
  })
});
assert(partialVoteResponse.locked === true, "partial vote response does not expose results");
assert(!partialVoteResponse.winner, "partial vote response hides winner payload");
assert(partialVoteResponse.shortlist?.cards?.length === 3, "partial vote response keeps safe shortlist progress");

const lockedAfterPartialVote = await request(`/api/shortlists/${encodeURIComponent(created.code)}/results?voterKey=${encodeURIComponent(voterKey)}&voterName=You`);
assert(lockedAfterPartialVote.locked === true, "results stay locked until this user completes the deck");

for (const card of loaded.cards.slice(1)) {
  await request(`/api/shortlists/${encodeURIComponent(created.code)}/votes`, {
    method: "POST",
    body: JSON.stringify({
      cardId: card.id,
      voterKey,
      voterName: "You",
      vote: card === loaded.cards[1] ? "yes" : "hold"
    })
  });
}

const results = await request(`/api/shortlists/${encodeURIComponent(created.code)}/results?voterKey=${encodeURIComponent(voterKey)}&voterName=You`);
assert(results.winner?.title, "results include a winner");
assert(results.backups.length >= 1, "results include backup options");
assert(results.winner.title === loaded.cards[1].title, "vote ranking chooses the real highest scoring card");

await request(`/api/shortlists/${encodeURIComponent(created.code)}/votes`, {
  method: "DELETE",
  body: JSON.stringify({
    cardId: loaded.cards[1].id,
    voterKey,
    voterName: "You"
  })
});

const afterUndo = await request(`/api/shortlists/${encodeURIComponent(created.code)}/results?voterKey=${encodeURIComponent(voterKey)}&voterName=You`);
assert(afterUndo.locked === true, "undoing a completed deck locks results again");

console.log(`smoke ok: ${created.code} winner=${results.winner.title}`);

async function request(path, options = {}) {
  const response = await requestRaw(path, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${path}: ${text}`);
  }
  return response.json();
}

async function requestRaw(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    headers: { "content-type": "application/json" },
    ...options
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
