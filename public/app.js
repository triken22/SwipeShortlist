const state = {
  shortlist: null,
  results: null,
  draftCards: [],
  currentIndex: 0,
  votedCardIds: new Set(),
  voterKey: "",
  voterName: "You",
  isVoting: false,
  lastVote: null,
  showShareFlow: false,
  drag: null,
  routeScreen: "create"
};

const DEFAULT_TITLE = "Private shortlist";
const DEFAULT_CARD_IMAGE = "/assets/link-card.svg";
const RETIRED_IMAGE_PATHS = new Set(["/assets/mare-blu.png", "/assets/beach-thumb.png", "/assets/mare-thumb.png"]);

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

init().catch((error) => {
  console.error(error);
  setStatus("Could not start. Refresh and try again.");
});

async function init() {
  wireControls();
  const initialRoute = parseRoute();
  if (initialRoute.code) {
    await loadShortlist(initialRoute.code);
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
      if (!text) {
        setStatus("Clipboard was empty. Paste links into the box.");
        return;
      }
      input.value = text || "";
      input.classList.remove("is-hidden");
      state.draftCards = parseMessyText(text);
      renderReviewCards();
      const count = state.draftCards.filter(isSubmittableDraftCard).length;
      setStatus(count ? `${count} option${count !== 1 ? "s" : ""} extracted. Review and create the voting link.` : "Paste at least one full http or https link.");
    } catch {
      input.classList.remove("is-hidden");
      input.focus();
      setStatus("Paste links into the box, then create the voting link.");
    }
  });

  $("[data-link-input]")?.addEventListener("input", () => {
    state.draftCards = parseMessyText($("[data-link-input]")?.value || "");
    renderReviewCards();
    const count = state.draftCards.filter(isSubmittableDraftCard).length;
    if (count) {
      setStatus(`${count} option${count !== 1 ? "s" : ""} extracted. Review and create the voting link.`);
    } else {
      setStatus("Paste at least one full http or https link.");
    }
  });

  $("[data-focus-links]")?.addEventListener("click", () => {
    const input = $("[data-link-input]");
    input?.classList.remove("is-hidden");
    input?.focus();
  });

  $("[data-review-list]")?.addEventListener("input", (event) => {
    const target = event.target;
    const index = Number(target.dataset?.cardIndex);
    const field = target.dataset?.cardField;
    if (isNaN(index) || !field || index >= state.draftCards.length) return;
    if (field === "facts") {
      state.draftCards[index].facts = target.value.split("\n").map((f) => f.trim()).filter(Boolean);
    } else {
      state.draftCards[index][field] = target.value;
    }
    updateCreateActions(state.draftCards.filter(isSubmittableDraftCard).length > 0);
  });

  $("[data-review-list]")?.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-card]");
    if (!remove) return;
    const index = Number(remove.dataset.removeCard);
    if (isNaN(index) || index >= state.draftCards.length) return;
    state.draftCards.splice(index, 1);
    renderReviewCards();
    const remaining = state.draftCards.filter(isSubmittableDraftCard).length;
    setStatus(remaining ? `Removed. ${remaining} option${remaining !== 1 ? "s" : ""} remaining.` : "No options left. Paste links to add more.");
  });

  $$("[data-create-shortlist]").forEach((button) => {
    button.addEventListener("click", async () => {
      const cards = draftCardsFromState();
      if (!cards.length) {
        const input = $("[data-link-input]");
        input?.classList.remove("is-hidden");
        input?.focus();
        setStatus("Paste at least one valid http or https link first.");
        renderReviewCards();
        return;
      }

      button.disabled = true;
      setStatus("Creating private voting link...");
      try {
        state.shortlist = await api("/api/shortlists", {
          method: "POST",
          body: JSON.stringify({ cards })
        });
        state.draftCards = [];
        state.results = null;
        state.currentIndex = 0;
        state.votedCardIds.clear();
        state.voterKey = getOrCreateVoterKey(state.shortlist.code);
        state.voterName = loadVoterName(state.shortlist.code);
        state.showShareFlow = true;
        localStorage.setItem("swipe-shortlist-last-code", state.shortlist.code);
        saveLocalVotes();
        renderAll();
        setStatus(`Created with ${cards.length} option${cards.length !== 1 ? "s" : ""}. Private link ready: ${shareUrl()}`);
        location.hash = routeHash("vote");
      } catch (error) {
        console.error(error);
        setStatus(error.message.includes("400") ? "Paste at least one valid http or https link." : "Could not create the link. Try again.");
      } finally {
        renderReviewCards();
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

  $("[data-share-copy]")?.addEventListener("click", async () => {
    await copyShareLink();
    const btn = $("[data-share-copy]");
    btn.textContent = "Copied";
    setTimeout(() => {
      btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="10" width="12" height="9" rx="2" /><path d="M8 10V8a4 4 0 0 1 8 0v2" /></svg> Copy voting link`;
    }, 2000);
  });

  $("[data-share-dismiss]")?.addEventListener("click", () => {
    state.showShareFlow = false;
    renderAll();
    setStatus("Your voting link is ready. Share it from the code pill at the top.");
  });

  $("[data-voter-name]")?.addEventListener("input", (event) => {
    if (!state.shortlist) return;
    state.voterName = event.target.value.trim() || "You";
    localStorage.setItem(voterNameStorageKey(state.shortlist.code), state.voterName);
  });

  const card = $("[data-current-card]");
  card?.addEventListener("pointerdown", handleCardPointerDown);
  card?.addEventListener("pointermove", handleCardPointerMove);
  card?.addEventListener("pointerup", handleCardPointerUp);
  card?.addEventListener("pointercancel", resetDrag);
  window.addEventListener("pointerup", handleCardPointerUp);
  window.addEventListener("pointercancel", resetDrag);

  $$("[data-screen-target]").forEach((button) => {
    button.addEventListener("click", () => {
      location.hash = routeHash(button.dataset.screenTarget);
    });
  });

  $$("[data-note]").forEach((button) => {
    button.addEventListener("click", () => setStatus(button.dataset.note));
  });

  $("[data-send-final]")?.addEventListener("click", async () => {
    const loaded = state.results?.winner ? state.results : await loadResults();
    if (loaded?.locked || !loaded?.winner) {
      renderLockedResults();
      return;
    }
    const text = loaded.rationale?.copyText || `${loaded.winner.title} is the final pick: ${loaded.winner.sourceUrl}`;
    try {
      await navigator.clipboard?.writeText(text);
      const btn = $("[data-send-final]");
      btn.innerHTML = `Copied <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>`;
      setTimeout(() => {
        btn.innerHTML = `Copy final pick <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="10" width="12" height="9" rx="2" /><path d="M8 10V8a4 4 0 0 1 8 0v2" /></svg>`;
      }, 2000);
      $("[data-send-status]").textContent = "Copied! Paste it into your group chat.";
    } catch {
      $("[data-send-status]").textContent = text;
    }
  });
}

function renderAll() {
  $$("[data-code]").forEach((node) => {
    node.textContent = state.shortlist?.code || "New";
    if (node.tagName === "BUTTON") node.disabled = !state.shortlist;
  });
  $$("[data-title]").forEach((node) => {
    node.textContent = state.shortlist?.title || DEFAULT_TITLE;
  });
  renderIdentity();
  renderReviewCards();
  renderVoters();
  renderVoteContext();
  renderShareBanner();
  renderCurrentCard();
}

function renderPreview() {
  const list = $("[data-preview-list]");
  const importedLinks = linksFromInput();
  const cards = importedLinks.length ? previewCardsFromLinks(importedLinks) : [];

  $("[data-found-count]").textContent = importedLinks.length
    ? `${cards.length} pasted ${cards.length === 1 ? "link is" : "links are"} ready`
    : "Paste links to create cards";
  $("[data-found-note]").textContent = importedLinks.length
    ? "Prices and facts stay unverified until someone opens the source."
    : "Nothing is stored until you create a private voting link.";

  list.innerHTML = cards.length
    ? cards
    .slice(0, 3)
    .map(
      (card) => `
        <article class="preview-row">
          ${cardMediaMarkup(card, "preview-media")}
          <div>
            <strong>${escapeHtml(card.title)}</strong>
            <span>${escapeHtml(card.location)} · ${escapeHtml(card.priceLabel)}</span>
          </div>
        </article>
      `
    )
    .join("")
    : `<div class="empty-preview">Add one or more links from the group chat.</div>`;

  updateCreateActions(importedLinks.length > 0);
}

function renderVoters() {
  const chips = $("[data-voter-chips]");
  const avatars = $("[data-avatar-dots]");
  const voters = state.shortlist?.voters || [];
  chips.innerHTML = voters.length
    ? voters.map((voter) => `<span class="chip">${escapeHtml(voter.name)}</span>`).join("")
    : `<span class="chip">One private link</span><span class="chip">No accounts</span>`;
  avatars.innerHTML = voters.length
    ? voters.map((voter) => `<span class="avatar">${escapeHtml(voter.initials)}</span>`).join("")
    : `<span class="avatar">Y</span>`;
}

function renderVoteContext() {
  const node = $("[data-vote-context]");
  const progressNode = $(".progress");
  if (!state.shortlist) {
    node.textContent = "Open a private voting link to start.";
    if (progressNode) progressNode.textContent = "0 / 0";
    return;
  }

  const total = state.shortlist.cards.length;
  const saved = state.votedCardIds.size;
  if (saved >= total) {
    const completed = Math.max(Number(state.shortlist.completedVoterCount || 0), 1);
    node.textContent = `Your deck is done · ${completed} ${completed === 1 ? "person" : "people"} finished`;
  } else if (saved > 0) {
    node.textContent = `${saved}/${total} choices saved · results unlock after the deck`;
  } else {
    node.textContent = "Private until your deck is done";
  }
  if (progressNode) progressNode.textContent = `${Math.min(state.currentIndex + 1, total)} / ${total}`;
}

function renderCurrentCard() {
  const card = currentCard();
  const target = $("[data-current-card]");
  resetDrag();
  if (!state.shortlist) {
    target.innerHTML = `
      <div class="card-body is-empty-card">
        <span class="domain">No shortlist loaded</span>
        <h2>Paste links to start</h2>
        <p class="trust">Create a private link first, then the vote deck appears here.</p>
      </div>
    `;
    return;
  }

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
    ${cardMediaMarkup(card, "card-media")}
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
      <a class="source-link" href="${escapeAttr(card.sourceUrl)}" target="_blank" rel="noreferrer noopener">
        Open source link
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7" /><path d="M8 7h9v9" /></svg>
      </a>
    </div>
  `;
}

async function renderResults() {
  await loadResults();
  if (state.results?.locked) {
    renderLockedResults();
    return;
  }
  const winner = state.results?.winner;
  if (!winner) return;
  const rationale = state.results?.rationale;
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

  const rationaleClass = rationale?.tied ? "is-tied" : rationale?.summary === "vetoed" ? "is-vetoed" : rationale?.summary === "contested" ? "is-contested" : "";
  const stateIcon = rationale?.tied
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h.01"/><path d="M12 4v12"/></svg> Split result`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg> Voting complete`;

  $("[data-result-state]").innerHTML = stateIcon;
  $("[data-result-topbar]").textContent = rationale?.tied ? "Split result" : "Voting complete";
  $("[data-result-heading]").textContent = `${winner.title} ${rationale?.tied ? "is top (tied)" : "wins"}`;
  $("[data-result-subheading]").textContent = rationale?.detail || "Everyone can live with this pick. Send it and stop the thread.";
  $("[data-send-final]").innerHTML = `Copy final pick <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="10" width="12" height="9" rx="2" /><path d="M8 10V8a4 4 0 0 1 8 0v2" /></svg>`;
  $("[data-send-status]").textContent = "Ready to copy for the group chat.";
  $("[data-winner-card]").innerHTML = `
    ${cardMediaMarkup(winner, "winner-media")}
    <div class="winner-body">
      <span class="domain">${escapeHtml(winner.sourceDomain)}</span>
      <h3>${escapeHtml(winner.title)}</h3>
      <strong class="price">${escapeHtml(winner.priceLabel)}</strong>
      <span class="location">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
        ${escapeHtml(winner.location)}
      </span>
      ${voteMarkup}
      <div class="score-row ${rationaleClass}">
        <span class="score"><strong>${winner.yesCount}</strong><span>yes</span></span>
        <span class="score"><strong>${winner.holdCount}</strong><span>hold</span></span>
        <span class="score"><strong>${winner.noCount}</strong><span>no</span></span>
      </div>
      <div class="rationale-box">
        <p>${escapeHtml(rationale?.detail || "")}</p>
      </div>
      <a class="source-link" href="${escapeAttr(winner.sourceUrl)}" target="_blank" rel="noreferrer noopener">
        Open final link
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7" /><path d="M8 7h9v9" /></svg>
      </a>
    </div>
  `;
  $("[data-backup-row]")?.classList.toggle("is-hidden", !state.results?.backups?.length);
  if (state.results?.backups?.length) {
    const backup = state.results.backups[0];
    $("[data-backup-row]").innerHTML = `Backup: ${escapeHtml(backup.title)} <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>`;
    $("[data-backup-row]").dataset.note = `Backup: ${backup.title} — ${backup.sourceUrl}`;
  }
}

async function loadResults() {
  if (!state.shortlist) return null;
  const params = new URLSearchParams({
    voterKey: currentVoterKey(),
    voterName: currentVoterName()
  });
  state.results = await api(`/api/shortlists/${encodeURIComponent(state.shortlist.code)}/results?${params.toString()}`, {
    allowForbidden: true
  });
  applyResultsShortlist(state.results);
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
        voterKey: currentVoterKey(),
        voterName: currentVoterName(),
        vote
      })
    });
    applyResultsShortlist(state.results);
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
        voterKey: currentVoterKey(),
        voterName: currentVoterName()
      })
    });
    applyResultsShortlist(state.results);
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
  if (event.target.closest?.("a, button, input, textarea")) return;
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
    await loadShortlist(route.code);
  }
  if (!route.code && route.screen !== "create") {
    setStatus("Create or open a private voting link first.");
  }
  showScreen(route.screen);
}

function showScreen(name) {
  const allowed = new Set(["create", "vote", "result"]);
  const next = allowed.has(name) && (name === "create" || state.shortlist) ? name : "create";
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
  return state.shortlist ? `${location.origin}${routeHash("vote")}` : "";
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
  if (!state.shortlist) {
    setStatus("Create the private voting link first.");
    return;
  }
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
        location: sourceDomain(url),
        priceLabel: "Price to verify",
        imagePath: DEFAULT_CARD_IMAGE
      };
    } catch {
      return {
        title: "Invalid link",
        sourceDomain: "Check URL",
        location: "Paste a full https:// link",
        priceLabel: "Not imported",
        imagePath: DEFAULT_CARD_IMAGE
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

function parseMessyText(text) {
  if (!text || !text.trim()) return [];
  const lines = text.split("\n");
  const seenUrls = new Set();
  const result = [];

  const rawUrls = (text.match(/(?:https?:\/\/|www\.)[^\s<>"']+/g) || [])
    .map((u) => u.replace(/[),.;]+$/g, ""));

  for (const urlStr of rawUrls) {
    try {
      const url = new URL(urlStr);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      const normalizedUrl = url.toString();
      const isDuplicate = seenUrls.has(normalizedUrl);
      seenUrls.add(normalizedUrl);
      const domain = url.hostname.replace(/^www\./, "");

      let lineIndex = -1;
      let contextLine = "";
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(urlStr)) {
          contextLine = lines[i];
          lineIndex = i;
          break;
        }
      }

      const textBeforeLine = lineIndex > 0 ? lines[lineIndex - 1].trim() : "";
      const textAfterLine = lineIndex < lines.length - 1 ? lines[lineIndex + 1].trim() : "";
      const urlPos = contextLine.indexOf(urlStr);
      const beforeOnLine = contextLine.substring(0, urlPos).replace(/[-,;:.]*\s*$/, "").trim();
      const afterOnLine = contextLine.substring(urlPos + urlStr.length).trim();

      const nearbyText = [textBeforeLine, contextLine, textAfterLine].filter(Boolean).join(" ");
      const priceRegex = /\$?\d+(?:[.,]\d+)?(?:\s*(?:USD|EUR|GBP))?(?:\s*\/\s*(?:night|person|week|total))?/gi;
      const sameLinePrices = [...contextLine.matchAll(priceRegex)];
      const allPrices = [...nearbyText.matchAll(priceRegex)];
      const priceText = sameLinePrices.length > 0
        ? sameLinePrices[0][0].trim()
        : allPrices.length > 0
          ? allPrices[0][0].trim()
          : "";

      let title = "";
      if (beforeOnLine && !beforeOnLine.match(/^https?:\/\//)) {
        title = beforeOnLine.replace(/^[-\s]*/, "").replace(/[-,;]*$/, "").trim();
      }
      if (!title && textBeforeLine && !textBeforeLine.match(/https?:\/\//) && textBeforeLine.length < 80) {
        title = textBeforeLine;
      }
      title = title || titleFromUrl(url);

      let location = domain;
      const locMatch = nearbyText.match(/\b(?:in|at|near|around)\s+([A-Z][a-zA-Z\s-]{2,30}?)(?:\s*[,.\n]|$)/);
      if (locMatch) location = locMatch[1].trim();

      const facts = [];
      if (priceText) facts.push(`${priceText} from pasted text`);
      if (afterOnLine && !afterOnLine.match(/^https?:\/\//)) {
        const fragments = afterOnLine.replace(/^[-\s,;]*/, "").split(/[,;]/).map((s) => s.trim()).filter(Boolean);
        for (const f of fragments.slice(0, 3)) {
          if (f.length > 3 && f.length < 80) facts.push(f);
        }
      }
      if (textBeforeLine && textBeforeLine !== title && !textBeforeLine.match(/https?:\/\//) && textBeforeLine.length < 100) {
        facts.push(textBeforeLine);
      }

      result.push({
        sourceUrl: normalizedUrl,
        title: typeof title === "string" ? title.slice(0, 72) : title,
        priceLabel: priceText || "Price to verify",
        location: location.slice(0, 80),
        facts: [...new Set(facts)].slice(0, 4),
        isValid: true,
        isDuplicate
      });
    } catch {
      result.push({
        sourceUrl: urlStr,
        title: "Invalid link",
        priceLabel: "Not imported",
        location: "Paste a full http or https link",
        facts: ["Fix or remove this link before sharing"],
        isValid: false,
        isDuplicate: false
      });
    }
  }

  return result;
}

function isSubmittableDraftCard(card) {
  return Boolean(card?.isValid && !card.isDuplicate);
}

function draftCardsFromState() {
  return state.draftCards.filter(isSubmittableDraftCard).map((c) => ({
    sourceUrl: c.sourceUrl,
    title: c.title || "",
    priceLabel: c.priceLabel || "Price to verify",
    location: c.location || "",
    facts: Array.isArray(c.facts) ? c.facts.map((f) => String(f || "").trim()).filter(Boolean) : []
  }));
}

function renderReviewCards() {
  const list = $("[data-review-list]");
  const panel = $("[data-review-panel]");
  const cards = state.draftCards || [];
  const validCards = cards.filter(isSubmittableDraftCard);

  if (!panel) {
    renderPreview();
    return;
  }

  const hasContent = cards.length > 0;
  panel.classList.toggle("is-hidden", !hasContent);
  $("[data-found-panel]")?.classList.toggle("is-hidden", hasContent);

  $("[data-found-count]").textContent = hasContent
    ? `${validCards.length} option${validCards.length !== 1 ? "s" : ""} ready — edit then create`
    : "Paste links to create cards";
  $("[data-found-note]").textContent = hasContent
    ? "Edit details so voters have enough context to decide without reopening the chat."
    : "Nothing is stored until you create a private voting link.";

  if (!hasContent) {
    list.innerHTML = "";
    updateCreateActions(false);
    return;
  }

  list.innerHTML = cards.map((card, index) => {
    const sourceHref = card.isValid ? escapeAttr(card.sourceUrl) : "#";
    const sourceLabel = card.isValid ? "Open source" : "Fix pasted link";
    return `
      <article class="review-card" data-review-index="${index}">
        <div class="review-card-header">
          <span class="review-index">${index + 1}</span>
          ${card.isDuplicate ? '<span class="review-warning">Duplicate URL</span>' : ""}
          ${!card.isValid ? '<span class="review-warning is-error">Invalid link</span>' : ""}
          <button class="review-remove" data-remove-card="${index}" aria-label="Remove this option">✕</button>
        </div>
        <label class="review-field">
          <span>Title</span>
          <input type="text" data-card-field="title" data-card-index="${index}" value="${escapeAttr(card.title)}" maxlength="72" />
        </label>
        <label class="review-field">
          <span>Price / Status</span>
          <input type="text" data-card-field="priceLabel" data-card-index="${index}" value="${escapeAttr(card.priceLabel)}" maxlength="40" />
        </label>
        <label class="review-field">
          <span>Location / Source context</span>
          <input type="text" data-card-field="location" data-card-index="${index}" value="${escapeAttr(card.location)}" maxlength="80" />
        </label>
        <label class="review-field">
          <span>Facts (one per line)</span>
          <textarea data-card-field="facts" data-card-index="${index}" rows="2" maxlength="300">${escapeAttr(Array.isArray(card.facts) ? card.facts.join("\n") : "")}</textarea>
        </label>
        <div class="review-source-row">
          <a class="review-source" href="${sourceHref}" target="_blank" rel="noreferrer noopener">${sourceLabel}</a>
          <span class="review-domain">${escapeHtml(domainFromUrl(card.sourceUrl))}</span>
        </div>
      </article>
    `;
  }).join("");

  updateCreateActions(validCards.length > 0);
}

function domainFromUrl(urlStr) {
  try { return new URL(urlStr).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function renderLockedResults() {
  $("[data-result-state]").innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h.01" /><path d="M12 4v12" /></svg> Private result`;
  $("[data-result-topbar]").textContent = "Private result";
  $("[data-result-heading]").textContent = "Finish the deck to see the winner";
  $("[data-result-subheading]").textContent = "Peer votes stay hidden until you have made a choice on every card.";
  $("[data-send-final]").innerHTML = `Back to vote <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>`;
  $("[data-winner-card]").innerHTML = `
    <div class="winner-body">
      <span class="domain">private result</span>
      <h3>Your vote is still hidden</h3>
      <span class="trust">Choose No, Hold, or Yes on every card before group results are revealed.</span>
    </div>
  `;
  $("[data-backup-row]")?.classList.add("is-hidden");
  $("[data-send-status]").textContent = "Results open after your deck is complete";
}

function renderShareBanner() {
  const banner = $("[data-share-banner]");
  const privateRow = $("[data-private-row]");
  if (!banner || !state.shortlist) {
    if (banner) banner.classList.add("is-hidden");
    if (privateRow) privateRow.classList.remove("is-hidden");
    return;
  }

  if (state.showShareFlow) {
    banner.classList.remove("is-hidden");
    if (privateRow) privateRow.classList.add("is-hidden");
    $("[data-share-url]").textContent = shareUrl();
  } else {
    banner.classList.add("is-hidden");
    if (privateRow) privateRow.classList.remove("is-hidden");
  }
}

function hasVotedLocally() {
  return Boolean(state.shortlist?.cards?.length && state.votedCardIds.size >= state.shortlist.cards.length);
}

async function loadShortlist(code) {
  const existing = await api(`/api/shortlists/${encodeURIComponent(code)}`, { allow404: true });
  if (!existing) {
    state.shortlist = null;
    state.results = null;
    state.currentIndex = 0;
    state.votedCardIds.clear();
    setStatus("That private voting link was not found.");
    renderAll();
    return false;
  }

  state.shortlist = existing;
  state.results = null;
  state.voterKey = getOrCreateVoterKey(existing.code);
  state.voterName = loadVoterName(existing.code);
  loadLocalVotes();
  syncCurrentIndex();
  renderAll();
  return true;
}

function applyResultsShortlist(results) {
  if (!results?.shortlist) return;
  state.shortlist = {
    ...state.shortlist,
    voters: results.shortlist.voters || state.shortlist?.voters || [],
    votedCount: results.shortlist.votedCount || 0,
    completedVoterCount: results.shortlist.completedVoterCount || 0
  };
}

function syncCurrentIndex() {
  const cards = state.shortlist?.cards || [];
  const nextIndex = cards.findIndex((card) => !state.votedCardIds.has(card.id));
  state.currentIndex = nextIndex === -1 ? cards.length : nextIndex;
}

function renderIdentity() {
  const input = $("[data-voter-name]");
  if (!input) return;
  input.value = state.voterName || "You";
  input.disabled = !state.shortlist;
}

function updateCreateActions(canCreate) {
  $$("[data-create-shortlist]").forEach((button) => {
    button.disabled = !canCreate;
  });
}

function currentVoterKey() {
  if (!state.shortlist) return "";
  if (!state.voterKey) state.voterKey = getOrCreateVoterKey(state.shortlist.code);
  return state.voterKey;
}

function currentVoterName() {
  return (state.voterName || "You").trim() || "You";
}

function getOrCreateVoterKey(code) {
  const storageKey = `swipe-shortlist-voter-key-${code}`;
  const existing = localStorage.getItem(storageKey);
  if (existing) return existing;
  const next =
    globalThis.crypto?.randomUUID?.() ||
    `voter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(storageKey, next);
  return next;
}

function loadVoterName(code) {
  return localStorage.getItem(voterNameStorageKey(code)) || "You";
}

function voterNameStorageKey(code) {
  return `swipe-shortlist-voter-name-${code}`;
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

function cardMediaMarkup(card, className) {
  const imagePath = card?.imagePath && !RETIRED_IMAGE_PATHS.has(card.imagePath) ? card.imagePath : DEFAULT_CARD_IMAGE;
  return `
    <div class="${className}">
      <img src="${escapeAttr(imagePath)}" alt="" loading="lazy" />
      <span>${escapeHtml(card?.sourceDomain || "link")}</span>
    </div>
  `;
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
