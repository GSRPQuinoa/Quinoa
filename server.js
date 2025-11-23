require("dotenv").config();
const express = require("express");
const session = require("express-session");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI =
  process.env.DISCORD_REDIRECT_URI || `http://localhost:${PORT}/api/callback`;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const ALLOWED_ROLE_IDS = (process.env.DISCORD_ALLOWED_ROLE_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
  console.warn(
    "[WARN] Missing DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET in .env"
  );
}
if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
  console.warn("[WARN] Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID in .env");
}

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 10 * 60 * 1000, // 10 minutes
    },
  })
);


app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// serve static files
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// ---- OAUTH LOGIN ----
app.get("/api/login", (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify",
    prompt: "none",
  });

  const url = `https://discord.com/api/oauth2/authorize?${params.toString()}`;
  res.redirect(url);
});

// OAuth callback from Discord
app.get("/api/callback", async (req, res) => {
  const code = req.query.code;
  const error = req.query.error;

  if (error) {
    console.error("Discord OAuth error:", error);
    return res.redirect("/unauthorized.html");
  }
  if (!code) {
    return res.redirect("/unauthorized.html");
  }

  try {
    // 1) exchange code → token
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      console.error("Token exchange failed:", await tokenRes.text());
      return res.redirect("/unauthorized.html");
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // 2) get OAuth user
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      console.error("Failed to fetch /users/@me:", await userRes.text());
      return res.redirect("/unauthorized.html");
    }
    const user = await userRes.json();

    // 3) check guild membership + roles via bot
    const memberRes = await fetch(
      `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${user.id}`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );

    if (!memberRes.ok) {
      console.error("Member fetch failed:", await memberRes.text());
      return res.redirect("/unauthorized.html");
    }

    const member = await memberRes.json();
    const memberRoles = member.roles || [];

    if (ALLOWED_ROLE_IDS.length) {
      const hasAllowed = memberRoles.some((id) => ALLOWED_ROLE_IDS.includes(id));
      if (!hasAllowed) {
        console.warn(`User ${user.id} has no allowed roles`);
        return res.redirect("/unauthorized.html");
      }
    }

    const displayName = member.nick || user.global_name || user.username;

    req.session.user = {
      id: user.id,
      username: user.username,
      discriminator: user.discriminator,
      globalName: user.global_name || null,
      displayName,
      avatar: user.avatar || null,
    };

    res.redirect("/");
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.redirect("/unauthorized.html");
  }
});

app.get("/api/me", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ ok: false });
  }

  try {
    // Re-check the member in the guild every time
    const memberRes = await fetch(
      `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${req.session.user.id}`,
      {
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
      }
    );

    if (!memberRes.ok) {
      // Not in the guild any more
      console.warn(
        `User ${req.session.user.id} failed member re-check:`,
        await memberRes.text()
      );
      req.session.destroy(() => {
        res.status(401).json({ ok: false });
      });
      return;
    }

    const member = await memberRes.json();
    const memberRoles = member.roles || [];

    if (ALLOWED_ROLE_IDS.length) {
      const hasAllowed = memberRoles.some((id) =>
        ALLOWED_ROLE_IDS.includes(id)
      );
      if (!hasAllowed) {
        console.warn(
          `User ${req.session.user.id} lost allowed role(s), destroying session`
        );
        req.session.destroy(() => {
          res.status(401).json({ ok: false });
        });
        return;
      }
    }

    // Still valid – you can update displayName if you like
    const displayName =
      member.nick ||
      req.session.user.globalName ||
      req.session.user.username;

    req.session.user.displayName = displayName;

    res.json({ ok: true, user: req.session.user });
  } catch (err) {
    console.error("Error on /api/me re-check:", err);
    req.session.destroy(() => {
      res.status(401).json({ ok: false });
    });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.listen(PORT, () => {
  console.log(`GSRP portal listening on http://localhost:${PORT}`);
});
