const state = {
  shortlist: null,
  results: null,
  currentIndex: 0,
  votedCardIds: new Set(),
  routeScreen: "create"
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

init().catch((error) => {
  console.error(error);
  setStatus("Could not start. Refresh and try again.");
});

async function init() {
  wireControls();
  const initialRoute = parseRoute();
  const savedCode = initialRoute.code || localStorage.getItem("swipe-shortlist-code");
  if (savedCode) {
    const existing = await api(`/api/shortlists/${encodeURIComponent(savedCode)}`, { allow404: true });
    if (existing) {
      state.shortlist = existing;
      loadLocalVotes();
    }
  }

  if (!state.shortlist) {
    state.shortlist = await api("/api/shortlists", {
      method: "POST",
      body: JSON.stringify({})
    });
    localStorage.setItem("swipe-shortlist-code", state.shortlist.code);
    loadLocalVotes();
  }

  renderAll();
  await handleRoute();
}

function wireControls() {
  window.addEventListener("hashchange", () => {
    handleRoute().catch((error) => {
      console.error(error);
      setStatus("Could not open that link.");
    });
  });

  $("[data-paste-clipboard]")?.addEventListener("click", async () => {
    const input = $("[data-link-input]");
    try {
      const text = await navigator.clipboard?.readText();
      input.value = text || "";
      input.classList.remove("is-hidden");
      const count = extractLinks(input.value).length;
      setStatus(count ? `${count} links pasted. Create the voting link when ready.` : "Clipboard did not contain links.");
    } catch {
      input.classList.remove("is-hidden");
      input.focus();
      setStatus("Paste links into the box, then create the voting link.");
    }
  });

  $("[data-focus-links]")?.addEventListener("click", () => {
    const input = $("[data-link-input]");
    input?.classList.remove("is-hidden");
    input?.focus();
  });

  $$("[data-create-shortlist]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      setStatus("Creating private voting link...");
      try {
        const links = linksFromInput();
        state.shortlist = await api("/api/shortlists", {
          method: "POST",
          body: JSON.stringify({ links })
        });
        state.results = null;
        state.currentIndex = 0;
        state.votedCardIds.clear();
        localStorage.setItem("swipe-shortlist-code", state.shortlist.code);
        saveLocalVotes();
        renderAll();
        setStatus(links.length ? `Imported ${links.length} links. Private link ready: ${shareUrl()}` : `Demo link ready: ${shareUrl()}`);
        location.hash = routeHash("vote");
      } finally {
        button.disabled = false;
      }
    });
  });

  $$("[data-vote]").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = currentCard();
      if (!card || !state.shortlist) return;
      button.disabled = true;
      try {
        state.results = await api(`/api/shortlists/${encodeURIComponent(state.shortlist.code)}/votes`, {
          method: "POST",
          body: JSON.stringify({
            cardId: card.id,
            voterName: "You",
            vote: button.dataset.vote
          })
        });
        state.votedCardIds.add(card.id);
        saveLocalVotes();
        $("[data-vote-status]").textContent = `${voteLabel(button.dataset.vote)} saved for ${card.title}`;
        advanceCard();
      } finally {
        button.disabled = false;
      }
    });
  });

  $$("[data-screen-target]").forEach((button) => {
    button.addEventListener("click", () => {
      location.hash = routeHash(button.dataset.screenTarget);
    });
  });

  $$("[data-note]").forEach((button) => {
    button.addEventListener("click", () => setStatus(button.dataset.note));
  });

  $("[data-send-final]")?.addEventListener("click", async () => {
    if (!hasVotedLocally()) {
      $("[data-send-status]").textContent = "Vote first, then send the final pick.";
      location.hash = routeHash("vote");
      return;
    }
    const winner = state.results?.winner || (await loadResults()).winner;
    const text = `${winner.title} is the final pick: ${winner.sourceUrl}`;
    try {
      await navigator.clipboard?.writeText(text);
      $("[data-send-status]").textContent = "Final pick copied for the group chat.";
    } catch {
      $("[data-send-status]").textContent = text;
    }
  });
}

function renderAll() {
  if (!state.shortlist) return;
  $$("[data-code]").forEach((node) => {
    node.textContent = state.shortlist.code;
  });
  $$("[data-title]").forEach((node) => {
    node.textContent = state.shortlist.title;
  });
  renderPreview();
  renderVoters();
  renderVoteContext();
  renderCurrentCard();
}

function renderPreview() {
  const list = $("[data-preview-list]");
  $("[data-found-count]").textContent = `${state.shortlist.cards.length} cards ready enough to vote`;
  $("[data-found-note]").textContent = state.shortlist.cards.some((card) => card.priceLabel === "Price to verify")
    ? "Imported links need facts checked before booking."
    : "3 cards need details checked later.";
  list.innerHTML = state.shortlist.cards
    .slice(0, 3)
    .map(
      (card) => `
        <article class="preview-row">
          <img src="${escapeAttr(card.imagePath)}" alt="" />
          <div>
            <strong>${escapeHtml(card.title)}</strong>
            <span>${escapeHtml(card.location)} · ${escapeHtml(card.priceLabel)}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function renderVoters() {
  const chips = $("[data-voter-chips]");
  const avatars = $("[data-avatar-dots]");
  const chipMarkup = state.shortlist.voters.map((voter) => `<span class="chip">${escapeHtml(voter.name)}</span>`).join("");
  const avatarMarkup = state.shortlist.voters.map((voter) => `<span class="avatar">${escapeHtml(voter.initials)}</span>`).join("");
  chips.innerHTML = chipMarkup;
  avatars.innerHTML = avatarMarkup;
}

function renderVoteContext() {
  const node = $("[data-vote-context]");
  if (hasVotedLocally()) {
    node.textContent = `${state.shortlist.votedCount} people have voted · aim for 21:00`;
  } else {
    node.textContent = "Private until you choose · aim for 21:00";
  }
  $(".progress").textContent = `${Math.min(state.currentIndex + 1, state.shortlist.cards.length)} / ${state.shortlist.cards.length}`;
}

function renderCurrentCard() {
  const card = currentCard();
  const target = $("[data-current-card]");
  if (!card) {
    target.innerHTML = `
      <div class="card-body">
        <span class="domain">done</span>
        <h2>All cards voted</h2>
        <p class="trust">Results are ready. The group sees one final pick, not another debate.</p>
      </div>
    `;
    return;
  }

  target.innerHTML = `
    <img src="${escapeAttr(card.imagePath)}" alt="" />
    <div class="card-body">
      <span class="domain">${escapeHtml(card.sourceDomain)}</span>
      <h2>${escapeHtml(card.title)}</h2>
      <strong class="price">${escapeHtml(card.priceLabel)}</strong>
      <span class="location">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
        ${escapeHtml(card.location)}
      </span>
      <div class="fact-row">
        ${card.facts.map((fact) => `<span class="fact">${escapeHtml(fact)}</span>`).join("")}
      </div>
      <span class="trust">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>
        ${escapeHtml(card.trustLabel)}
      </span>
    </div>
  `;
}

async function renderResults() {
  if (!hasVotedLocally()) {
    renderLockedResults();
    return;
  }
  if (!state.results) {
    await loadResults();
  }
  if (state.results?.locked) {
    renderLockedResults();
    return;
  }
  const winner = state.results?.winner;
  if (!winner) return;

  $("[data-result-state]").innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg> Voting complete`;
  $("[data-result-heading]").textContent = `${winner.title} wins`;
  $("[data-send-final]").innerHTML = `Send final pick <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 3-7.5 18-4-8.5L1 8.5 21 3Z" /></svg>`;
  $("[data-winner-card]").innerHTML = `
    <img src="${escapeAttr(winner.imagePath)}" alt="" />
    <div class="winner-body">
      <span class="domain">${escapeHtml(winner.sourceDomain)}</span>
      <h3>${escapeHtml(winner.title)}</h3>
      <strong class="price">${escapeHtml(winner.priceLabel)}</strong>
      <span class="location">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
        ${escapeHtml(winner.location)}
      </span>
      <div class="score-row">
        <span class="score"><strong>${winner.yesCount}</strong><span>yes</span></span>
        <span class="score"><strong>${winner.holdCount}</strong><span>hold</span></span>
        <span class="score"><strong>${winner.noCount}</strong><span>no</span></span>
      </div>
    </div>
  `;
  $("[data-backup-row]")?.classList.remove("is-hidden");
}

async function loadResults() {
  if (!state.shortlist) return null;
  state.results = await api(`/api/shortlists/${encodeURIComponent(state.shortlist.code)}/results?voterName=${encodeURIComponent("You")}`, {
    allowForbidden: true
  });
  return state.results;
}

function currentCard() {
  return state.shortlist?.cards[state.currentIndex] || null;
}

function advanceCard() {
  state.currentIndex += 1;
  if (state.currentIndex >= state.shortlist.cards.length) {
    renderVoteContext();
    renderCurrentCard();
    renderResults().then(() => {
      location.hash = routeHash("result");
    });
    return;
  }
  renderVoteContext();
  renderCurrentCard();
}

async function handleRoute() {
  const route = parseRoute();
  if (route.code && (!state.shortlist || state.shortlist.code !== route.code)) {
    const existing = await api(`/api/shortlists/${encodeURIComponent(route.code)}`, { allow404: true });
    if (existing) {
      state.shortlist = existing;
      state.results = null;
      state.currentIndex = 0;
      localStorage.setItem("swipe-shortlist-code", state.shortlist.code);
      loadLocalVotes();
      renderAll();
    }
  }
  showScreen(route.screen);
}

function showScreen(name) {
  const allowed = new Set(["create", "vote", "result"]);
  const next = allowed.has(name) ? name : "create";
  state.routeScreen = next;
  $$("[data-screen]").forEach((screen) => {
    screen.classList.toggle("is-active", screen.dataset.screen === next);
  });
  if (next === "result") renderResults();
}

async function api(path, options = {}) {
  const { allow404 = false, allowForbidden = false, ...fetchOptions } = options;
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(fetchOptions.headers || {})
    },
    ...fetchOptions
  });
  if (allow404 && response.status === 404) return null;
  if (allowForbidden && response.status === 403) return { locked: true };
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function setStatus(message) {
  const node = $("[data-status]");
  if (node) node.textContent = message;
}

function shareUrl() {
  return `${location.origin}${routeHash("vote")}`;
}

function voteLabel(vote) {
  return vote === "no" ? "No" : vote === "hold" ? "Hold" : "Yes";
}

function linksFromInput() {
  return extractLinks($("[data-link-input]")?.value || "");
}

function extractLinks(text) {
  return Array.from(new Set((text.match(/https?:\/\/[^\s<>"']+/g) || []).map((url) => url.replace(/[),.;]+$/g, ""))));
}

function renderLockedResults() {
  $("[data-result-state]").innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h.01" /><path d="M12 4v12" /></svg> Private result`;
  $("[data-result-heading]").textContent = "Vote first, then see the winner";
  $("[data-send-final]").innerHTML = `Vote first <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>`;
  $("[data-winner-card]").innerHTML = `
    <div class="winner-body">
      <span class="domain">private result</span>
      <h3>Your vote is still hidden</h3>
      <span class="trust">Choose No, Hold, or Yes on at least one card before group results are revealed.</span>
    </div>
  `;
  $("[data-backup-row]")?.classList.add("is-hidden");
  $("[data-send-status]").textContent = "Results open after your vote";
}

function hasVotedLocally() {
  return state.votedCardIds.size > 0;
}

function voteStorageKey() {
  return state.shortlist ? `swipe-shortlist-votes-${state.shortlist.code}` : "swipe-shortlist-votes";
}

function loadLocalVotes() {
  try {
    state.votedCardIds = new Set(JSON.parse(localStorage.getItem(voteStorageKey()) || "[]"));
  } catch {
    state.votedCardIds = new Set();
  }
}

function saveLocalVotes() {
  localStorage.setItem(voteStorageKey(), JSON.stringify(Array.from(state.votedCardIds)));
}

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const screen = parts[0] || "create";
  const code = parts[1] || new URLSearchParams(location.search).get("code") || "";
  return { screen, code };
}

function routeHash(screen) {
  const code = state.shortlist?.code;
  return code ? `#/${screen}/${encodeURIComponent(code)}` : `#/${screen}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
