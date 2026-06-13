import { linkContextForUrl } from "./link-context.js";

const state = {
  shortlist: null,
  results: null,
  draftCards: [],
  currentIndex: 0,
  votedCardIds: new Set(),
  voterKey: "",
  voterName: "You",
  magicVoter: null,          // Resolved voter from magic link
  magicLinkToken: "",         // ?t= token from URL
  isCreator: false,           // True if current voter is the shortlist creator
  participants: [],           // Participant names for create form
  deadline: "",               // ISO string for deadline picker
  deadlineLabel: "Aim to decide by 21:00",
  isVoting: false,
  lastVote: null,
  showShareFlow: false,
  shareFlowCode: "",
  shareMagicLinks: null,      // Map of name -> magic link URL from create response
  participation: null,        // Participation data for the dashboard
  drag: null,
  routeScreen: "create"
};

const DEFAULT_TITLE = "Private shortlist";
const DEFAULT_CARD_IMAGE = "/assets/link-card.svg";
const RETIRED_IMAGE_PATHS = new Set(["/assets/mare-blu.png", "/assets/beach-thumb.png", "/assets/mare-thumb.png"]);
const AIRBNB_DOMAINS = [
  "airbnb.com",
  "airbnb.co.uk",
  "airbnb.de",
  "airbnb.fr",
  "airbnb.es",
  "airbnb.it",
  "airbnb.ca",
  "airbnb.com.au",
  "airbnb.at",
  "airbnb.ch",
  "airbnb.nl",
  "airbnb.pt",
];
const BOOKING_DOMAINS = ["booking.com"];
const TRUSTED_IMAGE_SOURCES = [
  { sourceDomains: AIRBNB_DOMAINS, imageDomains: ["muscache.com", "airbnb.com"] },
  { sourceDomains: BOOKING_DOMAINS, imageDomains: ["bstatic.com", "booking.com"] },
];
const GENERIC_URL_PATH_PARTS = new Set([
  "accommodation",
  "accommodations",
  "detail",
  "details",
  "hotel",
  "hotels",
  "listing",
  "listings",
  "property",
  "properties",
  "room",
  "rooms",
  "stay",
  "stays",
]);

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

init().catch((error) => {
  console.error(error);
  setStatus("Could not start. Refresh and try again.");
});

async function init() {
  // Check for magic link token in URL
  const urlParams = new URLSearchParams(location.search);
  state.magicLinkToken = urlParams.get("t") || "";

  wireControls();
  const initialRoute = parseRoute();

  // If we have a magic link token, redirect to clean hash URL
  if (state.magicLinkToken && initialRoute.code) {
    const cleanHash = `#/vote/${encodeURIComponent(initialRoute.code)}`;
    if (location.hash !== cleanHash) {
      history.replaceState(null, "", cleanHash);
    }
  }

  if (initialRoute.code) {
    await loadShortlist(initialRoute.code);
    if (state.magicLinkToken) {
      await resolveMagicLink(initialRoute.code);
    }
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
      scheduleMetadataEnrichment();
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
    scheduleMetadataEnrichment();
  });

  $("[data-focus-links]")?.addEventListener("click", () => {
    const input = $("[data-link-input]");
    input?.classList.remove("is-hidden");
    input?.focus();
  });

  // Mode toggle for manual vs links
  $$("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      $$("[data-mode]").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.mode === mode);
        b.setAttribute("aria-selected", b.dataset.mode === mode ? "true" : "false");
      });
      $$("[data-mode-panel]").forEach((panel) => {
        panel.classList.toggle("is-hidden", panel.dataset.modePanel !== mode);
      });
    });
  });

  // Manual card form
  $("[data-add-manual-card]")?.addEventListener("click", () => {
    const title = ($("[data-manual-title]")?.value || "").trim();
    if (!title) {
      setStatus("Add a title for the option.");
      return;
    }
    const desc = ($("[data-manual-desc]")?.value || "").trim();
    const imageUrl = ($("[data-manual-image]")?.value || "").trim();
    const sourceUrl = ($("[data-manual-link]")?.value || "").trim();

    // Validate source URL if provided
    let cleanUrl = sourceUrl;
    if (cleanUrl) {
      try {
        const url = new URL(cleanUrl.startsWith("http") ? cleanUrl : `https://${cleanUrl}`);
        cleanUrl = url.toString();
      } catch {
        cleanUrl = "";
      }
    }

    const domain = sourceUrl ? (() => { try { return new URL(cleanUrl).hostname.replace(/^www\./, ""); } catch { return ""; } })() : "";

    state.draftCards.push({
      sourceUrl: cleanUrl || `manual-${Date.now()}`,
      title,
      description: desc || null,
      priceLabel: desc ? desc.slice(0, 40) : "Manual entry",
      location: domain || "Manual option",
      facts: desc ? [desc.slice(0, 80)] : [],
      isValid: true,
      isDuplicate: false,
      imagePath: imageUrl || null
    });

    // Clear form
    $("[data-manual-title]").value = "";
    $("[data-manual-desc]").value = "";
    $("[data-manual-image]").value = "";
    $("[data-manual-link]").value = "";
    $("[data-manual-title]").focus();

    refreshDraftDuplicateFlags();
    renderReviewCards();
    const count = state.draftCards.filter(isSubmittableDraftCard).length;
    setStatus(`${count} option${count !== 1 ? "s" : ""} added. Review and create the voting link.`);
  });

  // Enter key on manual title field triggers add
  $("[data-manual-title]")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("[data-add-manual-card]")?.click();
    }
  });

  $("[data-review-list]")?.addEventListener("input", (event) => {
    const target = event.target;
    const index = Number(target.dataset?.cardIndex);
    const field = target.dataset?.cardField;
    if (isNaN(index) || !field || index >= state.draftCards.length) return;
    state.draftCards[index]._userEditedFields = {
      ...(state.draftCards[index]._userEditedFields || {}),
      [field]: true
    };
    if (field === "facts") {
      state.draftCards[index].facts = target.value.split("\n").map((f) => f.trim()).filter(Boolean);
    } else {
      state.draftCards[index][field] = target.value;
      if (field === "title") state.draftCards[index]._userEdited = true;
    }
    updateCreateActions(state.draftCards.filter(isSubmittableDraftCard).length > 0);
  });

  $("[data-review-list]")?.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-card]");
    if (!remove) return;
    const index = Number(remove.dataset.removeCard);
    if (isNaN(index) || index >= state.draftCards.length) return;
    state.draftCards.splice(index, 1);
    refreshDraftDuplicateFlags();
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
        // Create without participants or deadline — just the cards
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
        state.shareFlowCode = state.shortlist.code;
        state.isCreator = true;

        // Collect post-create participants and deadline from the share banner
        state.participants = [];
        state.deadline = "";

        localStorage.setItem("swipe-shortlist-last-code", state.shortlist.code);
        saveLocalVotes();
        renderAll();
        setStatus(`Created with ${cards.length} option${cards.length !== 1 ? "s" : ""}. Share the link in your chat.`);
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

  // Post-create: toggle participant setup in share flow
  $("[data-toggle-participants]")?.addEventListener("click", () => {
    const setup = $("[data-participant-setup]");
    const isHidden = setup.classList.contains("is-hidden");
    setup.classList.toggle("is-hidden");
    $("[data-toggle-participants]").textContent = isHidden ? "- Hide participant setup" : "+ Add participants for named voting links";

    // Init participant inputs if opening
    if (isHidden) {
      const container = $("[data-participant-container]");
      if (container && !container.children.length) {
        state.participants = ["", "", ""];
        container.innerHTML = state.participants
          .map((n, i) => `<input type="text" data-participant-input class="participant-input" value="${escapeAttr(n)}" placeholder="Participant ${i + 1}" maxlength="40" autocomplete="off" />`)
          .join("");
      }
    }
  });

  // Post-create: add participant input
  $("[data-add-participant]")?.addEventListener("click", () => {
    const container = $("[data-participant-container]");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "participant-input";
    input.dataset.participantInput = "";
    input.placeholder = `Participant ${container.children.length + 1}`;
    input.maxLength = 40;
    input.autocomplete = "off";
    container.appendChild(input);
    input.focus();
  });

  // Post-create: save participants and generate magic links
  $("[data-save-participants]")?.addEventListener("click", async () => {
    if (!state.shortlist) return;
    const inputs = $$("[data-participant-input]");
    const names = inputs.map((i) => i.value.trim()).filter(Boolean);
    if (!names.length) {
      setStatus("Add at least one participant name.");
      return;
    }

    setStatus("Generating voting links for participants...");
    try {
      // Re-create the shortlist with participants (idempotent — new code each time)
      const cards = state.shortlist.cards.map((c) => ({
        sourceUrl: c.sourceUrl,
        title: c.title,
        priceLabel: c.priceLabel,
        location: c.location,
        facts: c.facts
      }));

      const result = await api("/api/shortlists", {
        method: "POST",
        body: JSON.stringify({ participants: names, cards })
      });

      if (result?.magicLinks) {
        state.shortlist = { ...state.shortlist, ...result };
        state.shareMagicLinks = result.magicLinks;
        state.participants = names;
        renderShareBanner();
        setStatus(`${names.length} participant links generated. Copy each person's link.`);
      }
    } catch (error) {
      console.error(error);
      setStatus("Could not generate participant links. The universal link still works.");
    }
  });

  // Post-create: toggle deadline setup
  $("[data-toggle-deadline]")?.addEventListener("click", () => {
    const setup = $("[data-deadline-setup]");
    const isHidden = setup.classList.contains("is-hidden");
    setup.classList.toggle("is-hidden");
    $("[data-toggle-deadline]").textContent = isHidden ? "- Hide deadline" : "+ Set a decision deadline";

    if (isHidden) {
      const input = $("[data-deadline-setup] [data-deadline-input]");
      if (input && !input.value) {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(21, 0, 0, 0);
        input.value = d.toISOString().slice(0, 16);
      }
    }
  });

  // Post-create: save deadline
  $("[data-save-deadline]")?.addEventListener("click", async () => {
    if (!state.shortlist) return;
    const input = $("[data-deadline-setup] [data-deadline-input]");
    const deadline = input?.value;
    if (!deadline) {
      setStatus("Pick a date and time for the deadline.");
      return;
    }

    setStatus("Setting deadline...");
    try {
      const cards = state.shortlist.cards.map((c) => ({
        sourceUrl: c.sourceUrl,
        title: c.title,
        priceLabel: c.priceLabel,
        location: c.location,
        facts: c.facts
      }));

      const participants = state.shortlist.voters?.map((v) => v.name) || [];
      const result = await api("/api/shortlists", {
        method: "POST",
        body: JSON.stringify({ participants, deadline, cards })
      });

      if (result) {
        state.shortlist = { ...state.shortlist, deadline: result.deadline, ...result };
        renderAll();
        setStatus(`Deadline set: ${new Date(deadline).toLocaleString()}`);
      }
    } catch (error) {
      console.error(error);
      setStatus("Could not set deadline. Try again.");
    }
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
      location.hash = routeHash("vote");
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
  renderParticipationDashboard();
  renderCurrentCard();
  renderCountdown();
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
  const avatars = $("[data-avatar-dots]");
  const voters = state.shortlist?.voters || [];
  if (!avatars) return;
  avatars.innerHTML = voters.length
    ? voters.map((voter) => `<span class="avatar">${escapeHtml(voter.initials)}</span>`).join("")
    : state.shortlist ? `<span class="avatar">V</span>` : `<span class="avatar">Y</span>`;
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
  const deadline = state.shortlist?.deadline;
  const isFinalized = state.shortlist?.finalized;

  let info = "";
  if (isFinalized) {
    info = " · Closed";
  } else if (deadline) {
    const diffMs = new Date(deadline) - new Date();
    if (diffMs <= 0) info = " · Closing";
    else if (diffMs < 60000) info = " · < 1 min";
    else info = ` · ${Math.ceil(diffMs / 60000)}m left`;
  }

  if (saved >= total) {
    node.textContent = `${saved}/${total} done${info}`;
  } else if (saved > 0) {
    node.textContent = `${saved}/${total}${info}`;
  } else {
    node.textContent = `Swipe or tap to vote${info}`;
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

  const hasSource = card.sourceUrl && !card.sourceUrl.startsWith("manual-");
  const isManual = !hasSource;
  const domainLabel = isManual ? "" : escapeHtml(card.sourceDomain);
  const locationLabel = (card.location && card.location !== "Manual option") ? escapeHtml(card.location) : "";
  const hasFacts = card.facts && Array.isArray(card.facts) && card.facts.length > 0 && card.facts.some(f => f);
  const trustLabel = isManual ? "" : card.trustLabel;
  const hasPrice = !isManual && card.priceLabel;
  const hasLocation = locationLabel !== "";
  const hasDescription = !!card.description && card.description.trim() !== "";

  target.innerHTML = `
    ${cardMediaMarkup(card, "card-media")}
    <div class="card-body">
      ${domainLabel ? `<span class="domain">${domainLabel}</span>` : ""}
      <h2>${escapeHtml(card.title)}</h2>
      ${hasDescription ? `<p class="card-desc">${escapeHtml(card.description)}</p>` : ""}
      ${hasPrice ? `<strong class="price">${escapeHtml(hasPrice)}</strong>` : ""}
      ${hasLocation ? `<span class="location"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg> ${locationLabel}</span>` : ""}
      ${hasFacts ? `<div class="fact-row">${card.facts.filter(f => f).map((fact) => `<span class="fact">${escapeHtml(fact)}</span>`).join("")}</div>` : ""}
      ${trustLabel ? `<span class="trust"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg><span>${escapeHtml(trustLabel)}</span></span>` : ""}
      ${hasSource ? `<a class="source-link" href="${escapeAttr(card.sourceUrl)}" target="_blank" rel="noreferrer noopener">Open source link<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7" /><path d="M8 7h9v9" /></svg></a>` : ""}
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
  const winText = rationale?.tied ? "is top (tied)" : (rationale?.tiebreakerResolved ? "wins (tiebreaker)" : "wins");
  $("[data-result-heading]").textContent = `${winner.title} ${winText}`;
  $("[data-result-subheading]").textContent = rationale?.detail || "Everyone can live with this pick. Send it and stop the thread.";
  $("[data-send-final]").innerHTML = `Copy final pick <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="10" width="12" height="9" rx="2" /><path d="M8 10V8a4 4 0 0 1 8 0v2" /></svg>`;
  $("[data-send-status]").textContent = "Ready to copy for the group chat.";
  const winnerIsManual = !winner.sourceUrl || winner.sourceUrl.startsWith("manual-");
  const winnerHasDescription = !!winner.description && winner.description.trim() !== "";
  const winnerHasLocation = winner.location && winner.location !== "Manual option";
  const winnerHasPrice = !winnerIsManual && winner.priceLabel;
  $("[data-winner-card]").innerHTML = `
    ${cardMediaMarkup(winner, "winner-media")}
    <div class="winner-body">
      ${!winnerIsManual ? `<span class="domain">${escapeHtml(winner.sourceDomain)}</span>` : ""}
      <h3>${escapeHtml(winner.title)}</h3>
      ${winnerHasDescription ? `<p class="card-desc">${escapeHtml(winner.description)}</p>` : ""}
      ${winnerHasPrice ? `<strong class="price">${escapeHtml(winnerHasPrice)}</strong>` : ""}
      ${winnerHasLocation ? `<span class="location"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg> ${escapeHtml(winner.location)}</span>` : ""}
      ${voteMarkup}
      <div class="score-row ${rationaleClass}">
        <span class="score is-yes"><strong>${winner.yesCount}</strong><span>yes</span></span>
        <span class="score is-hold"><strong>${winner.holdCount}</strong><span>hold</span></span>
        <span class="score is-no"><strong>${winner.noCount}</strong><span>no</span></span>
        ${winner.abstainCount ? `<span class="score is-abstain"><strong>${Number(winner.abstainCount)}</strong><span>skip</span></span>` : ""}
      </div>
      <div class="rationale-box"><p>${escapeHtml(rationale?.detail || "")}</p></div>
      ${!winnerIsManual ? `<a class="source-link" href="${escapeAttr(winner.sourceUrl)}" target="_blank" rel="noreferrer noopener">Open final link<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7" /><path d="M8 7h9v9" /></svg></a>` : ""}
    </div>
  `;
  $("[data-backup-row]")?.classList.toggle("is-hidden", !state.results?.backups?.length);
  if (state.results?.backups?.length) {
    const backup = state.results.backups[0];
    $("[data-backup-row]").innerHTML = `Backup: ${escapeHtml(backup.title)} <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>`;
    $("[data-backup-row]").dataset.note = `Backup: ${backup.title} - ${backup.sourceUrl}`;
  }

  // Tiebreaker UI
  const tiebreakerSection = $("[data-tiebreaker]");
  if (tiebreakerSection) {
    const ties = state.results?.ties;
    if (ties && ties.length > 1 && !state.results?.tiebreaker) {
      tiebreakerSection.classList.remove("is-hidden");
      tiebreakerSection.innerHTML = `
        <div class="tiebreaker-box">
          <strong>Tied!</strong>
          <p>${ties.length} options are tied at ${ties[0].score} points. Pick one to break the tie:</p>
          <div class="tiebreaker-options">
            ${ties.map((t) => `
              <button class="tiebreaker-pick" type="button" data-tie-card-id="${t.card.id}">
                <strong>${escapeHtml(t.card.title)}</strong>
                <span>${t.card.yesCount} yes · ${t.card.noCount} no</span>
              </button>
            `).join("")}
          </div>
          <button class="text-button" type="button" data-tie-first>First added wins (auto)</button>
        </div>
      `;

      // Wire up tiebreaker picks
      $$("[data-tie-card-id]").forEach((btn) => {
        btn.onclick = async () => {
          const cardId = Number(btn.dataset.tieCardId);
          await resolveTiebreaker(cardId);
        };
      });

      const firstBtn = $("[data-tie-first]");
      if (firstBtn) {
        firstBtn.onclick = async () => {
          await resolveTiebreaker(null, "first_wins");
        };
      }
    } else {
      tiebreakerSection.classList.add("is-hidden");
    }
  }
}

async function resolveTiebreaker(cardId, type = "creator_pick") {
  if (!state.shortlist) return;
  try {
    const results = await api(`/api/shortlists/${encodeURIComponent(state.shortlist.code)}/tie`, {
      method: "POST",
      body: JSON.stringify({ tiebreaker: type, winnerCardId: cardId })
    });
    if (results) {
      state.results = results;
      renderResults();
      setStatus("Tie resolved!");
    }
  } catch (error) {
    console.error(error);
    setStatus("Could not resolve tie.");
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

  // Auto-dismiss share banner on first vote
  if (state.showShareFlow) {
    state.showShareFlow = false;
    renderShareBanner();
  }

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
  if (dy < -72) {
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

async function loadPublicResults(code) {
  try {
    const data = await api(`/api/shortlists/${encodeURIComponent(code)}/results?public=1`);
    if (!data) {
      setStatus("Decision not found.");
      return;
    }
    const winner = data.winner;
    const rationale = data.rationale;

    $("[data-public-heading]").textContent = winner ? `${winner.title} wins` : "No winner yet";
    $("[data-public-subheading]").textContent = rationale?.detail || "The group decided.";
    $("[data-public-status]").textContent = data.shortlist?.finalized ? "Final result" : "Decision in progress";

    if (winner) {
      const hasSource = winner.sourceUrl && !winner.sourceUrl.startsWith("manual-");
      const isManual = !hasSource;
      const pubHasDesc = !!winner.description && winner.description.trim() !== "";
      const pubHasLoc = winner.location && winner.location !== "Manual option";
      const pubHasPrice = !isManual && winner.priceLabel;
      $("[data-public-winner]").innerHTML = `
        ${cardMediaMarkup(winner, "winner-media")}
        <div class="winner-body">
          ${!isManual ? `<span class="domain">${escapeHtml(winner.sourceDomain)}</span>` : ""}
          <h3>${escapeHtml(winner.title)}</h3>
          ${pubHasDesc ? `<p class="card-desc">${escapeHtml(winner.description)}</p>` : ""}
          ${pubHasPrice ? `<strong class="price">${escapeHtml(pubHasPrice)}</strong>` : ""}
          ${pubHasLoc ? `<span class="location"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg> ${escapeHtml(winner.location)}</span>` : ""}
          <div class="score-row">
            <span class="score is-yes"><strong>${winner.yesCount}</strong><span>yes</span></span>
            <span class="score is-hold"><strong>${winner.holdCount}</strong><span>hold</span></span>
            <span class="score is-no"><strong>${winner.noCount}</strong><span>no</span></span>
            ${winner.abstainCount ? `<span class="score is-abstain"><strong>${Number(winner.abstainCount)}</strong><span>skip</span></span>` : ""}
          </div>
          ${hasSource ? `<a class="source-link" href="${escapeAttr(winner.sourceUrl)}" target="_blank" rel="noreferrer noopener">Open link <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7" /><path d="M8 7h9v9" /></svg></a>` : ""}
        </div>
      `;
    } else {
      $("[data-public-winner]").innerHTML = `<div class="winner-body"><h3>No results yet</h3><span class="trust">The group hasn't finished deciding.</span></div>`;
    }

    // Backup
    const backupData = data.backups?.[0];
    const backupRow = $("[data-public-backup]");
    if (backupData) {
      backupRow.classList.remove("is-hidden");
      backupRow.innerHTML = `Backup: ${escapeHtml(backupData.title)} <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>`;
    } else {
      backupRow.classList.add("is-hidden");
    }
  } catch {
    $("[data-public-heading]").textContent = "Could not load results";
  }
}

async function handleRoute() {
  const route = parseRoute();

  // Re-check magic link token on route changes
  const urlParams = new URLSearchParams(location.search);
  const token = urlParams.get("t") || "";
  if (token && token !== state.magicLinkToken) {
    state.magicLinkToken = token;
  }

  if (route.screen === "public" && route.code) {
    state.routeScreen = "public";
    showScreen("public");
    await loadPublicResults(route.code);
    return;
  }

  if (route.code && (!state.shortlist || state.shortlist.code !== route.code)) {
    await loadShortlist(route.code);
    if (state.magicLinkToken) {
      await resolveMagicLink(route.code);
      renderAll();
    }
  }
  if (!route.code && route.screen !== "create") {
    setStatus("Create or open a private voting link first.");
  }
  showScreen(route.screen);
}

function showScreen(name) {
  const allowed = new Set(["create", "vote", "result", "public"]);
  const next = allowed.has(name) && (name === "create" || name === "public" || state.shortlist) ? name : "create";
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
  if (vote === "abstain") return "No preference";
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
      const linkContext = linkContextForUrl(url.toString());
      return {
        title: linkContext?.title || titleFromUrl(url),
        sourceDomain: sourceDomain(url),
        location: linkContext?.location || sourceDomain(url),
        priceLabel: "Price to verify",
        facts: linkContext?.facts || [],
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

let metadataDebounceTimer = null;

async function enrichDraftCards() {
  const validCards = state.draftCards.filter(isSubmittableDraftCard);
  const urls = validCards.map((c) => c.sourceUrl);
  if (!urls.length) return;

  try {
    const response = await api("/api/metadata", {
      method: "POST",
      body: JSON.stringify({ urls }),
    });
    if (!response?.metadata?.length) return;

    let changed = false;
    for (const meta of response.metadata) {
      if (!meta.fetched) continue;
      const idx = state.draftCards.findIndex((c) => c.sourceUrl === meta.url && c.isValid);
      if (idx === -1) continue;
      const card = state.draftCards[idx];
      const editedFields = card._userEditedFields || {};
      const sourceDomain = domainFromUrl(meta.url);
      const metadataTitle = cleanCardText(meta.title, 120);
      const metadataDescription = cleanCardText(meta.description, 120);
      const metadataSiteName = cleanCardText(meta.siteName, 80);
      const metadataLocation = cleanCardText(locationFromMetadataTitle(metadataTitle), 80);
      const metadataCardTitle = titleFromMetadataCard({
        sourceDomain,
        metadataTitle,
        metadataDescription,
      });

      if (metadataCardTitle && metadataCardTitle !== "Link from " + sourceDomain && !card._userEdited && !editedFields.title) {
        const oldTitle = card.title;
        card.title = metadataCardTitle;
        if (card.title !== oldTitle) changed = true;
      }

      if (!editedFields.location) {
        if (
          metadataLocation &&
          (!card.location || card.location === sourceDomain || card.location === metadataSiteName || card.location === "Airbnb")
        ) {
          card.location = metadataLocation;
          changed = true;
        } else if (metadataSiteName && (!card.location || card.location === sourceDomain)) {
          card.location = metadataSiteName;
          changed = true;
        }
      }

      if (!editedFields.facts) {
        const facts = factsFromMetadataCard({
          sourceDomain,
          metadataTitle,
          metadataDescription,
          metadataSiteName,
          existingFacts: card.facts,
        });
        if (facts.length) {
          card.facts = facts;
          changed = true;
        }
      }

      if ((!card.imagePath || card.imagePath === DEFAULT_CARD_IMAGE || RETIRED_IMAGE_PATHS.has(card.imagePath)) && meta.ogImage) {
        const imageUrl = cleanImageUrl(meta.ogImage, meta.url);
        if (imageUrl) {
          card.imagePath = imageUrl;
          changed = true;
        }
      }
    }
    if (changed) {
      renderReviewCards();
    }
  } catch {
    // Metadata enrichment is optional. Fallback cards still create a valid deck.
  }
}

function cleanCardText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function locationFromMetadataTitle(title) {
  const match = String(title || "").match(/\bin\s+([^·|–—-]{2,80})(?:\s*[·|–—-]|$)/i);
  return match ? match[1].trim() : "";
}

function titleFromMetadataCard({ sourceDomain, metadataTitle, metadataDescription }) {
  const isAirbnb = isAirbnbDomain(sourceDomain);
  if (isAirbnb && metadataDescription && !/^listing id\b/i.test(metadataDescription)) {
    return cleanCardText(metadataDescription, 72);
  }
  return cleanCardText(metadataTitle, 72);
}

function factsFromMetadataCard({ sourceDomain, metadataTitle, metadataDescription, metadataSiteName, existingFacts }) {
  const facts = [];

  if (isAirbnbDomain(sourceDomain) && metadataTitle) {
    for (const [index, part] of metadataTitle.split(/[·•]/).entries()) {
      let fact = cleanCardText(part, 56);
      if (index === 0) fact = fact.replace(/\s+in\s+.+$/i, "").trim();
      if (fact) facts.push(fact);
    }
  } else if (metadataDescription) {
    facts.push(metadataDescription);
  }

  if (metadataSiteName && !facts.some((fact) => fact.toLowerCase().includes(metadataSiteName.toLowerCase()))) {
    facts.push(`Listed on ${metadataSiteName}`);
  }

  for (const fact of Array.isArray(existingFacts) ? existingFacts : []) {
    if (isUsefulMetadataFact(fact)) facts.push(fact);
  }

  return Array.from(new Set(facts.map((fact) => cleanCardText(fact, 80)).filter(isUsefulMetadataFact))).slice(0, 4);
}

function isAirbnbDomain(domain) {
  return hostMatchesDomain(domain, AIRBNB_DOMAINS);
}

function isUsefulMetadataFact(fact) {
  const value = String(fact || "").trim();
  if (!value) return false;
  if (/^listing id\b/i.test(value)) return false;
  return true;
}

function scheduleMetadataEnrichment() {
  clearTimeout(metadataDebounceTimer);
  metadataDebounceTimer = setTimeout(() => {
    enrichDraftCards().catch(() => {});
  }, 400);
}

function sourceDomain(url) {
  return url.hostname.replace(/^www\./, "");
}

function titleFromUrl(url) {
  const pathBits = url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/\.[a-z0-9]+$/i, ""))
    .filter(Boolean)
    .filter(isUsefulPathPart);
  const raw = pathBits.at(-1) || "";
  const title = raw.replace(/[-_+]+/g, " ").replace(/\s+/g, " ").trim();
  if (title && title.length > 1) {
    return title.replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 72);
  }
  const domain = sourceDomain(url);
  return `Link from ${domain}`;
}

function isUsefulPathPart(part) {
  const normalized = part.toLowerCase();
  return (
    !/^\d{4,}$/.test(normalized) &&
    !/^[a-z]{2}(?:-[a-z]{2})?$/.test(normalized) &&
    !GENERIC_URL_PATH_PARTS.has(normalized)
  );
}

function parseMessyText(text) {
  if (!text || !text.trim()) return [];
  const lines = text.split("\n");
  const seenUrls = new Set();
  const result = [];

  const rawUrls = [];
  lines.forEach((line, lineIndex) => {
    const urlPattern = /(?:https?:\/\/|www\.)[^\s<>"']+/g;
    let match;
    while ((match = urlPattern.exec(line)) !== null) {
      rawUrls.push({
        urlStr: match[0].replace(/[),.;]+$/g, ""),
        rawLength: match[0].length,
        lineIndex,
        contextLine: line,
        urlPos: match.index
      });
    }
  });

  for (const rawUrl of rawUrls) {
    const { urlStr, rawLength, lineIndex, contextLine, urlPos } = rawUrl;
    try {
      const normalizedInput = urlStr.startsWith("www.") ? `https://${urlStr}` : urlStr;
      const url = new URL(normalizedInput);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      const linkContext = linkContextForUrl(url.toString());
      const normalizedUrl = linkContext?.canonicalUrl || url.toString();
      const isDuplicate = seenUrls.has(normalizedUrl);
      seenUrls.add(normalizedUrl);
      const domain = url.hostname.replace(/^www\./, "");

      const textBeforeLine = lineIndex > 0 ? lines[lineIndex - 1].trim() : "";
      const textAfterLine = lineIndex < lines.length - 1 ? lines[lineIndex + 1].trim() : "";
      const beforeOnLine = contextLine.substring(0, urlPos).replace(/[-,;:.]*\s*$/, "").trim();
      const afterOnLine = contextLine.substring(urlPos + rawLength).trim();

      // Strip URL from context before price matching to avoid
      // treating URL path segments (IDs, numbers) as prices.
      const textForPrices = `${contextLine.slice(0, urlPos)} ${contextLine.slice(urlPos + rawLength)}`;
      const priceContext = [
        lineHasUrl(textBeforeLine) ? "" : textBeforeLine,
        textForPrices,
        lineHasUrl(textAfterLine) ? "" : textAfterLine
      ];
      const nearbyText = priceContext.filter(Boolean).join(" ");
      const priceRegex = /(?:[$€£]\s*(?:\d+(?:[.,]\d+)?)(?:\s*\/\s*(?:night|person|week|total))?|\b\d+(?:[.,]\d+)?\s*(?:USD|EUR|GBP)(?:\s*\/\s*(?:night|person|week|total))?)/gi;
      const sameLinePrices = [...textForPrices.matchAll(priceRegex)];
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
      title = title || linkContext?.title || titleFromUrl(url);

      let location = linkContext?.location || domain;
      const locMatch = nearbyText.match(/\b(?:in|at|near|around)\s+([A-Z][a-zA-Z\s-]{2,30}?)(?:\s*[,.\n]|$)/);
      if (locMatch) location = locMatch[1].trim();

      const facts = [];
      if (priceText) facts.push(`${priceText} from pasted text`);
      for (const fact of linkContext?.facts || []) facts.push(fact);
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

function lineHasUrl(line) {
  return /(?:https?:\/\/|www\.)[^\s<>"']+/i.test(line || "");
}

function refreshDraftDuplicateFlags() {
  const seenUrls = new Set();
  state.draftCards.forEach((card) => {
    if (!card?.isValid) {
      card.isDuplicate = false;
      return;
    }
    card.isDuplicate = seenUrls.has(card.sourceUrl);
    seenUrls.add(card.sourceUrl);
  });
}

function draftCardsFromState() {
  return state.draftCards.filter(isSubmittableDraftCard).map((c) => {
    const output = {
      sourceUrl: c.sourceUrl,
      title: c.title || "",
      priceLabel: c.priceLabel || "Price to verify",
      location: c.location || "",
      facts: Array.isArray(c.facts) ? c.facts.map((f) => String(f || "").trim()).filter(Boolean) : []
    };
    if (c.imagePath) output.imagePath = c.imagePath;
    if (c.description) output.description = c.description;
    return output;
  });
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
    ? `${validCards.length} option${validCards.length !== 1 ? "s" : ""} ready. Edit then create.`
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
    const hasSourceUrl = card.isValid && card.sourceUrl && !card.sourceUrl.startsWith("manual-");
    const sourceHref = hasSourceUrl ? escapeAttr(card.sourceUrl) : "#";
    const sourceLabel = hasSourceUrl ? "Open source" : "Manual option";
    const cardImageSrc = displayImagePath(card.imagePath, card.sourceUrl);
    const imageHtml = cardImageSrc !== DEFAULT_CARD_IMAGE
      ? `<img class="review-card-image" src="${escapeAttr(cardImageSrc)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.onerror=null;this.classList.add('is-fallback');this.src='/assets/link-card.svg';" />`
      : "";
    return `
      <article class="review-card" data-review-index="${index}">
        <div class="review-card-header">
          <span class="review-index">${index + 1}</span>
          ${card.isDuplicate ? '<span class="review-warning">Duplicate URL</span>' : ""}
          ${!card.isValid ? '<span class="review-warning is-error">Invalid link</span>' : ""}
          <button class="review-remove" data-remove-card="${index}" aria-label="Remove this option">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12" /><path d="M18 6 6 18" /></svg>
          </button>
        </div>
        <div class="review-card-body">
          ${imageHtml}
          <div class="review-card-fields">
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
          </div>
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
  const isFinalized = state.shortlist?.finalized;
  const totalCards = state.shortlist?.cards?.length || 0;
  const votedCount = state.votedCardIds.size;
  const remaining = totalCards - votedCount;
  const deadline = state.shortlist?.deadline;
  let deadlineHint = "";
  if (deadline) {
    const diffMs = new Date(deadline) - new Date();
    if (diffMs <= 0) deadlineHint = " Deadline passed.";
    else deadlineHint = ` Closes in ${Math.ceil(diffMs / 60000)}m.`;
  }

  if (isFinalized) {
    $("[data-result-state]").innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h8l2 4-2 10H6L4 10l2-4Z" /><path d="M12 4v2" /></svg> Decision closed`;
    $("[data-result-topbar]").textContent = "Decision closed";
    $("[data-result-heading]").textContent = remaining > 0 ? `${remaining} more card${remaining > 1 ? "s" : ""} to go` : "Results ready";
    $("[data-result-subheading]").textContent = remaining > 0 ? `Vote on ${remaining} more card${remaining > 1 ? "s" : ""} to see the group's pick.${deadlineHint}` : "The group decided.";
    $("[data-winner-card]").innerHTML = `
      <div class="winner-body">
        <h3>${remaining > 0 ? `${votedCount}/${totalCards} voted` : "Vote complete"}</h3>
        <span class="trust">${remaining > 0 ? `Finish your ${remaining} remaining card${remaining > 1 ? "s" : ""} to unlock the result.` : "Results will appear here."}</span>
      </div>
    `;
  } else {
    $("[data-result-state]").innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h8l2 4-2 10H6L4 10l2-4Z" /><path d="M12 4v2" /></svg> Private result`;
    $("[data-result-topbar]").textContent = "Private result";
    $("[data-result-heading]").textContent = remaining > 0 ? `${remaining} more card${remaining > 1 ? "s" : ""} to go` : "Complete!";
    $("[data-result-subheading]").textContent = remaining > 0 ? `Vote on ${remaining} more card${remaining > 1 ? "s" : ""} to reveal the group pick.${deadlineHint}` : "Results open after your deck is complete.";
    $("[data-winner-card]").innerHTML = `
      <div class="winner-body">
        <h3>${votedCount}/${totalCards} voted</h3>
        <span class="trust">${remaining > 0 ? `${remaining} card${remaining > 1 ? "s" : ""} remaining — keep going.` : "All cards done! Just need to sync with server."}</span>
      </div>
    `;
  }
  $("[data-send-final]").innerHTML = `Back to vote <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>`;
  $("[data-send-final]").dataset.screenTarget = "vote";
  $("[data-backup-row]")?.classList.add("is-hidden");
  $("[data-send-status]").textContent = remaining > 0 ? `${remaining} card${remaining > 1 ? "s" : ""} remaining` : "Results loading...";
}

function renderShareBanner() {
  const banner = $("[data-share-banner]");
  const privateRow = $("[data-private-row]");
  if (!banner || !state.shortlist) {
    if (banner) banner.classList.add("is-hidden");
    if (privateRow) privateRow.classList.remove("is-hidden");
    return;
  }

  if (state.showShareFlow && state.shareFlowCode === state.shortlist.code) {
    banner.classList.remove("is-hidden");
    if (privateRow) privateRow.classList.add("is-hidden");

    // Show the universal share URL
    const urlEl = $("[data-share-url]");
    if (urlEl) {
      urlEl.textContent = shareUrl();
    }

    // Render per-person magic links (only if participants have been added)
    const linksContainer = $("[data-magic-links]");
    if (linksContainer && state.shareMagicLinks) {
      const names = Object.keys(state.shareMagicLinks);
      if (names.length > 0) {
        $("[data-share-extras]").classList.remove("is-hidden");
        // Auto-expand the participant setup when magic links exist
        $("[data-participant-setup]")?.classList.remove("is-hidden");
        $("[data-toggle-participants]").textContent = "- Hide participant setup";

        linksContainer.innerHTML = names
          .map(
            (name) => `
              <div class="magic-link-row">
                <span class="chip">${escapeHtml(name)}</span>
                <button class="text-button" type="button" data-copy-magic="${escapeAttr(name)}" data-magic-url="${escapeAttr(state.shareMagicLinks[name])}">
                  Copy link
                </button>
              </div>
            `
          )
          .join("");

        // Wire up copy buttons for magic links
        $$("[data-copy-magic]").forEach((btn) => {
          btn.onclick = async () => {
            const url = btn.dataset.magicUrl;
            try {
              await navigator.clipboard?.writeText(url);
              btn.textContent = "Copied!";
              setTimeout(() => { btn.textContent = "Copy link"; }, 2000);
            } catch {
              setStatus(url);
            }
          };
        });
      } else {
        // No participants yet — show the extras toggle
        $("[data-share-extras]")?.classList.remove("is-hidden");
        if (linksContainer) linksContainer.innerHTML = "";
      }
    }
  } else {
    banner.classList.add("is-hidden");
    if (privateRow) privateRow.classList.remove("is-hidden");
  }
}

function hasVotedLocally() {
  return Boolean(state.shortlist?.cards?.length && state.votedCardIds.size >= state.shortlist.cards.length);
}

async function resolveMagicLink(code) {
  if (!state.magicLinkToken || !code) return;
  try {
    const voter = await api(`/api/shortlists/${encodeURIComponent(code)}/resolve?t=${encodeURIComponent(state.magicLinkToken)}`);
    if (voter) {
      state.magicVoter = voter;
      state.voterName = voter.name;
      state.isCreator = voter.isOwner;
      localStorage.setItem(voterNameStorageKey(code), voter.name);
    }
  } catch {
    // Magic link resolution failed — continue with existing identity
  }
}

async function loadShortlist(code) {
  const existing = await api(`/api/shortlists/${encodeURIComponent(code)}`, { allow404: true });
  if (!existing) {
    state.shortlist = null;
    state.results = null;
    state.currentIndex = 0;
    state.votedCardIds.clear();
    state.showShareFlow = false;
    state.shareFlowCode = "";
    state.participation = null;
    setStatus("That private voting link was not found.");
    renderAll();
    return false;
  }

  if (state.shareFlowCode !== existing.code) {
    state.showShareFlow = false;
    state.shareFlowCode = "";
  }
  state.shortlist = existing;
  state.results = null;
  state.voterKey = getOrCreateVoterKey(existing.code);
  state.voterName = loadVoterName(existing.code);

  // If we have a magic voter, override stored voter name
  if (state.magicVoter) {
    state.voterName = state.magicVoter.name;
  }

  loadLocalVotes();
  syncCurrentIndex();

  // Load participation data (creator dashboard + voter progress)
  await loadParticipation();

  renderAll();
  return true;
}

async function loadParticipation() {
  if (!state.shortlist) return;
  try {
    const data = await api(`/api/shortlists/${encodeURIComponent(state.shortlist.code)}/participation`);
    if (data?.participants) {
      state.participation = data;
    }
  } catch {
    // Participation is optional — don't block the UI
  }
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

function renderParticipationDashboard() {
  const dashboard = $("[data-participation-dashboard]");
  const voterProgress = $("[data-voter-progress]");
  if (!dashboard && !voterProgress) return;

  const participants = state.participation?.participants || [];
  if (!participants.length) {
    if (dashboard) dashboard.classList.add("is-hidden");
    if (voterProgress) voterProgress.classList.add("is-hidden");
    return;
  }

  const totalCards = state.shortlist?.cards?.length || 0;
  const completedCount = participants.filter((p) => p.isCompleted).length;
  const votedCount = participants.filter((p) => p.completedCardCount > 0).length;

  // Creator dashboard — full participation grid
  if (dashboard) {
    if (state.isCreator) {
      dashboard.classList.remove("is-hidden");
      const dotsHtml = participants
        .map((p) => {
          const dotClass = p.isCompleted ? "is-green" : p.completedCardCount > 0 ? "is-yellow" : "";
          const nudgeAttr = state.shareMagicLinks?.[p.name]
            ? `data-nudge="${escapeAttr(state.shareMagicLinks[p.name])}"`
            : "";
          return `
            <div class="participant-row">
              <span class="avatar">${escapeHtml(p.initials)}</span>
              <span class="participant-name">${escapeHtml(p.name)}</span>
              <span class="participation-dot ${dotClass}"></span>
              <span class="participation-count">${p.completedCardCount}/${totalCards}</span>
              ${!p.isCompleted ? `<button class="nudge-button" type="button" ${nudgeAttr} data-nudge-name="${escapeAttr(p.name)}" title="Copy nudge message">Nudge</button>` : ""}
            </div>
          `;
        })
        .join("");
      dashboard.innerHTML = dotsHtml;

      // Wire up nudge buttons
      $$("[data-nudge-name]").forEach((btn) => {
        btn.onclick = () => nudgeParticipant(btn.dataset.nudgeName);
      });
    } else {
      dashboard.classList.add("is-hidden");
    }
  }

  // Voter progress — simple "N of M voted" line
  if (voterProgress) {
    voterProgress.classList.remove("is-hidden");
    const progressText = `${votedCount} of ${participants.length} have voted`;
    const completedText = completedCount > 0
      ? ` · ${completedCount} ${completedCount === 1 ? "person" : "people"} finished`
      : "";
    voterProgress.textContent = progressText + completedText;
  }
}

function nudgeParticipant(name) {
  const link = state.shareMagicLinks?.[name];
  if (!link) {
    setStatus(`No magic link for ${name}. They may have joined anonymously.`);
    return;
  }
  const title = state.shortlist?.title || "this decision";
  const message = `Hey ${name}, we are deciding ${title} on SwipeShortlist. Cast your vote here: ${link}`;
  navigator.clipboard?.writeText(message).then(
    () => setStatus(`Nudge copied for ${name}. Paste it in your group chat.`),
    () => setStatus(message)
  );
}

function renderCountdown() {
  const node = $("[data-countdown]");
  if (!node) return;

  const deadline = state.shortlist?.deadline;
  if (!deadline) {
    node.classList.add("is-hidden");
    return;
  }

  const deadlineDate = new Date(deadline);
  const now = new Date();
  const diffMs = deadlineDate - now;
  const isFinalized = state.shortlist?.finalized;

  if (isFinalized) {
    node.textContent = "Results ready";
    node.classList.remove("is-hidden");
    return;
  }

  if (diffMs <= 0) {
    node.textContent = "Closes < 1 min";
    node.classList.remove("is-hidden");
    return;
  }

  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const remainingMins = diffMins % 60;

  if (diffHours > 0) {
    node.textContent = `Closes in ${diffHours}h ${remainingMins}m`;
  } else {
    node.textContent = `Closes in ${diffMins}m`;
  }
  node.classList.remove("is-hidden");
}

// Update countdown every 30 seconds
setInterval(() => {
  if (state.shortlist?.deadline) renderCountdown();
}, 30000);

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
  const imagePath = displayImagePath(card?.imagePath, card?.sourceUrl);
  const isDefault = !card?.imagePath || imagePath === DEFAULT_CARD_IMAGE;
  const isManual = isDefault && (!card?.sourceUrl || card.sourceUrl.startsWith("manual-"));

  if (isManual) {
    // Show a gradient with the first letter instead of generic SVG
    const initial = (card?.title?.charAt(0) || "?").toUpperCase();
    return `
      <div class="${className} is-manual" role="img" aria-label="${escapeHtml(card?.title || "option")}">
        <span class="card-initial">${escapeHtml(initial)}</span>
      </div>
    `;
  }

  return `
    <div class="${className}">
      <img src="${escapeAttr(imagePath)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"
           onerror="this.onerror=null;this.classList.add('is-fallback');this.src='/assets/link-card.svg';" />
      <span>${escapeHtml(card?.sourceDomain || "link")}</span>
    </div>
  `;
}

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const screen = parts[0] || "create";
  const code = parts[1] || new URLSearchParams(location.search).get("code") || "";
  // Handle "public" screen as a read-only results view
  if (screen === "public") {
    return { screen: "public", code };
  }
  return { screen, code };
}

function routeHash(screen, { includeToken = false } = {}) {
  const code = state.shortlist?.code;
  if (!code) return `#/${screen}`;
  let hash = `#/${screen}/${encodeURIComponent(code)}`;

  // Include magic link token if available
  if (includeToken && state.magicLinkToken) {
    hash += `?t=${encodeURIComponent(state.magicLinkToken)}`;
  }

  return hash;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanImageUrl(raw, sourceUrl = "") {
  try {
    const url = new URL(String(raw || "").trim());
    if (url.protocol !== "https:") return null;
    // Reject obviously tiny/placeholder images
    if (/placeholder|spacer|pixel|1x1|blank|icon-16/i.test(url.pathname)) return null;
    if (isTrustedImageForSource(url.hostname, sourceUrl)) return url.toString();
    return null;
  } catch {
    return null;
  }
}

function displayImagePath(raw, sourceUrl = "") {
  if (!raw || RETIRED_IMAGE_PATHS.has(raw)) return DEFAULT_CARD_IMAGE;
  if (raw === DEFAULT_CARD_IMAGE) return DEFAULT_CARD_IMAGE;
  return cleanImageUrl(raw, sourceUrl) || DEFAULT_CARD_IMAGE;
}

function hostMatchesDomain(hostname, domains) {
  const normalized = String(hostname || "").replace(/^www\./i, "").toLowerCase();
  return domains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

function isTrustedImageForSource(imageHostname, sourceUrl) {
  let sourceHostname;
  try {
    sourceHostname = new URL(sourceUrl).hostname;
  } catch {
    return false;
  }
  return TRUSTED_IMAGE_SOURCES.some(
    (entry) => hostMatchesDomain(sourceHostname, entry.sourceDomains) && hostMatchesDomain(imageHostname, entry.imageDomains)
  );
}

function escapeAttr(value) {
  return escapeHtml(value);
}
