
let currentUser = null;

// ---- AUTH ----
function showLoginOverlay() {
  document.getElementById("loginOverlay").classList.remove("hidden");
}
function hideLoginOverlay() {
  document.getElementById("loginOverlay").classList.add("hidden");
}

function setLoggedInUI(user) {
  currentUser = user;
  hideLoginOverlay();

  const label = user.displayName || user.username;
  document.getElementById("sidebarUserName").textContent = label;
  document.getElementById("sidebarUserRank").textContent =
    user.username + "#" + user.discriminator;
  document.getElementById("topbarUserName").textContent = label;
  document.getElementById("topbarUserRank").textContent =
    user.username + "#" + user.discriminator;
}

async function checkAuth() {
  try {
    const res = await fetch("/api/me", { credentials: "include" });
    if (!res.ok) {
      showLoginOverlay();
      return;
    }
    const data = await res.json();
    if (data && data.ok && data.user) {
      setLoggedInUI(data.user);
    } else {
      showLoginOverlay();
    }
  } catch (e) {
    console.error(e);
    showLoginOverlay();
  }
}

// ---- DISCORD LOGGING ----

function formatDiscordIdsInValue(label, value) {
  if (!value) return value;
  const lower = label.toLowerCase();
  if (!lower.includes("discord id")) return value;
  return value.replace(/\d{15,20}/g, (id) => `<@${id}>`);
}

async function sendToDiscord(formName, fields, user, webhook) {
  const formattedBlocks = fields.map(([key, rawValue]) => {
    const valueWithMentions = formatDiscordIdsInValue(key, rawValue);
    const safeValue =
      valueWithMentions && valueWithMentions.trim() !== ""
        ? valueWithMentions
        : "*n/a*";
    return `**${key}:**\n${safeValue}`;
  });

  const descriptionLines = [
    "Georgia State Roleplay. Cuz We Can.",
    "",
    ...formattedBlocks,
  ];

  const footerText = `Submitted by ${user.displayName || user.username} (${user.username}#${user.discriminator}) | ID: ${user.id}`;

  const payload = {
    username: "Portal Logs",
    embeds: [
      {
        title: formName || "Portal Submission",
        description: descriptionLines.join("\n\n"),
        color: 0xf97316,
        footer: { text: footerText },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Webhook returned " + res.status);
}

function attachFormHandlers() {
  const forms = document.querySelectorAll("form[data-log-to-discord='true']");
  forms.forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentUser) {
        alert("You must be logged in with Discord to submit forms.");
        return;
      }

      const webhook = form.dataset.webhook;
      if (!webhook || webhook.startsWith("YOUR_")) {
        alert("This form does not have a valid Discord webhook configured.");
        return;
      }

      const formName = form.dataset.formName || "Portal Submission";
      const formData = new FormData(form);
      const fields = Array.from(formData.entries());

      const statusId = form.dataset.statusTarget;
      const statusEl = statusId ? document.getElementById(statusId) : null;
      if (statusEl) statusEl.textContent = "Sending to Discord...";

      const submitBtn = form.querySelector("button[type='submit']");
      if (submitBtn) submitBtn.disabled = true;

      try {
        await sendToDiscord(formName, fields, currentUser, webhook);
        if (statusEl) statusEl.textContent = "Logged to Discord ✅";
        form.reset();
      } catch (err) {
        console.error(err);
        if (statusEl) statusEl.textContent = "Error sending to Discord ❌";
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  });
}

// ---- NAV + TABS ----
function showPage(pageKey) {
  document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
  const target = document.getElementById("page-" + pageKey);
  if (target) target.classList.remove("hidden");

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === pageKey);
  });
}

function attachNavHandlers() {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = btn.dataset.page;
      if (page) showPage(page);
    });
  });

  document.querySelectorAll("[data-page-jump]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = btn.dataset.pageJump;
      const tab = btn.dataset.tabJump;
      if (page) {
        showPage(page);
        if (tab) activateTab(tab);
      }
    });
  });
}

function activateTab(tabKey) {
  document.querySelectorAll(".tab-button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabKey);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    const match = panel.id === "tab-" + tabKey;
    panel.classList.toggle("hidden", !match);
  });
}

function attachTabHandlers() {
  document.querySelectorAll(".tab-button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (tab) activateTab(tab);
    });
  });
}

// ---- INIT ----
document.addEventListener("DOMContentLoaded", () => {
  const discordBtn = document.getElementById("discordLoginButton");
  discordBtn.addEventListener("click", () => {
    window.location.href = "/api/login";
  });

  attachFormHandlers();
  attachNavHandlers();
  attachTabHandlers();

  showPage("home");
  activateTab("patrol");
  checkAuth();
});
