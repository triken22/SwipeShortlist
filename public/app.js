const state = {
  shortlist: null,
  results: null,
  currentIndex: 0,
  votedCardIds: new Set(),
  isVoting: false,
  lastVote: null,
  drag: null,
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
      renderPreview();
      setStatus(count ? `${count} links pasted. Create the voting link when ready.` : "Clipboard did not contain links.");
    } catch {
      input.classList.remove("is-hidden");
      input.focus();
      setStatus("Paste links into the box, then create the voting link.");
    }
  });

  $("[data-link-input]")?.addEventListener("input", () => {
    renderPreview();
    const count = linksFromInput().length;
    if (count) setStatus(`${count} links ready to import.`);
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
      } catch (error) {
        console.error(error);
        setStatus("Could not create the link. Check the pasted URLs and try again.");
      } finally {
        button.disabled = false;
      }
    });
  });

  $$("[data-vote]").forEach((button) => {
    button.addEventListener("click", async () => {
      await castVote(button.dataset.vote);
    });
  });

  $("[data-undo-vote]")?.addEventListener("click", undoLastVote);

  $$("[data-copy-link]").forEach((button) => {
    button.addEventListener("click", copyShareLink);
  });

  const card = $("[data-current-card]");
  card?.addEventListener("pointerdown", handleCardPointerDown);
  card?.addEventListener("pointermove", handleCardPointerMove);
  card?.addEventListener("pointerup", handleCardPointerUp);
  card?.addEventListener("pointercancel", resetDrag);

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
    const loaded = state.results?.winner ? state.results : await loadResults();
    if (loaded?.locked || !loaded?.winner) {
      renderLockedResults();
      return;
    }
    const winner = loaded.winner;
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
  const importedLinks = linksFromInput();
  const cards = importedLinks.length ? previewCardsFromLinks(importedLinks) : state.shortlist.cards;
  $("[data-found-count]").textContent = importedLinks.length
    ? `${cards.length} pasted links ready to become cards`
    : `${state.shortlist.cards.length} cards ready enough to vote`;
  $("[data-found-note]").textContent = importedLinks.length
    ? "We will keep prices unverified until the source is checked."
    : state.shortlist.cards.some((card) => card.priceLabel === "Price to verify")
      ? "Imported links need facts checked before booking."
      : "Demo cards need details checked later.";
  list.innerHTML = cards
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
    const votedCount = Math.max(Number(state.shortlist.votedCount || 0), 1);
    node.textContent = `${votedCount} ${votedCount === 1 ? "person has" : "people have"} voted · aim for 21:00`;
  } else {
    node.textContent = "Private until you choose · aim for 21:00";
  }
  $(".progress").textContent = `${Math.min(state.currentIndex + 1, state.shortlist.cards.length)} / ${state.shortlist.cards.length}`;
}

function renderCurrentCard() {
  const card = currentCard();
  const target = $("[data-current-card]");
  resetDrag();
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
  const voteMarkup = winner.votes?.length
    ? `<div class="voter-result-row">${winner.votes
        .map(
          (vote) => `
            <span class="voter-result">
              <span class="avatar">${escapeHtml(vote.voter?.initials || "?")}</span>
              <span><strong>${escapeHtml(vote.voter?.name || "Voter")}</strong><em>${escapeHtml(voteLabel(vote.vote))}</em></span>
            </span>
          `
        )
        .join("")}</div>`
    : "";

  $("[data-result-state]").innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg> Voting complete`;
  $("[data-result-topbar]").textContent = "Voting complete";
  $("[data-result-heading]").textContent = `${winner.title} wins`;
  $("[data-result-subheading]").textContent = "Everyone can live with this pick. Send it and stop the thread.";
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
      ${voteMarkup}
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

async function castVote(vote) {
  const card = currentCard();
  if (!card || !state.shortlist || state.isVoting) return;
  state.isVoting = true;
  setVoteControlsDisabled(true);
  try {
    state.results = await api(`/api/shortlists/${encodeURIComponent(state.shortlist.code)}/votes`, {
      method: "POST",
      body: JSON.stringify({
        cardId: card.id,
        voterName: "You",
        vote
      })
    });
    state.lastVote = { cardId: card.id, cardTitle: card.title, index: state.currentIndex, vote };
    state.votedCardIds.add(card.id);
    saveLocalVotes();
    $("[data-vote-status]").textContent = `${voteLabel(vote)} saved for ${card.title}`;
    showUndo();
    advanceCard();
  } catch (error) {
    console.error(error);
    $("[data-vote-status]").textContent = "Vote was not saved. Try again.";
  } finally {
    state.isVoting = false;
    setVoteControlsDisabled(false);
  }
}

async function undoLastVote() {
  if (!state.lastVote || !state.shortlist || state.isVoting) return;
  state.isVoting = true;
  setVoteControlsDisabled(true);
  try {
    const undone = state.lastVote;
    state.results = await api(`/api/shortlists/${encodeURIComponent(state.shortlist.code)}/votes`, {
      method: "DELETE",
      body: JSON.stringify({
        cardId: undone.cardId,
        voterName: "You"
      })
    });
    state.votedCardIds.delete(undone.cardId);
    state.currentIndex = undone.index;
    state.lastVote = null;
    saveLocalVotes();
    hideUndo();
    $("[data-vote-status]").textContent = `Removed your vote for ${undone.cardTitle}.`;
    renderVoteContext();
    renderCurrentCard();
  } catch (error) {
    console.error(error);
    $("[data-vote-status]").textContent = "Could not undo that vote.";
  } finally {
    state.isVoting = false;
    setVoteControlsDisabled(false);
  }
}

function setVoteControlsDisabled(disabled) {
  $$("[data-vote], [data-undo-vote]").forEach((button) => {
    button.disabled = disabled;
  });
}

function showUndo() {
  $("[data-undo-vote]")?.classList.remove("is-hidden");
}

function hideUndo() {
  $("[data-undo-vote]")?.classList.add("is-hidden");
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

function handleCardPointerDown(event) {
  if (!currentCard() || state.isVoting) return;
  state.drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    dx: 0,
    dy: 0
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
  event.currentTarget.classList.add("is-dragging");
}

function handleCardPointerMove(event) {
  if (!state.drag || state.drag.pointerId !== event.pointerId) return;
  const dx = event.clientX - state.drag.startX;
  const dy = event.clientY - state.drag.startY;
  state.drag.dx = dx;
  state.drag.dy = dy;
  const rotation = Math.max(-9, Math.min(9, dx / 18));
  const target = event.currentTarget;
  target.style.transform = `translate(${dx}px, ${dy * 0.25}px) rotate(${rotation}deg)`;
  target.dataset.swipeIntent = Math.abs(dx) > 42 ? (dx > 0 ? "yes" : "no") : Math.abs(dy) > 56 && dy < 0 ? "hold" : "";
}

async function handleCardPointerUp(event) {
  if (!state.drag || state.drag.pointerId !== event.pointerId) return;
  const { dx, dy } = state.drag;
  resetDrag();
  if (Math.abs(dx) > 86) {
    await castVote(dx > 0 ? "yes" : "no");
    return;
  }
  if (dy < -96) {
    await castVote("hold");
  }
}

function resetDrag() {
  const target = $("[data-current-card]");
  state.drag = null;
  if (!target) return;
  target.classList.remove("is-dragging");
  target.style.transform = "";
  target.dataset.swipeIntent = "";
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
  if (next === "result") {
    renderResults().catch((error) => {
      console.error(error);
      renderLockedResults();
    });
  }
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
  if (vote === "no") return "No";
  if (vote === "hold") return "Hold";
  if (vote === "strong_yes") return "Strong yes";
  return "Yes";
}

function linksFromInput() {
  return extractLinks($("[data-link-input]")?.value || "");
}

function extractLinks(text) {
  return Array.from(new Set((text.match(/https?:\/\/[^\s<>"']+/g) || []).map((url) => url.replace(/[),.;]+$/g, ""))));
}

async function copyShareLink() {
  if (!state.shortlist) return;
  const text = shareUrl();
  try {
    await navigator.clipboard?.writeText(text);
    setStatus(`Voting link copied: ${text}`);
  } catch {
    setStatus(text);
  }
}

function previewCardsFromLinks(links) {
  return links.map((link) => {
    try {
      const url = new URL(link);
      return {
        title: titleFromUrl(url),
        sourceDomain: sourceDomain(url),
        location: "Open source link",
        priceLabel: "Price to verify",
        imagePath: "/assets/beach-thumb.png"
      };
    } catch {
      return {
        title: "Invalid link",
        sourceDomain: "Check URL",
        location: "Paste a full https:// link",
        priceLabel: "Not imported",
        imagePath: "/assets/mare-thumb.png"
      };
    }
  });
}

function sourceDomain(url) {
  return url.hostname.replace(/^www\./, "");
}

function titleFromUrl(url) {
  const pathBits = url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/\.[a-z0-9]+$/i, ""))
    .filter(Boolean);
  const raw = pathBits.at(-1) || sourceDomain(url);
  const title = raw.replace(/[-_+]+/g, " ").replace(/\s+/g, " ").trim();
  return title ? title.replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 72) : "Imported link";
}

function renderLockedResults() {
  $("[data-result-state]").innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h.01" /><path d="M12 4v12" /></svg> Private result`;
  $("[data-result-topbar]").textContent = "Private result";
  $("[data-result-heading]").textContent = "Vote first, then see the winner";
  $("[data-result-subheading]").textContent = "Your choice stays private and unlocks the group answer.";
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
