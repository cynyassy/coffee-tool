import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// Local UI state shared across screens.
const state = {
  selectedBagId: null,
  authRequired: Boolean(window.APP_CONFIG?.authRequired),
  accessToken: null,
  supabase: null,
  authReady: false,
  feedPollingTimer: null,
};

// Screen roots.
const views = {
  myBags: document.getElementById("view-my-bags"),
  feed: document.getElementById("view-feed"),
  create: document.getElementById("view-create"),
  archived: document.getElementById("view-archived"),
  detail: document.getElementById("view-detail"),
  analytics: document.getElementById("view-analytics"),
};

// Navigation buttons.
const navButtons = {
  myBags: document.getElementById("nav-my-bags"),
  feed: document.getElementById("nav-feed"),
  create: document.getElementById("nav-create"),
  archived: document.getElementById("nav-archived"),
  detail: document.getElementById("nav-detail"),
  analytics: document.getElementById("nav-analytics"),
};

// Auth controls.
const authElements = {
  panel: document.getElementById("auth-panel"),
  status: document.getElementById("auth-status"),
  emailInput: document.getElementById("auth-email"),
  emailLogin: document.getElementById("auth-email-login"),
  googleLogin: document.getElementById("auth-google-login"),
  logout: document.getElementById("auth-logout"),
};

function setActiveView(key) {
  Object.entries(views).forEach(([k, el]) => {
    el.classList.toggle("hidden", k !== key);
  });
  Object.entries(navButtons).forEach(([k, btn]) => {
    btn.classList.toggle("active", k === key);
  });
}

function updateAuthStatus() {
  if (!state.authReady) {
    authElements.status.textContent = "Auth: loading...";
    return;
  }

  if (state.accessToken) {
    authElements.status.textContent = state.authRequired
      ? "Auth: signed in (required mode)"
      : "Auth: signed in";
    return;
  }

  authElements.status.textContent = state.authRequired
    ? "Auth: signed out (login required for API calls)"
    : "Auth: guest mode (login optional)";
}

function ensureBagSelected() {
  const enabled = !!state.selectedBagId;
  navButtons.detail.disabled = !enabled;
  navButtons.analytics.disabled = !enabled;
}

async function request(path, init) {
  const headers = { "Content-Type": "application/json", ...(init?.headers || {}) };
  if (state.accessToken) {
    headers.Authorization = `Bearer ${state.accessToken}`;
  }

  const response = await fetch(path, {
    ...init,
    headers,
  });

  let data = null;
  try {
    data = await response.json();
  } catch (_error) {
    data = null;
  }

  if (!response.ok) {
    const error = new Error("Request failed");
    error.payload = data;
    error.status = response.status;
    throw error;
  }

  return data;
}

const api = {
  listBags: (status = "ACTIVE") => request(`/bags?status=${status}`),
  listFeed: (limit = 50) => request(`/feed/brews?limit=${limit}`),
  createBag: (payload) => request("/bags", { method: "POST", body: JSON.stringify(payload) }),
  updateBag: (id, payload) => request(`/bags/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  getBag: (id) => request(`/bags/${id}`),
  archiveBag: (id) => request(`/bags/${id}/archive`, { method: "PATCH" }),
  unarchiveBag: (id) => request(`/bags/${id}/unarchive`, { method: "PATCH" }),
  listBrews: (id) => request(`/bags/${id}/brews`),
  createBrew: (id, payload) => request(`/bags/${id}/brews`, { method: "POST", body: JSON.stringify(payload) }),
  setBestBrew: (bagId, brewId) => request(`/bags/${bagId}/brews/${brewId}/best`, { method: "PATCH" }),
  analytics: (id) => request(`/bags/${id}/analytics`),
};

function renderValidationErrors(payload) {
  if (!payload?.errors || !Array.isArray(payload.errors)) {
    if (payload?.error) return `<ul class='error-list'><li>${payload.error}</li></ul>`;
    return "<ul class='error-list'><li>Request failed</li></ul>";
  }
  return `<ul class='error-list'>${payload.errors
    .map((e) => `<li><strong>${e.field}</strong>: ${e.message}</li>`)
    .join("")}</ul>`;
}

function daysOffRoast(roastDate, brewDate) {
  if (!roastDate || !brewDate) return "-";
  const diffMs = new Date(brewDate).getTime() - new Date(roastDate).getTime();
  return `${Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))}d`;
}

function sliderField(label, name, min, max, step, value = min) {
  return `
    <label>${label}
      <div class="slider-row">
        <input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${value}" data-output="${name}-output" />
        <output id="${name}-output">${value}</output>
      </div>
    </label>
  `;
}

function wireSliderOutputs(scope) {
  scope.querySelectorAll("input[type='range'][data-output]").forEach((el) => {
    const output = scope.querySelector(`#${el.dataset.output}`);
    const sync = () => {
      output.textContent = el.value;
    };
    el.addEventListener("input", sync);
    sync();
  });
}

function brewTableHtml(brews, roastDate) {
  if (!brews.length) return `<p class="inline-meta">No brews yet</p>`;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Brew Date</th>
            <th>Days Off Roast</th>
            <th>Brewer</th>
            <th>Method</th>
            <th>Grinder</th>
            <th>Grind Setting</th>
            <th>Dose (gms)</th>
            <th>Water (ml)</th>
            <th>Rating</th>
            <th>Flavour Notes</th>
            <th>Best</th>
          </tr>
        </thead>
        <tbody>
          ${brews
            .map(
              (brew) => `
              <tr>
                <td>${new Date(brew.createdAt).toLocaleString()}</td>
                <td>${daysOffRoast(roastDate, brew.createdAt)}</td>
                <td>${brew.brewer || "-"}</td>
                <td>${brew.method}</td>
                <td>${brew.grinder || "-"}</td>
                <td>${brew.grindSetting ?? "-"}</td>
                <td>${brew.dose ?? "-"}</td>
                <td>${brew.waterAmount ?? "-"}</td>
                <td>${brew.rating ?? "-"}</td>
                <td>${brew.flavourNotes || "-"}</td>
                <td><button class="set-best" data-brew-id="${brew.id}">${brew.isBest ? "★ Best" : "Mark Best"}</button></td>
              </tr>
            `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function formatFeedUser(userId) {
  if (!userId) return "unknown";
  return `@${String(userId).slice(0, 8)}`;
}

function feedItemHtml(item) {
  const createdAt = new Date(item.createdAt).toLocaleString();
  const rating = item.rating ?? "-";
  const recipe = [
    item.dose != null ? `${item.dose}g` : null,
    item.grindSetting != null ? `grind ${item.grindSetting}` : null,
    item.waterAmount != null ? `${item.waterAmount}ml` : null,
  ]
    .filter(Boolean)
    .join(" - ");

  return `
    <article class="card">
      <p class="inline-meta">${formatFeedUser(item.userId)} brewed <strong>${item.coffeeName}</strong> (${item.roaster})</p>
      <p><strong>${item.method}</strong> ${item.brewer ? `- ${item.brewer}` : ""} ${item.isBest ? "- ★ best brew" : ""}</p>
      <p class="inline-meta">${recipe || "No recipe details"} ${item.grinder ? `- grinder ${item.grinder}` : ""}</p>
      <p class="inline-meta">Rating: ${rating}</p>
      <p class="inline-meta">${item.flavourNotes || "No flavour notes"}</p>
      <p class="inline-meta">${createdAt}</p>
    </article>
  `;
}

function showAuthRequiredError() {
  if (!state.authRequired) return;
  const html = "<ul class='error-list'><li>Please sign in to use the app.</li></ul>";
  views.myBags.innerHTML = `<h2>My Bags</h2>${html}`;
  views.feed.innerHTML = `<h2>Global Brew Feed</h2>${html}`;
  views.archived.innerHTML = `<h2>Archived Bags</h2>${html}`;
  views.detail.innerHTML = html;
  views.analytics.innerHTML = html;
}

async function renderMyBags() {
  try {
    const bags = await api.listBags("ACTIVE");
    const tpl = document.getElementById("bag-card-template");

    views.myBags.innerHTML = `<h2>My Bags</h2><div id="active-bag-list"></div>`;
    const list = document.getElementById("active-bag-list");

    if (!bags.length) {
      list.innerHTML = `<p class="inline-meta">No active bags</p>`;
      return;
    }

    bags.forEach((bag) => {
      const node = tpl.content.cloneNode(true);
      node.querySelector(".bag-name").textContent = bag.coffeeName;
      node.querySelector(".bag-meta").textContent = `${bag.roaster} ${bag.origin ? `- ${bag.origin}` : ""}`;
      node.querySelector(".bag-stats").textContent = `${bag.brewCount} brews - avg ${bag.averageRating ?? "-"} - age ${bag.roastAgeDays ?? "?"}d (${bag.restingStatus})`;
      node.querySelector(".open-bag").addEventListener("click", async () => {
        state.selectedBagId = bag.id;
        ensureBagSelected();
        await renderDetail();
        setActiveView("detail");
      });
      list.appendChild(node);
    });
  } catch (error) {
    if (error.status === 401) return showAuthRequiredError();
    throw error;
  }
}

async function renderFeed() {
  try {
    const feed = await api.listFeed(75);
    views.feed.innerHTML = `
      <h2>Global Brew Feed</h2>
      <div class="actions">
        <button id="refresh-feed" class="ghost">Refresh Feed</button>
      </div>
      <div id="feed-list"></div>
    `;

    const list = document.getElementById("feed-list");
    if (!feed.length) {
      list.innerHTML = `<p class="inline-meta">No brews in feed yet.</p>`;
    } else {
      list.innerHTML = feed.map(feedItemHtml).join("");
    }

    document.getElementById("refresh-feed").addEventListener("click", renderFeed);
  } catch (error) {
    if (error.status === 401) return showAuthRequiredError();
    throw error;
  }
}

function startFeedPolling() {
  if (state.feedPollingTimer) return;
  // Poll every 5 seconds so newly logged brews appear quickly in the global feed.
  state.feedPollingTimer = window.setInterval(() => {
    if (!views.feed.classList.contains("hidden")) {
      renderFeed().catch((error) => console.error("feed refresh failed", error));
    }
  }, 5000);
}

function renderCreateForm() {
  views.create.innerHTML = `
    <h2>Create Bag</h2>
    <form id="create-bag-form" class="card">
      <label>Coffee Name *<input name="coffeeName" required /></label>
      <label>Roaster *<input name="roaster" required /></label>
      <label>Origin<input name="origin" /></label>
      <label>Process<input name="process" /></label>
      <label>Roast Date *<input type="date" name="roastDate" required /></label>
      <label>Notes<textarea name="notes"></textarea></label>
      <div class="actions">
        <button type="submit" class="primary">Save Bag</button>
      </div>
      <div id="create-errors"></div>
    </form>
  `;

  const form = document.getElementById("create-bag-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    const cleaned = {
      coffeeName: payload.coffeeName,
      roaster: payload.roaster,
      origin: payload.origin || null,
      process: payload.process || null,
      roastDate: payload.roastDate,
      notes: payload.notes || null,
    };

    try {
      const bag = await api.createBag(cleaned);
      form.reset();
      document.getElementById("create-errors").innerHTML = "";
      await renderMyBags();
      state.selectedBagId = bag.id;
      ensureBagSelected();
      await renderDetail();
      setActiveView("detail");
    } catch (error) {
      document.getElementById("create-errors").innerHTML = renderValidationErrors(error.payload);
    }
  });
}

async function promptEditBag(bag) {
  const coffeeName = window.prompt("Coffee name", bag.coffeeName);
  if (coffeeName === null) return;
  const roaster = window.prompt("Roaster", bag.roaster);
  if (roaster === null) return;
  const origin = window.prompt("Origin (optional)", bag.origin || "");
  if (origin === null) return;
  const process = window.prompt("Process (optional)", bag.process || "");
  if (process === null) return;
  const roastDate = window.prompt(
    "Roast date (YYYY-MM-DD)",
    bag.roastDate ? new Date(bag.roastDate).toISOString().slice(0, 10) : "",
  );
  if (roastDate === null) return;
  const notes = window.prompt("Notes", bag.notes || "");
  if (notes === null) return;

  await api.updateBag(bag.id, {
    coffeeName,
    roaster,
    origin,
    process,
    roastDate,
    notes,
  });
}

async function renderArchived() {
  try {
    const bags = await api.listBags("ARCHIVED");
    views.archived.innerHTML = `<h2>Archived Bags</h2><div id="archived-list"></div>`;
    const list = document.getElementById("archived-list");

    if (!bags.length) {
      list.innerHTML = `<p class="inline-meta">No archived bags</p>`;
      return;
    }

    bags.forEach((bag) => {
      const card = document.createElement("article");
      card.className = "card";
      card.innerHTML = `
        <h3>${bag.coffeeName}</h3>
        <p class="inline-meta">${bag.roaster}</p>
        <p class="inline-meta">${bag.brewCount} brews - avg rating ${bag.averageRating ?? "-"}</p>
        <div class="actions">
          <button class="arch-open">Open</button>
          <button class="arch-analytics">View Analytics</button>
          <button class="arch-unarchive">Unarchive</button>
          <button class="arch-edit">Edit</button>
        </div>
      `;

      card.querySelector(".arch-open").addEventListener("click", async () => {
        state.selectedBagId = bag.id;
        ensureBagSelected();
        await renderDetail();
        setActiveView("detail");
      });

      card.querySelector(".arch-analytics").addEventListener("click", async () => {
        state.selectedBagId = bag.id;
        ensureBagSelected();
        await renderAnalytics();
        setActiveView("analytics");
      });

      card.querySelector(".arch-unarchive").addEventListener("click", async () => {
        await api.unarchiveBag(bag.id);
        await renderArchived();
        await renderMyBags();
      });

      card.querySelector(".arch-edit").addEventListener("click", async () => {
        const bagDetail = await api.getBag(bag.id);
        await promptEditBag(bagDetail);
        await renderArchived();
        await renderMyBags();
      });

      list.appendChild(card);
    });
  } catch (error) {
    if (error.status === 401) return showAuthRequiredError();
    throw error;
  }
}

function brewFormHtml() {
  return `
  <form id="create-brew-form" class="card">
    <h3>Make a Cup</h3>
    <label>Method *
      <select name="method" required>
        <option>Pourover</option>
        <option>Aeropress</option>
        <option>French Press</option>
        <option>Espresso</option>
        <option>Moka Pot</option>
        <option value="__custom__">Custom</option>
      </select>
    </label>
    <label id="custom-method-label" class="hidden">Custom Method *
      <input name="customMethod" placeholder="e.g. Origami Air S" />
    </label>
    <label>Brewer
      <input name="brewer" list="brewer-options" placeholder="e.g. V60, Kalita, Cafec Deep 27, Gaggia Classic" />
      <datalist id="brewer-options">
        <option value="V60"></option>
        <option value="Kalita"></option>
        <option value="Cafec Deep 27"></option>
        <option value="Chemex"></option>
        <option value="Origami"></option>
        <option value="Gaggia Classic"></option>
        <option value="AeroPress"></option>
        <option value="French Press"></option>
        <option value="Moka Pot"></option>
      </datalist>
    </label>
    <label>Grinder<input name="grinder" /></label>
    <label>Dose (gms)<input type="number" name="dose" /></label>
    <label>Grind Setting<input type="number" name="grindSetting" /></label>
    <label>Water Amount (ml)<input type="number" name="waterAmount" /></label>
    ${sliderField("Rating", "rating", 0, 5, 0.1, 3)}
    ${sliderField("Nutty", "nutty", 0, 5, 1, 2)}
    ${sliderField("Acidity", "acidity", 0, 5, 1, 3)}
    ${sliderField("Fruity", "fruity", 0, 5, 1, 3)}
    ${sliderField("Floral", "floral", 0, 5, 1, 3)}
    ${sliderField("Sweetness", "sweetness", 0, 5, 1, 3)}
    ${sliderField("Chocolate", "chocolate", 0, 5, 1, 2)}
    <label>Flavour Notes<textarea name="flavourNotes"></textarea></label>
    <div class="actions"><button type="submit" class="primary">Save Brew</button></div>
    <div id="brew-errors"></div>
  </form>`;
}

async function renderDetail() {
  if (!state.selectedBagId) {
    views.detail.innerHTML = `<p class="inline-meta">Select a bag first.</p>`;
    return;
  }

  const [bag, brews] = await Promise.all([
    api.getBag(state.selectedBagId),
    api.listBrews(state.selectedBagId),
  ]);

  views.detail.innerHTML = `
    <h2>${bag.coffeeName}</h2>
    <p class="inline-meta">${bag.roaster} ${bag.origin ? `- ${bag.origin}` : ""} ${bag.process ? `- ${bag.process}` : ""}</p>
    <p class="inline-meta">Roasted: ${bag.roastDate ? new Date(bag.roastDate).toLocaleDateString() : "-"} | Age: ${bag.roastAgeDays} days | ${bag.restingStatus}</p>
    <p>${bag.notes || ""}</p>

    <div class="actions">
      <button id="refresh-detail" class="ghost">Refresh</button>
      <button id="view-analytics" class="ghost">View Analytics</button>
      <button id="edit-bag" class="ghost">Edit Bag</button>
      <button id="archive-bag" class="warn">Finish Bag</button>
    </div>

    ${brewFormHtml()}

    <h3>Brew History</h3>
    <div id="brew-list">${brewTableHtml(brews, bag.roastDate)}</div>
  `;

  wireSliderOutputs(views.detail);

  document.getElementById("refresh-detail").addEventListener("click", renderDetail);

  document.getElementById("view-analytics").addEventListener("click", async () => {
    await renderAnalytics();
    setActiveView("analytics");
  });

  document.getElementById("edit-bag").addEventListener("click", async () => {
    await promptEditBag(bag);
    await renderMyBags();
    await renderArchived();
    await renderDetail();
  });

  document.getElementById("archive-bag").addEventListener("click", async () => {
    await api.archiveBag(state.selectedBagId);
    state.selectedBagId = null;
    ensureBagSelected();
    await renderMyBags();
    await renderArchived();
    setActiveView("myBags");
  });

  views.detail.querySelectorAll(".set-best").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api.setBestBrew(state.selectedBagId, btn.dataset.brewId);
      await renderDetail();
    });
  });

  const form = document.getElementById("create-brew-form");
  const methodSelect = form.querySelector("select[name='method']");
  const customMethodLabel = form.querySelector("#custom-method-label");
  const customMethodInput = form.querySelector("input[name='customMethod']");

  const syncCustomMethodVisibility = () => {
    const isCustom = methodSelect.value === "__custom__";
    customMethodLabel.classList.toggle("hidden", !isCustom);
    customMethodInput.required = isCustom;
    if (!isCustom) customMethodInput.value = "";
  };
  methodSelect.addEventListener("change", syncCustomMethodVisibility);
  syncCustomMethodVisibility();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    const raw = Object.fromEntries(fd.entries());
    const resolvedMethod =
      raw.method === "__custom__"
        ? String(raw.customMethod || "").trim()
        : raw.method;

    const payload = {
      method: resolvedMethod,
      brewer: raw.brewer || null,
      grinder: raw.grinder || null,
      dose: raw.dose || null,
      grindSetting: raw.grindSetting || null,
      waterAmount: raw.waterAmount || null,
      rating: raw.rating || null,
      nutty: raw.nutty || null,
      acidity: raw.acidity || null,
      fruity: raw.fruity || null,
      floral: raw.floral || null,
      sweetness: raw.sweetness || null,
      chocolate: raw.chocolate || null,
      flavourNotes: raw.flavourNotes || null,
    };

    try {
      if (!payload.method) {
        document.getElementById("brew-errors").innerHTML =
          renderValidationErrors({ errors: [{ field: "customMethod", message: "is required when method is Custom" }] });
        return;
      }
      await api.createBrew(state.selectedBagId, payload);
      document.getElementById("brew-errors").innerHTML = "";
      await renderMyBags();
      await renderArchived();
      await renderDetail();
    } catch (error) {
      document.getElementById("brew-errors").innerHTML = renderValidationErrors(error.payload);
    }
  });
}

async function renderAnalytics() {
  if (!state.selectedBagId) {
    views.analytics.innerHTML = `<p class="inline-meta">Select a bag first.</p>`;
    return;
  }

  const [bag, brews, analytics] = await Promise.all([
    api.getBag(state.selectedBagId),
    api.listBrews(state.selectedBagId),
    api.analytics(state.selectedBagId),
  ]);

  const best = analytics.bestBrew;
  views.analytics.innerHTML = `
    <h2>Analytics - ${bag.coffeeName}</h2>
    <article class="card">
      <h3>Coffee Journey Sheet Snapshot</h3>
      <p class="inline-meta"><strong>Roaster:</strong> ${bag.roaster}</p>
      <p class="inline-meta"><strong>Origin:</strong> ${bag.origin || "-"}</p>
      <p class="inline-meta"><strong>Process:</strong> ${bag.process || "-"}</p>
      <p class="inline-meta"><strong>Roast Date:</strong> ${bag.roastDate ? new Date(bag.roastDate).toLocaleDateString() : "-"}</p>
      <p class="inline-meta"><strong>Bag Age:</strong> ${bag.roastAgeDays} days (${bag.restingStatus})</p>
    </article>

    <article class="card">
      <h3>Brew Journey Table</h3>
      ${brewTableHtml([...brews].reverse(), bag.roastDate)}
    </article>

    <article class="card">
      <h3>Best Recipe So Far</h3>
      ${
        best
          ? `<p><strong>Method:</strong> ${best.method}</p>
             <p><strong>Dose:</strong> ${best.dose ?? "-"} gms</p>
             <p><strong>Water:</strong> ${best.waterAmount ?? "-"} ml</p>
             <p><strong>Grinder:</strong> ${best.grinder || "-"}</p>
             <p><strong>Grind Setting:</strong> ${best.grindSetting ?? "-"}</p>
             <p><strong>Rating:</strong> ${best.rating ?? "-"}</p>
             <p><strong>Notes:</strong> ${best.flavourNotes || "-"}</p>`
          : "<p class='inline-meta'>No best brew selected yet.</p>"
      }
    </article>

    <article class="card">
      <h3>Taste Profile Averages</h3>
      <div class="table-wrap">
        <table>
          <tbody>
            <tr><th>Nutty</th><td>${analytics.averageTasteProfile.nutty ?? "-"}</td></tr>
            <tr><th>Acidity</th><td>${analytics.averageTasteProfile.acidity ?? "-"}</td></tr>
            <tr><th>Fruity</th><td>${analytics.averageTasteProfile.fruity ?? "-"}</td></tr>
            <tr><th>Floral</th><td>${analytics.averageTasteProfile.floral ?? "-"}</td></tr>
            <tr><th>Sweetness</th><td>${analytics.averageTasteProfile.sweetness ?? "-"}</td></tr>
            <tr><th>Chocolate</th><td>${analytics.averageTasteProfile.chocolate ?? "-"}</td></tr>
          </tbody>
        </table>
      </div>
      <p class="inline-meta">Total Brews: ${analytics.totalBrews} | Average Rating: ${analytics.averageRating ?? "-"}</p>
    </article>

    <div class="actions">
      <button id="analytics-back" class="ghost">Back to Bag</button>
    </div>
  `;

  views.analytics.querySelectorAll(".set-best").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api.setBestBrew(state.selectedBagId, btn.dataset.brewId);
      await renderAnalytics();
    });
  });

  document.getElementById("analytics-back").addEventListener("click", async () => {
    await renderDetail();
    setActiveView("detail");
  });
}

async function initAuth() {
  const supabaseUrl = window.APP_CONFIG?.supabaseUrl;
  const supabaseAnonKey = window.APP_CONFIG?.supabaseAnonKey;

  if (supabaseUrl && supabaseAnonKey) {
    state.supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { data } = await state.supabase.auth.getSession();
    state.accessToken = data.session?.access_token ?? null;

    state.supabase.auth.onAuthStateChange((_event, session) => {
      state.accessToken = session?.access_token ?? null;
      updateAuthStatus();
      renderMyBags().catch(() => {});
      renderFeed().catch(() => {});
      renderArchived().catch(() => {});
      if (state.selectedBagId) {
        renderDetail().catch(() => {});
        renderAnalytics().catch(() => {});
      }
    });
  }

  authElements.emailLogin.addEventListener("click", async () => {
    if (!state.supabase) return;
    const email = authElements.emailInput.value.trim();
    if (!email) {
      alert("Enter email first");
      return;
    }

    const { error } = await state.supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/app/`,
      },
    });

    if (error) {
      alert(error.message);
      return;
    }

    alert("Magic link sent. Open your email on this device.");
  });

  authElements.googleLogin.addEventListener("click", async () => {
    if (!state.supabase) return;
    const { error } = await state.supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/app/`,
      },
    });
    if (error) alert(error.message);
  });

  authElements.logout.addEventListener("click", async () => {
    if (!state.supabase) return;
    await state.supabase.auth.signOut();
    state.accessToken = null;
    updateAuthStatus();
  });

  state.authReady = true;
  updateAuthStatus();
}

navButtons.myBags.addEventListener("click", async () => {
  await renderMyBags();
  setActiveView("myBags");
});

navButtons.feed.addEventListener("click", async () => {
  await renderFeed();
  setActiveView("feed");
});

navButtons.create.addEventListener("click", () => {
  renderCreateForm();
  setActiveView("create");
});

navButtons.archived.addEventListener("click", async () => {
  await renderArchived();
  setActiveView("archived");
});

navButtons.detail.addEventListener("click", async () => {
  await renderDetail();
  setActiveView("detail");
});

navButtons.analytics.addEventListener("click", async () => {
  await renderAnalytics();
  setActiveView("analytics");
});

async function bootstrap() {
  await initAuth();
  renderCreateForm();
  await renderMyBags();
  await renderFeed();
  await renderArchived();
  startFeedPolling();
  ensureBagSelected();
  setActiveView("myBags");
}

bootstrap().catch((error) => {
  console.error(error);
  alert("Failed to bootstrap app. Check console.");
});
