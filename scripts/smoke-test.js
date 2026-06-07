const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:8092";

const created = await request("/api/shortlists", {
  method: "POST",
  body: JSON.stringify({})
});

assert(created.code, "created shortlist has a code");
assert(created.cards.length >= 3, "created shortlist has cards");
assert(created.voters.length >= 4, "created shortlist has voters");

const loaded = await request(`/api/shortlists/${encodeURIComponent(created.code)}`);
assert(loaded.title === "Summer hotels", "loaded shortlist title matches");

for (const card of loaded.cards) {
  await request(`/api/shortlists/${encodeURIComponent(created.code)}/votes`, {
    method: "POST",
    body: JSON.stringify({
      cardId: card.id,
      voterName: "You",
      vote: card === loaded.cards[0] ? "yes" : "hold"
    })
  });
}

const results = await request(`/api/shortlists/${encodeURIComponent(created.code)}/results?voterName=You`);
assert(results.winner?.title, "results include a winner");
assert(results.backups.length >= 1, "results include backup options");

console.log(`smoke ok: ${created.code} winner=${results.winner.title}`);

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "content-type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${path}: ${text}`);
  }
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
