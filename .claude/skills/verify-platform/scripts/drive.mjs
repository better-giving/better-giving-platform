#!/usr/bin/env node
// drive apps/platform in headless chromium the way a user does, one flow at a
// time, and write proof: $VERIFY_OUT/results.json, <flow>.png, <flow>.aria.txt,
// <flow>.log.
//   node drive.mjs                  # every flow
//   node drive.mjs home donate-card # named flows
//   node drive.mjs --list
//   node drive.mjs --check-map      # features/, README links, and FLOWS agree
// exit 0 = every selected flow passed; 1 = a flow failed, or the feature map
// disagrees; 2 = a flow was blocked (needs secrets) and nothing failed.
// run from anywhere; resolves playwright from apps/platform.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import zlib from "node:zlib";
import { ADMIN, MEMBER } from "./fixture-accounts.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const APP = path.resolve(HERE, "../../../../apps/platform");
const FEATURE_DIR = path.resolve(HERE, "../features");
const STATE = process.env.VERIFY_STATE ?? "/tmp/bg-verify";
const PORT =
  process.env.VERIFY_PORT ??
  (fs.existsSync(`${STATE}/port`)
    ? fs.readFileSync(`${STATE}/port`, "utf8").trim()
    : "4200");
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve(process.env.VERIFY_OUT ?? "verify-out");
const NPO =
  process.env.VERIFY_NPO_ID ??
  (fs.existsSync(`${STATE}/npo_id`)
    ? fs.readFileSync(`${STATE}/npo_id`, "utf8").trim()
    : "1");
const T = 60_000;
const HOME_TITLE = "Fundraising Platform for Nonprofits - Better Giving";
const MEMBER_EMAIL = MEMBER.email;
const MEMBER_PASSWORD = MEMBER.password;
// campaign pages. org-slug sets verify-test on Verify Test Nonprofit, which starts without a slug.
const ORG = "verify-campaign";
const SEEDED_CAMPAIGN = "winter";
const SEEDED_CAMPAIGN_ID = "c0ffee00-0000-4000-8000-000000000001";
const SEEDED_FUND = "f0000000-0000-4000-8000-000000000001";
// seed.sql's campaign admin and seed-member.mjs share fixture-accounts.mjs.
const ADMIN_EMAIL = ADMIN.email;
const ADMIN_PASSWORD = ADMIN.password;

class Blocked extends Error {}
const expect_ok = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/** a JSON-RPC `tools/call` on the agent MCP endpoint, recorded as a direct load */
const agents_rpc = (page, entry) => async (id, name, args) => {
  const response = await page.request.post(`${BASE}/agents/mcp`, {
    timeout: 120_000,
    headers: { "content-type": "application/json" },
    data: {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    },
  });
  entry.loaded.push(`POST /agents/mcp tools/call ${name}`);
  expect_ok(
    response.status() === 200,
    `POST /agents/mcp ${name} → ${response.status()}`
  );
  return response.json();
};

// A cold `react-router dev` full-reloads the first time the footer scrolls
// into view, because that prefetches `/donate/1` and Vite optimizes new
// dependencies. The reload cancels the click and leaves the browser on `/`.
// Retry the same click. This is not a second entry point and not a direct load.
const open_link = async (page, locate, pattern) => {
  let last = page.url();
  for (let attempt = 1; attempt <= 3; attempt++) {
    await locate().click();
    try {
      await page.waitForURL(pattern, {
        timeout: attempt < 3 ? 20_000 : 120_000,
      });
      return attempt;
    } catch (err) {
      last = page.url();
      if (pattern.test(new URL(last).pathname)) return attempt;
      if (attempt === 3) {
        throw new Error(`${err.message} (still at ${last})`);
      }
      await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});
    }
  }
  return 3;
};

// First visit to an admin route compiles for a long time, and a Vite reload
// can cancel the click without changing the URL. A reload that puts us back
// is a lost click — try again. A navigation that has left the page keeps its
// 120s wait so a retry does not abort the compile.
const open_cold = async (page, locate, pattern) => {
  const matches = (url) => {
    try {
      return pattern.test(new URL(url).pathname);
    } catch {
      return false;
    }
  };
  let last = page.url();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const before = page.url();
    try {
      await locate().click({ timeout: 15_000 });
    } catch (err) {
      if (attempt === 3) throw err;
      await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});
      continue;
    }
    // A lost click never moves the URL. A real one does, immediately for a
    // client transition, and the document behind it may still be compiling.
    try {
      await page.waitForURL(
        (url) => pattern.test(url.pathname) || url.href !== before,
        { timeout: attempt < 3 ? 8_000 : 120_000 }
      );
    } catch (err) {
      last = page.url();
      if (matches(last)) return attempt;
      if (attempt === 3) {
        throw new Error(`${err.message} (still at ${last})`);
      }
      continue;
    }
    if (matches(page.url())) return attempt;
    try {
      await page.waitForURL(pattern, { timeout: 120_000 });
      return attempt;
    } catch (err) {
      last = page.url();
      if (matches(last)) return attempt;
      if (attempt === 3) {
        throw new Error(`${err.message} (still at ${last})`);
      }
    }
  }
  throw new Error(`click did not navigate (still at ${last})`);
};

const readme_ids = () => {
  const readme = fs.readFileSync(path.join(FEATURE_DIR, "README.md"), "utf8");
  return [
    ...new Set(
      [...readme.matchAll(/\]\((?:\.\/)?([a-z0-9-]+)\.md\)/g)].map((m) => m[1])
    ),
  ];
};

// features/<id>.md, a README link to that file, and a FLOWS key are one set.
// a pass does not paper over a missing side of that set.
const assert_map = (flows) => {
  const files = fs
    .readdirSync(FEATURE_DIR)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => name.slice(0, -3))
    .sort();
  const keys = Object.keys(flows).sort();
  const linked = readme_ids().sort();
  const problems = [];
  const missing = (have, want) => have.filter((id) => !want.includes(id));
  const no_drive = missing(files, keys);
  const no_file = missing(keys, files);
  const no_index = missing(keys, linked);
  const link_without_drive = missing(linked, keys);
  const link_without_file = missing(linked, files);
  if (no_drive.length) problems.push(`no drive entry: ${no_drive.join(", ")}`);
  if (no_file.length) problems.push(`no feature file: ${no_file.join(", ")}`);
  if (no_index.length) problems.push(`README missing: ${no_index.join(", ")}`);
  if (link_without_drive.length) {
    problems.push(
      `README link is not a flow: ${link_without_drive.join(", ")}`
    );
  }
  if (link_without_file.length) {
    problems.push(
      `README link has no feature file: ${link_without_file.join(", ")}`
    );
  }
  if (problems.length) throw new Error(problems.join("; "));
};

const click_fact = (label, tries) =>
  tries > 1 ? `${label} (retried after a reload, attempt ${tries})` : label;

// a connector code is a secret in the landing URL. logs name that it is
// present and never include the value.
const shown_url = (raw) => {
  try {
    const u = new URL(raw);
    if (!u.searchParams.has("code")) return raw.slice(0, 160);
    u.searchParams.set("code", "present");
    return u.toString().slice(0, 160);
  } catch {
    return raw.slice(0, 160);
  }
};

const allow_landing = async (page) => {
  try {
    await page.waitForFunction(
      (iss) => {
        const u = new URL(location.href);
        const code = u.searchParams.get("code") ?? "";
        return (
          u.origin === iss &&
          u.pathname === "/marketplace" &&
          u.searchParams.get("iss") === iss &&
          u.searchParams.get("state") === "verify-state-1" &&
          code.length > 0
        );
      },
      BASE,
      { timeout: T }
    );
  } catch {
    const u = new URL(page.url());
    const code = u.searchParams.get("code") ?? "";
    throw new Error(
      `Allow did not land on /marketplace with iss, state=verify-state-1, and a code (path ${u.pathname}, iss ${u.searchParams.get("iss") ?? "missing"}, state ${u.searchParams.get("state") ?? "missing"}, code ${code.length > 0 ? "present" : "absent"})`
    );
  }
  const u = new URL(page.url());
  return {
    pathname: u.pathname,
    iss: u.searchParams.get("iss"),
    state: u.searchParams.get("state"),
  };
};

// The footer prefetch of `/donate/1` makes Vite optimize new dependencies.
// The next direct load of that route can 504 those files (`Outdated Optimize
// Dep`). The document is still 200, and the amount buttons stay disabled
// because the client never hydrates. Reload the same URL and click again.
const click_after_reload = async (page, locate) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await locate().click({ timeout: attempt < 3 ? 20_000 : T });
      return attempt;
    } catch (err) {
      if (attempt === 3) throw err;
      await page.reload({ waitUntil: "load", timeout: 120_000 });
    }
  }
  return 3;
};

const assert_no_fundraiser = async (page, where, allowed = []) => {
  let text = await page.locator("body").innerText();
  for (const phrase of allowed) text = text.replaceAll(phrase, "");
  expect_ok(!/fundraiser/i.test(text), `${where} shows the word fundraiser`);
};

const sign_in_admin = async (page, entry) => {
  const dest = "/dashboard";
  const r = await page.goto(
    `${BASE}/login?redirect=${encodeURIComponent(dest)}`,
    { waitUntil: "load", timeout: 120_000 }
  );
  entry.loaded.push("GET /login?redirect=/dashboard");
  expect_ok(r.status() === 200, `GET /login → ${r.status()}`);
  await page.locator('input[name="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Log In", exact: true }).click();
  entry.clicked.push("Log In");
  await page.waitForURL(/\/dashboard(?:\?|$)/, { timeout: T });
};

// uncompressed RGB png. the hero cropper needs a real file, not a placeholder.
const png_rgb = (w, h, rgb) => {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = rgb[0];
      raw[row + 2 + x * 3] = rgb[1];
      raw[row + 3 + x * 3] = rgb[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const chunk = (type, data) => {
    const name = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([name, data])) >>> 0);
    return Buffer.concat([len, name, data, crc]);
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const decode_qr = (png) => {
  try {
    return execFileSync("zbarimg", ["--quiet", "--raw", png], {
      encoding: "utf8",
    }).trim();
  } catch (err) {
    const detail = err.stderr?.toString?.() || err.message;
    throw new Error(`could not decode the QR (${detail.trim()})`);
  }
};

const payment_blocked = (body, ctx) => {
  const pay_err = /couldn.t start the payment[^\n]*/i.exec(body)?.[0];
  const stub = fs.existsSync(`${STATE}/stripe-stub.log`)
    ? fs.readFileSync(`${STATE}/stripe-stub.log`, "utf8")
    : "";
  const stubbed = [...stub.matchAll(/ (GET|POST|DELETE) (\S+) → 400/g)].map(
    (m) => `${m[1]} ${m[2].split("?")[0]}`
  );
  return { pay_err, stubbed, filler: ctx.pk.includes("test-only") };
};

// each flow: ({page, log, shot, entry, ctx}) → string[] of observed facts.
// throw = fail. `entry.clicked` and `entry.loaded` start empty. Append a
// click or a direct load when that step runs. A step the flow never reaches
// stays off the list, including a listed feature-file entry this recipe skips.
const FLOWS = {
  home: {
    desc: "landing page renders with header nav and a sign-in link",
    async run({ page, shot, entry }) {
      const r = await page.goto(`${BASE}/`, {
        waitUntil: "load",
        timeout: 120_000,
      });
      entry.loaded.push("GET /");
      expect_ok(r.status() === 200, `GET / → ${r.status()}`);
      const title = await page.title();
      expect_ok(
        title === HOME_TITLE,
        `title "${title}", expected "${HOME_TITLE}"`
      );
      // href only. the login flow clicks this control.
      const login = page
        .getByRole("banner")
        .getByRole("link", { name: "Log In", exact: true });
      await login.waitFor({ timeout: T });
      const href = await login.getAttribute("href");
      const dest = new URL(href ?? "", page.url());
      expect_ok(
        dest.origin === new URL(BASE).origin && dest.pathname === "/login",
        `login link → ${href}, expected /login`
      );
      await shot();
      return [
        `GET / → 200`,
        `title "${title}"`,
        `header Log In href → ${href} (not clicked in this flow)`,
      ];
    },
  },
  login: {
    desc: "header Log In opens sign-in; a wrong password is rejected; /login also loads directly",
    async run({ page, shot, entry }) {
      const home = await page.goto(`${BASE}/`, {
        waitUntil: "load",
        timeout: 120_000,
      });
      expect_ok(home.status() === 200, `GET / → ${home.status()}`);
      const login_link = () =>
        page
          .getByRole("banner")
          .getByRole("link", { name: "Log In", exact: true });
      const tries = await open_link(page, login_link, /\/login(?:\?|$)/);
      entry.clicked.push("header Log In");
      await page
        .getByRole("button", { name: "Continue with Google" })
        .waitFor({ timeout: T });
      await page
        .locator('input[name="email"]')
        .fill("verify-nobody@example.com");
      await page.locator('input[name="password"]').fill("Wrong-password-123!");
      await shot("filled");
      await page.getByRole("button", { name: "Log In", exact: true }).click();
      const err = page.getByText(/invalid email or password/i).first();
      await err.waitFor({ timeout: T });
      const msg = (await err.innerText()).trim().slice(0, 160);
      await shot();
      expect_ok(
        new URL(page.url()).pathname.startsWith("/login"),
        `navigated away to ${page.url()}`
      );
      const direct = await page.goto(`${BASE}/login`, {
        waitUntil: "load",
        timeout: 120_000,
      });
      entry.loaded.push("GET /login");
      expect_ok(direct.status() === 200, `GET /login → ${direct.status()}`);
      await page
        .getByRole("button", { name: "Continue with Google" })
        .waitFor({ timeout: T });
      await shot("direct");
      return [
        click_fact("header Log In click → /login", tries),
        "google + email/password form present",
        `bad creds → stayed on /login, error "${msg}"`,
        "direct GET /login → 200",
      ];
    },
  },
  marketplace: {
    desc: "footer Marketplace opens the list; /marketplace also loads directly; the seeded nonprofit is listed",
    async run({ page, shot, entry }) {
      const home = await page.goto(`${BASE}/`, {
        waitUntil: "load",
        timeout: 120_000,
      });
      expect_ok(home.status() === 200, `GET / → ${home.status()}`);
      const marketplace_link = () =>
        page
          .getByRole("contentinfo")
          .getByRole("link", { name: "Marketplace", exact: true });
      const tries = await open_link(
        page,
        marketplace_link,
        /\/marketplace(?:\?|$)/
      );
      entry.clicked.push("footer Marketplace");
      const card = page.getByText("Verify Test Nonprofit").first();
      await card.waitFor({ timeout: T });
      await shot();
      const direct = await page.goto(`${BASE}/marketplace`, {
        waitUntil: "load",
        timeout: 120_000,
      });
      entry.loaded.push("GET /marketplace");
      expect_ok(
        direct.status() === 200,
        `GET /marketplace → ${direct.status()}`
      );
      await card.waitFor({ timeout: T });
      await shot("direct");
      return [
        click_fact("footer Marketplace click → /marketplace", tries),
        "direct GET /marketplace → 200",
        "seeded 'Verify Test Nonprofit' card visible (db read path works)",
      ];
    },
  },
  "donate-card": {
    desc: "donate form for the seeded npo, loaded directly: pick amount → card → donor info → payment step (stripe)",
    async run({ page, shot, ctx, entry }) {
      const r = await page.goto(`${BASE}/donate/${NPO}`, {
        waitUntil: "load",
        timeout: 120_000,
      });
      entry.loaded.push("GET /donate/:id");
      expect_ok(r.status() === 200, `GET /donate/${NPO} → ${r.status()}`);
      await page
        .getByText("Verify Test Nonprofit")
        .first()
        .waitFor({ timeout: T });
      const cur = await page.request.get(`${BASE}/api/currencies`);
      const amount_tries = await click_after_reload(page, () =>
        page.getByRole("button", { name: "+100 USD" })
      );
      await shot("1-amount");
      await page.getByRole("button", { name: /Continue with Card/ }).click();
      await page.getByText("Payment information").waitFor({ timeout: T });
      await page.locator('input[name="email"]').fill("donor@example.com");
      await page.locator('input[name="first_name"]').fill("Verify");
      await page.locator('input[name="last_name"]').fill("Donor");
      await shot("2-donor");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      // payment step: donation summary, then stripe creates a payment intent
      // (server) and mounts the payment element (stripe.js iframe)
      await page.getByText("Your donation summary").waitFor({ timeout: T });
      await page.waitForTimeout(8000);
      await shot("3-payment");
      const body = await page.locator("body").innerText();
      expect_ok(
        /Total donation\s*\$100\.00/.test(body),
        "summary doesn't show Total donation $100.00"
      );
      const facts = [
        `direct GET /donate/${NPO} → 200`,
        `GET /api/currencies → ${cur.status()}`,
        click_fact(
          "amount +100 USD → Continue with Card → donor info → Continue",
          amount_tries
        ),
        "payment step: 'Your donation summary', Total donation $100.00",
        "marketplace card Donate was not clicked",
      ];
      const pay_err = /couldn.t start the payment[^\n]*/i.exec(body)?.[0];
      const stub = fs.existsSync(`${STATE}/stripe-stub.log`)
        ? fs.readFileSync(`${STATE}/stripe-stub.log`, "utf8")
        : "";
      const stubbed = [...stub.matchAll(/ (GET|POST|DELETE) (\S+) → 400/g)].map(
        (m) => `${m[1]} ${m[2].split("?")[0]}`
      );
      const pi_stubbed = stubbed.length > 0;
      if (pay_err && (ctx.pk.includes("test-only") || pi_stubbed)) {
        facts.push(`shows "${pay_err.trim()}"`);
        if (pi_stubbed)
          facts.push(
            `server stripe calls refused by the local stub (filler STRIPE_SECRET_KEY): ${[...new Set(stubbed)].join(", ")}`
          );
        throw new Blocked(
          `payment step reached; card entry needs a real pk_test_/sk_test_ pair\n  ${facts.join("\n  ")}`
        );
      }
      expect_ok(!pay_err, `payment failed to start with real keys: ${pay_err}`);
      const card = page
        .frameLocator('iframe[title*="Secure payment input"]')
        .first();
      await card
        .locator('input[name="number"]')
        .fill("4242424242424242", { timeout: T });
      await shot("4-card");
      facts.push("stripe payment element accepted test card 4242…");
      return facts;
    },
  },
  "smoke-paths": {
    desc: "smoke.yml's paths answer 2xx/3xx locally: /, /api/currencies, /form-embed.js",
    async run({ page, entry }) {
      const facts = [];
      for (const p of ["/", "/api/currencies", "/form-embed.js"]) {
        const r = await page.request.get(`${BASE}${p}`, { timeout: 120_000 });
        entry.loaded.push(`GET ${p}`);
        facts.push(`${p} → ${r.status()}`);
        expect_ok(r.status() < 400, `${p} → ${r.status()}`);
      }
      return facts;
    },
  },
  "connector-allow": {
    desc: "seeded member allows a connector for the nonprofit they administer",
    async run({ page, shot, entry }) {
      const login = await page.goto(`${BASE}/login`, {
        waitUntil: "load",
        timeout: 120_000,
      });
      entry.loaded.push("GET /login");
      expect_ok(login?.status() === 200, `GET /login → ${login?.status()}`);
      // A cold dev server reloads /login and clears the fields. The click then
      // submits an empty form and stays on /login. Refill and click the same
      // button. This does not switch the login entry to another URL.
      const email_box = () =>
        page
          .locator('input[name="email"], input[placeholder="Email address"]')
          .first();
      const password_box = () =>
        page
          .locator('input[name="password"], input[placeholder="Password"]')
          .first();
      const fill_login = async () => {
        const email = email_box();
        await email.waitFor({ state: "visible", timeout: T });
        await email.fill(MEMBER_EMAIL);
        await password_box().fill(MEMBER_PASSWORD);
        if ((await email.inputValue()) !== MEMBER_EMAIL) {
          await email.fill(MEMBER_EMAIL);
          await password_box().fill(MEMBER_PASSWORD);
        }
      };
      const on_login = () => new URL(page.url()).pathname.startsWith("/login");
      let login_tries = 1;
      for (let attempt = 1; attempt <= 3; attempt++) {
        login_tries = attempt;
        try {
          await fill_login();
          await page
            .getByRole("button", { name: "Log In", exact: true })
            .click();
          await page.waitForURL(
            (url) => !new URL(url).pathname.startsWith("/login"),
            {
              timeout: attempt < 3 ? 5_000 : T,
            }
          );
          break;
        } catch {
          if (!on_login()) break;
          if (attempt === 3) throw new Error("Log In stayed on /login");
          await page
            .waitForLoadState("load", { timeout: 30_000 })
            .catch(() => {});
        }
      }
      const allow = await page.goto(
        `${BASE}/admin/connector/allow?state=verify-state-1`,
        { waitUntil: "load", timeout: 120_000 }
      );
      entry.loaded.push("GET /admin/connector/allow?state=verify-state-1");
      const allow_path = new URL(page.url()).pathname;
      expect_ok(
        allow?.status() === 200 && allow_path === "/admin/connector/allow",
        `GET /admin/connector/allow → ${allow?.status()} ${allow_path}`
      );
      await page
        .getByText("Verify Test Nonprofit", { exact: true })
        .waitFor({ timeout: T });
      await shot();
      expect_ok(
        (await page
          .getByText("Verify Other Nonprofit", { exact: true })
          .count()) === 0,
        "Verify Other Nonprofit is on the allow screen"
      );
      await page
        .getByRole("button", { name: "Allow", exact: true })
        .click({ noWaitAfter: true });
      const landed = await allow_landing(page);
      await shot("landed");
      return [
        click_fact(
          "direct GET /login → left /login (header Log In not clicked)",
          login_tries
        ),
        "direct GET /admin/connector/allow?state=verify-state-1",
        "picker shows Verify Test Nonprofit and not Verify Other Nonprofit",
        `Allow → ${landed.pathname} iss=${landed.iss} state=${landed.state} code present`,
      ];
    },
  },
  "agents-find": {
    desc: "MCP find_nonprofit returns the seeded nonprofit and a flagged off-marketplace EIN; quote_donation refuses that EIN",
    async run({ page, entry }) {
      const rpc = agents_rpc(page, entry);

      const found = await rpc(1, "find_nonprofit", {
        query: "Verify Test Nonprofit",
      });
      const body = found.result?.structuredContent;
      expect_ok(body, "find_nonprofit returned no structuredContent");
      const names = (body.items ?? []).map((item) => item.name);
      expect_ok(
        names.includes("Verify Test Nonprofit"),
        `items missing the seeded nonprofit: ${JSON.stringify(names)}`
      );
      const seeded = body.items.find(
        (item) => item.name === "Verify Test Nonprofit"
      );
      expect_ok(
        Array.isArray(seeded.increments) && seeded.increments.length === 0,
        `seeded nonprofit increments ${JSON.stringify(seeded.increments)}`
      );
      const flagged = (body.not_on_better_giving ?? []).find(
        (row) => row.ein === "990000001"
      );
      expect_ok(flagged, "eligible EIN missing from not_on_better_giving");
      expect_ok(flagged.donatable === false, "flagged entry is donatable");
      expect_ok(
        flagged.status === "not_on_better_giving",
        `status ${flagged.status}`
      );
      expect_ok(
        String(flagged.onboarding_url).endsWith("/register"),
        `onboarding_url ${flagged.onboarding_url}`
      );
      expect_ok(
        !("id" in flagged) && !("recipient_id" in flagged),
        "flagged entry carries an id"
      );
      const dumped = JSON.stringify(body);
      expect_ok(!dumped.includes("990000002"), "revoked EIN was returned");
      expect_ok(
        !dumped.includes("Fixture Revoked Org"),
        "revoked org name was returned"
      );

      const quoted = await rpc(2, "quote_donation", {
        recipient_id: "990000001",
        amount: 10,
      });
      expect_ok(
        quoted.result?.isError === true,
        "quote_donation did not refuse the EIN"
      );
      expect_ok(
        quoted.result?.structuredContent?.code === "invalid_input",
        `quote code ${quoted.result?.structuredContent?.code}`
      );

      const stub = fs.existsSync(`${STATE}/nonprofits-stub.log`)
        ? fs.readFileSync(`${STATE}/nonprofits-stub.log`, "utf8")
        : "";
      expect_ok(
        stub.includes("/v1/search"),
        "nonprofits stub did not see a search"
      );
      return [
        "POST /agents/mcp find_nonprofit query → Verify Test Nonprofit in items, increments []",
        "990000001 in not_on_better_giving, donatable false, onboarding_url ends /register, no id",
        "revoked EIN 990000002 absent",
        "POST /agents/mcp quote_donation 990000001 → invalid_input",
        "nonprofits stub logged /v1/search",
      ];
    },
  },
  "agents-quote": {
    desc: "MCP find_nonprofit lists a nonprofit's own increments; quote_donation labels an amount that is one of them",
    async run({ page, entry }) {
      const rpc = agents_rpc(page, entry);
      const found = await rpc(1, "find_nonprofit", {
        query: "Verify Campaign Nonprofit",
      });
      const npo = (found.result?.structuredContent?.items ?? []).find(
        (item) => item.name === "Verify Campaign Nonprofit"
      );
      expect_ok(npo, "items missing Verify Campaign Nonprofit");
      const want = [
        { amount: 25, label: "Fixture: feed a child" },
        { amount: 100, label: "Fixture: plant a grove" },
      ];
      expect_ok(
        JSON.stringify(npo.increments) === JSON.stringify(want),
        `increments ${JSON.stringify(npo.increments)}`
      );

      const label_of = async (id, amount) => {
        const quoted = await rpc(id, "quote_donation", {
          recipient_id: npo.id,
          amount,
        });
        const body = quoted.result?.structuredContent;
        expect_ok(
          quoted.result?.isError !== true && body?.quote_token,
          `quote ${amount} refused: ${JSON.stringify(body)}`
        );
        return body.increment_label;
      };
      const on_increment = await label_of(2, 25);
      expect_ok(
        on_increment === "Fixture: feed a child",
        `quote 25 increment_label ${JSON.stringify(on_increment)}`
      );
      const off_increment = await label_of(3, 30);
      expect_ok(
        off_increment === null,
        `quote 30 increment_label ${JSON.stringify(off_increment)}`
      );
      return [
        "POST /agents/mcp find_nonprofit Verify Campaign Nonprofit → increments 25, 100 (stored 100, 25, abc)",
        "POST /agents/mcp quote_donation 25 → increment_label Fixture: feed a child",
        "POST /agents/mcp quote_donation 30 → increment_label null",
      ];
    },
  },
  "org-slug": {
    desc: "npo admin sets an org slug once under Manage → Organization; donate and marketplace resolve it",
    async run({ page, shot, entry }) {
      const admin_email = "verify-npo-admin@example.com";
      const admin_password = "Verify-password-123!";
      const slug = "verify-test";
      const note =
        "Changing your org slug would make any links that depend on it stale";
      const login = await page.goto(
        `${BASE}/login?redirect=${encodeURIComponent(`/admin/${NPO}/dashboard`)}`,
        { waitUntil: "load", timeout: 120_000 }
      );
      entry.loaded.push("GET /login?redirect=/admin/:id/dashboard");
      expect_ok(login.status() === 200, `GET /login → ${login.status()}`);
      await page.locator('input[name="email"]').fill(admin_email);
      await page.locator('input[name="password"]').fill(admin_password);
      await page.getByRole("button", { name: "Log In", exact: true }).click();
      await page.waitForURL(new RegExp(`/admin/${NPO}/`), { timeout: T });
      const org = page.getByRole("link", { name: "Organization", exact: true });
      await org.waitFor({ timeout: T });
      await org.click();
      entry.clicked.push("sidebar Organization");
      await page.waitForURL(new RegExp(`/admin/${NPO}/organization`), {
        timeout: T,
      });
      // A cold dev server reloads this page while Vite finishes optimizing
      // dependencies. The reload wipes a slug typed into the previous
      // document, and Save stays disabled because the new form is clean.
      // Wait until the legal name is on screen, then fill and click. If
      // Save never enables, reload and repeat that same fill.
      const save_slug = async () => {
        await page.waitForFunction(
          () => {
            const name = document.querySelector('input[name="name"]');
            return name instanceof HTMLInputElement && name.value.length > 0;
          },
          null,
          { timeout: T }
        );
        const field = page.getByLabel("Org slug");
        await field.waitFor({ timeout: T });
        expect_ok(
          await field.isEnabled(),
          "slug field is disabled before it is set"
        );
        await field.fill(slug);
        await shot("filled");
        await page
          .getByRole("button", { name: "Save organization" })
          .click({ timeout: 20_000 });
      };
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await save_slug();
          break;
        } catch (err) {
          if (attempt === 3) throw err;
          await page.reload({ waitUntil: "load", timeout: 120_000 });
        }
      }
      await page.getByText(note).waitFor({ timeout: T });
      await page.reload({ waitUntil: "load", timeout: 120_000 });
      const locked = page.getByLabel("Org slug");
      await locked.waitFor({ timeout: T });
      expect_ok(
        await locked.isDisabled(),
        "slug field is still editable after reload"
      );
      await page.getByText(note).waitFor({ timeout: T });
      await shot("locked");
      const donate = await page.goto(`${BASE}/donate/${slug}`, {
        waitUntil: "load",
        timeout: 120_000,
      });
      entry.loaded.push("GET /donate/:slug");
      expect_ok(
        donate.status() === 200,
        `GET /donate/${slug} → ${donate.status()}`
      );
      await page
        .getByText("Verify Test Nonprofit")
        .first()
        .waitFor({ timeout: T });
      await shot("donate");
      const market = await page.goto(`${BASE}/marketplace/${slug}`, {
        waitUntil: "load",
        timeout: 120_000,
      });
      entry.loaded.push("GET /marketplace/:slug");
      expect_ok(
        market.status() === 200,
        `GET /marketplace/${slug} → ${market.status()}`
      );
      await page
        .getByText("Verify Test Nonprofit")
        .first()
        .waitFor({ timeout: T });
      await shot("marketplace");
      return [
        "signed in as the seeded npo admin",
        "sidebar Organization click → organization page",
        `set slug ${slug}, reload, field disabled, set-once note visible`,
        `GET /donate/${slug} → 200, Verify Test Nonprofit`,
        `GET /marketplace/${slug} → 200, Verify Test Nonprofit`,
      ];
    },
  },
  "campaign-admin": {
    desc: "signed-in npo admin publishes a campaign from the sidebar and the list shows it live at $0",
    async run({ page, shot, entry }) {
      // the cropper and the first admin documents compile on demand
      page.setDefaultTimeout(120_000);
      page.setDefaultNavigationTimeout(120_000);
      await sign_in_admin(page, entry);
      await page.getByRole("heading", { name: "Verify Admin" }).waitFor({
        timeout: T,
      });
      await assert_no_fundraiser(page, "donor dashboard");
      await shot("donor-dashboard");

      const org_link = () =>
        page.getByRole("link", { name: "Verify Campaign Nonprofit" });
      const org_tries = await open_cold(page, org_link, /\/admin\/\d+/);
      entry.clicked.push("My Organizations → Verify Campaign Nonprofit");
      await page.waitForURL(/\/admin\/\d+\/dashboard(?:\?|$)/, {
        timeout: 120_000,
      });
      const campaigns = () =>
        page.getByRole("link", { name: "Campaigns", exact: true });
      const campaign_tries = await open_cold(
        page,
        campaigns,
        /\/admin\/\d+\/campaigns(?:\?|$)/
      );
      entry.clicked.push("sidebar Campaigns");
      await page
        .getByRole("heading", { name: "Campaigns", exact: true })
        .waitFor({
          timeout: T,
        });

      const profile = page.getByRole("link", { name: /Better Giving profile/ });
      await profile.waitFor({ timeout: T });
      const list_text = await page.locator("main").innerText();
      const profile_at = list_text.indexOf("Better Giving profile");
      const fund_at = list_text.indexOf("Harbor Listing");
      expect_ok(
        profile_at >= 0 && fund_at > profile_at,
        "profile card is not first"
      );
      expect_ok(
        list_text.indexOf("Winter Drive") > profile_at,
        "seeded campaign is not below the profile card"
      );
      await assert_no_fundraiser(page, "campaigns list", [
        "Supporter fundraisers",
      ]);
      await shot("list");

      const profile_tries = await open_cold(
        page,
        () => page.getByRole("link", { name: /Better Giving profile/ }),
        /\/admin\/\d+\/edit-profile(?:\?|$)/
      );
      entry.clicked.push("Better Giving profile");
      await page
        .getByRole("heading", { name: "Public profile information" })
        .waitFor({ timeout: 120_000 });
      await shot("edit-profile");
      // History back races a Vite reload and aborts. The sidebar link is live
      // on Edit Profile, so use it to return to the list.
      const back_tries = await open_cold(
        page,
        () => page.getByRole("link", { name: "Campaigns", exact: true }),
        /\/admin\/\d+\/campaigns(?:\?|$)/
      );
      await page
        .getByRole("heading", { name: "Campaigns", exact: true })
        .waitFor({
          timeout: 120_000,
        });

      const new_tries = await open_cold(
        page,
        () => page.getByRole("link", { name: "New campaign" }),
        /\/admin\/\d+\/campaigns\/new(?:\?|$)/
      );
      entry.clicked.push("New campaign");
      await page.getByRole("heading", { name: "New campaign" }).waitFor({
        timeout: 120_000,
      });
      await page.getByLabel("Name", { exact: true }).fill("Spring Drive");
      await page.getByLabel("Address", { exact: true }).fill("spring-drive");
      // The date field also mounts contenteditable segments (mm / dd / yyyy)
      // before the story editor finishes loading. Type into the story editor
      // itself, and wait until its counter matches: the editor commits to the
      // form a moment after the text is on screen.
      const story_text = "Neighbors funding a spring drive.";
      const story = page.locator(".rich-text-toolbar [contenteditable='true']");
      await story.waitFor();
      await story.click();
      await page.keyboard.insertText(story_text);
      await page
        .getByText(new RegExp(`chars\\s*:\\s*${story_text.length}\\s*/`, "i"))
        .waitFor();
      const hero = path.join(OUT, "campaign-hero.png");
      fs.writeFileSync(hero, png_rgb(400, 100, [20, 90, 140]));
      const uploaded = page.waitForResponse(
        (r) =>
          r.url().includes("/api/file-upload") &&
          r.request().method() === "POST",
        { timeout: T }
      );
      await page.locator("#campaign-banner").setInputFiles(hero);
      await page.getByRole("button", { name: "Save cropped image" }).click();
      const upload = await uploaded;
      expect_ok(upload.status() === 200, `hero upload → ${upload.status()}`);
      // The goal option is an Ark hidden input. The visible label is the control.
      await page.getByText("Set my own goal", { exact: true }).click();
      await page.getByLabel("Amount to raise").fill("2500");
      const segments = page.getByRole("spinbutton");
      const type_date = async (index, digits) => {
        await segments.nth(index).click();
        await page.keyboard.type(digits);
      };
      await type_date(2, "2027");
      await type_date(0, "06");
      await type_date(1, "30");
      await page.keyboard.press("Tab");
      const card = page.getByRole("checkbox", { name: "Card" });
      expect_ok(await card.isChecked(), "Card method is off");
      await page
        .getByRole("button", { name: "Add donation increment" })
        .click();
      await page.locator('input[type="number"]').first().fill("100");
      await shot("form");
      await page.getByRole("button", { name: "Publish" }).click();
      try {
        await page.waitForURL(/\/admin\/\d+\/campaigns\/(?!new$)[^/]+$/, {
          timeout: 120_000,
        });
      } catch (err) {
        const msgs = (
          await page.locator(".text-destructive-subtle-fg").allInnerTexts()
        )
          .map((t) => t.trim())
          .filter(Boolean);
        throw new Error(
          `${err.message} (still at ${page.url()}; ${msgs.join(" | ") || "no field error"})`
        );
      }
      await page
        .getByRole("heading", { name: "QR Code" })
        .waitFor({ timeout: 120_000 });
      const qr_tab = page.getByRole("tab", { name: "Campaign" });
      if ((await qr_tab.count()) > 0) await qr_tab.click();
      const logo_box = page.locator("#show-logo");
      if (await logo_box.isChecked()) await logo_box.uncheck();
      const shown = (
        await page.locator("span.font-mono").first().innerText()
      ).trim();
      const qr_png = path.join(OUT, "campaign-admin-qr-code.png");
      await page.locator("#qr-code-svg").screenshot({ path: qr_png });
      const decoded = decode_qr(qr_png);
      const expected = `${BASE}/org/${ORG}/spring-drive`;
      expect_ok(
        decoded === expected,
        `QR decoded ${decoded}, expected ${expected}`
      );
      expect_ok(
        shown === expected,
        `QR caption ${shown}, expected ${expected}`
      );
      await shot("qr");

      const on_list = () =>
        /\/admin\/\d+\/campaigns\/?$/.test(new URL(page.url()).pathname);
      const back_to_list = async () => {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await page.goBack({ waitUntil: "load", timeout: 120_000 });
            return;
          } catch (err) {
            if (on_list()) return;
            if (attempt === 3) throw err;
            await page
              .waitForLoadState("load", { timeout: 30_000 })
              .catch(() => {});
          }
        }
      };
      await back_to_list();
      if (!on_list()) await back_to_list();
      await page
        .getByRole("heading", { name: "Campaigns", exact: true })
        .waitFor({
          timeout: T,
        });
      const after = await page.locator("main").innerText();
      expect_ok(
        /Spring Drive[\s\S]*live · \$0 raised/.test(after),
        "published campaign is not live at $0"
      );
      expect_ok(
        after.includes("Harbor Listing"),
        "existing listing is missing"
      );
      await assert_no_fundraiser(page, "campaigns list after publish", [
        "Supporter fundraisers",
      ]);
      await shot("published");

      const fund = await page.goto(`${BASE}/fundraisers/${SEEDED_FUND}`, {
        waitUntil: "load",
        timeout: 120_000,
      });
      entry.loaded.push("GET /fundraisers/:id");
      expect_ok(
        fund.status() === 200,
        `GET /fundraisers/${SEEDED_FUND} → ${fund.status()}`
      );
      await page.getByText("Harbor Listing").first().waitFor({ timeout: T });
      await assert_no_fundraiser(page, "/fundraisers/:id");
      await shot("fund-page");
      return [
        click_fact("organization card → /admin", org_tries),
        click_fact("sidebar Campaigns", campaign_tries),
        click_fact("Better Giving profile → Edit Profile", profile_tries),
        click_fact("sidebar Campaigns, back to the list", back_tries),
        click_fact("New campaign", new_tries),
        "signed in, clicked sidebar Campaigns",
        "pinned profile card opened Edit Profile",
        "published Spring Drive, live · $0 raised, Harbor Listing on the list",
        `QR decoded ${decoded}`,
        "donor dashboard, campaigns list, and /fundraisers/:id do not show fundraiser",
      ];
    },
  },
  "campaign-page": {
    desc: "public campaign page, org redirect, and draft/unknown 404s",
    async run({ page, shot, entry }) {
      const url = `${BASE}/org/${ORG}/${SEEDED_CAMPAIGN}`;
      let r = await page.goto(url, { waitUntil: "load", timeout: 120_000 });
      entry.loaded.push("GET /org/:org/:campaign");
      expect_ok(
        r.status() === 200,
        `GET /org/${ORG}/${SEEDED_CAMPAIGN} → ${r.status()}`
      );
      // The supporter wall is client-rendered. A cold load 504s newly
      // optimized deps, the document stays 200, and the wall never mounts.
      // Reload the same URL. That is not a second entry.
      let wall_tries = 1;
      for (let attempt = 1; attempt <= 3; attempt++) {
        wall_tries = attempt;
        try {
          await page.getByText("Seeded campaign thanks").waitFor({
            timeout: attempt < 3 ? 15_000 : T,
          });
          break;
        } catch (err) {
          if (attempt === 3) throw err;
          r = await page.reload({ waitUntil: "load", timeout: 120_000 });
          expect_ok(
            r?.status() === 200,
            `reload /org/${ORG}/${SEEDED_CAMPAIGN} → ${r?.status()}`
          );
        }
      }
      await page.getByRole("heading", { name: "Winter Drive" }).waitFor({
        timeout: T,
      });
      const hero = await page.locator("img.aspect-video").getAttribute("src");
      expect_ok((hero ?? "").includes("logo.png"), `hero src ${hero}`);
      await page.getByText("A winter story for the seeded campaign.").waitFor({
        timeout: T,
      });
      const video = page.locator("iframe[title='Play video: Winter Drive']");
      await video.waitFor({ timeout: T });
      await video.scrollIntoViewIfNeeded();
      await page.waitForFunction(
        () =>
          document
            .querySelector("iframe[title='Play video: Winter Drive']")
            ?.getAttribute("src")
            ?.includes("aqz-KE-bpKQ"),
        { timeout: T }
      );
      const body = await page.locator("body").innerText();
      expect_ok(
        body.includes("$25") && body.includes("$5,000"),
        "progress/goal missing"
      );
      expect_ok(
        body.includes("raised of") && body.includes("goal"),
        "goal label missing"
      );
      expect_ok(
        !body.includes("About this campaign"),
        "page contains About this campaign"
      );
      expect_ok(
        !body.includes("Spread the word!"),
        "page contains Spread the word!"
      );
      // Heading role, not a body substring: a story can say "videos".
      expect_ok(
        (await page
          .getByRole("heading", { name: "Videos", exact: true })
          .count()) === 0,
        "page has a Videos heading"
      );
      expect_ok(
        (await page.getByRole("button", { name: "+100 USD" }).count()) === 0,
        "+100 USD is on the page before Donate"
      );
      expect_ok(
        (await page
          .getByRole("button", { name: /Continue with Card/ })
          .count()) === 0,
        "Continue with Card is on the page before Donate"
      );
      expect_ok(
        (await page
          .getByRole("button", { name: "Share on LinkedIn" })
          .count()) === 0,
        "Share on LinkedIn is on the page before Share"
      );
      await page.getByText("Seeded campaign thanks").waitFor({ timeout: T });
      expect_ok(
        !(await page.locator("body").innerText()).includes(
          "Profile only gift note"
        ),
        "profile-only gift is on the campaign wall"
      );
      await page.getByText("Better Giving", { exact: true }).last().waitFor({
        timeout: T,
      });
      expect_ok(
        (await page
          .getByRole("link", { name: "Log In", exact: true })
          .count()) === 0,
        "platform Log In is on the campaign page"
      );
      await assert_no_fundraiser(page, "campaign page");
      const title = await page.title();
      expect_ok(title === "Winter Drive - Better Giving", `title "${title}"`);
      const description = await page
        .locator('meta[name="description"]')
        .getAttribute("content");
      expect_ok(
        (description ?? "").includes("A winter story for the seeded campaign."),
        `description "${description}"`
      );
      const image = await page
        .locator('meta[property="og:image"]')
        .getAttribute("content");
      expect_ok((image ?? "").includes("logo.png"), `og:image "${image}"`);
      await shot();

      // .first(): the sticky bar duplicates Donate and Share once the inline
      // Donate leaves the viewport. Close unmounts the donate dialog so Share
      // is clickable.
      await page
        .getByRole("button", { name: "Donate", exact: true })
        .first()
        .click();
      await page.getByRole("button", { name: /Continue with Card/ }).waitFor({
        timeout: T,
      });
      await shot("donate");
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: /Continue with Card/ }).waitFor({
        state: "hidden",
        timeout: T,
      });
      await page
        .getByRole("button", { name: "Share", exact: true })
        .first()
        .click();
      await page.getByRole("button", { name: "Share on LinkedIn" }).waitFor({
        timeout: T,
      });
      await shot("share");

      const org = await page.request.get(`${BASE}/org/${ORG}`, {
        maxRedirects: 0,
        timeout: 120_000,
      });
      entry.loaded.push("GET /org/:org");
      expect_ok(org.status() === 302, `GET /org/${ORG} → ${org.status()}`);
      const location = org.headers().location ?? "";
      expect_ok(
        location.endsWith(`/marketplace/${ORG}`),
        `Location ${location}`
      );
      for (const slug of ["draft-hidden", "no-such-campaign"]) {
        const missing = await page.request.get(`${BASE}/org/${ORG}/${slug}`, {
          timeout: 120_000,
        });
        entry.loaded.push(`GET /org/:org/${slug}`);
        expect_ok(
          missing.status() === 404,
          `GET /org/${ORG}/${slug} → ${missing.status()}`
        );
      }
      return [
        wall_tries > 1
          ? `supporter wall after reload ${wall_tries} of the same URL`
          : "supporter wall on the first load",
        `GET /org/${ORG}/${SEEDED_CAMPAIGN} → 200, hero, story, video, goal, wall, badge, no Log In`,
        "Donate opens Continue with Card; Share opens Share on LinkedIn",
        "no About this campaign, Spread the word!, or Videos heading",
        `title "${title}", description and og:image set`,
        `GET /org/${ORG} → 302 ${location}`,
        "draft-hidden and no-such-campaign → 404",
        "profile-only gift is not on the wall",
      ];
    },
  },
  "campaign-donate": {
    desc: "campaign donate dialog presets a query, then a card gift of $100 carries campaign_id",
    async run({ page, shot, ctx, entry }) {
      const preset_url = `${BASE}/org/${ORG}/${SEEDED_CAMPAIGN}?amount=50&frequency=monthly`;
      const preset = await page.goto(preset_url, {
        waitUntil: "load",
        timeout: 120_000,
      });
      entry.loaded.push("GET /org/:org/:campaign?amount=50&frequency=monthly");
      expect_ok(preset.status() === 200, `preset GET → ${preset.status()}`);
      await page.locator("#amount").waitFor({ timeout: T });
      const preset_amount = await page.locator("#amount").inputValue();
      expect_ok(preset_amount === "50", `amount preset "${preset_amount}"`);
      const monthly = page.getByRole("radio", { name: "Give Monthly" });
      await monthly.waitFor({ timeout: T });
      expect_ok(await monthly.isChecked(), "Give Monthly is not selected");
      await shot("1-preset");

      const plain = await page.goto(`${BASE}/org/${ORG}/${SEEDED_CAMPAIGN}`, {
        waitUntil: "load",
        timeout: 120_000,
      });
      entry.loaded.push("GET /org/:org/:campaign");
      expect_ok(plain.status() === 200, `GET campaign → ${plain.status()}`);
      const intents = [];
      page.on("request", (req) => {
        const path = new URL(req.url()).pathname;
        if (req.method() === "POST" && path === "/api/donation-intents") {
          intents.push(req.postData() ?? "");
        }
      });
      expect_ok(
        (await page.getByRole("button", { name: "+100 USD" }).count()) === 0,
        "+100 USD is on the page before Donate"
      );
      // Same cold-load reload as click_after_reload. A reload closes the
      // dialog, so each attempt opens Donate again before +100 USD.
      let amount_tries = 1;
      for (let attempt = 1; attempt <= 3; attempt++) {
        amount_tries = attempt;
        try {
          await page
            .getByRole("button", { name: "Donate", exact: true })
            .first()
            .click({ timeout: attempt < 3 ? 20_000 : T });
          await page
            .getByRole("button", { name: "+100 USD" })
            .click({ timeout: attempt < 3 ? 20_000 : T });
          break;
        } catch (err) {
          if (attempt === 3) throw err;
          await page.reload({ waitUntil: "load", timeout: 120_000 });
        }
      }
      await shot("2-amount");
      await page.getByRole("button", { name: /Continue with Card/ }).click();
      await page.getByText("Payment information").waitFor({ timeout: T });
      await page.locator('input[name="email"]').fill("donor@example.com");
      await page.locator('input[name="first_name"]').fill("Verify");
      await page.locator('input[name="last_name"]').fill("Donor");
      await shot("3-donor");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByText("Your donation summary").waitFor({ timeout: T });
      await page.waitForTimeout(8000);
      await shot("4-payment");
      const body = await page.locator("body").innerText();
      expect_ok(
        /Total donation\s*\$100\.00/.test(body),
        "summary doesn't show Total donation $100.00"
      );
      const carried = intents.some((raw) => {
        try {
          return JSON.parse(raw).campaign_id === SEEDED_CAMPAIGN_ID;
        } catch {
          return false;
        }
      });
      expect_ok(
        carried,
        `intent did not carry campaign_id ${SEEDED_CAMPAIGN_ID}`
      );
      const facts = [
        "amount=50 and frequency=monthly open the donate dialog",
        click_fact(
          "Donate → +100 USD → Continue with Card → donor info → Continue",
          amount_tries
        ),
        "payment step: Total donation $100.00",
        `POST /api/donation-intents carries campaign_id ${SEEDED_CAMPAIGN_ID}`,
      ];
      const { pay_err, stubbed, filler } = payment_blocked(body, ctx);
      if (pay_err && (filler || stubbed.length > 0)) {
        facts.push(`shows "${pay_err.trim()}"`);
        if (stubbed.length)
          facts.push(
            `server stripe calls refused by the local stub (filler STRIPE_SECRET_KEY): ${[...new Set(stubbed)].join(", ")}`
          );
        throw new Blocked(
          `payment step reached; card entry needs a real pk_test_/sk_test_ pair\n  ${facts.join("\n  ")}`
        );
      }
      expect_ok(!pay_err, `payment failed to start with real keys: ${pay_err}`);
      const card = page
        .frameLocator('iframe[title*="Secure payment input"]')
        .first();
      await card
        .locator('input[name="number"]')
        .fill("4242424242424242", { timeout: T });
      await shot("5-card");
      facts.push("stripe payment element accepted test card 4242…");
      return facts;
    },
  },
};

const args = process.argv.slice(2);
try {
  assert_map(FLOWS);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
if (args.includes("--check-map")) {
  console.log("ok   features/, README links, and drive.mjs agree");
  process.exit(0);
}
if (args.includes("--list")) {
  for (const [k, f] of Object.entries(FLOWS))
    console.log(`${k.padEnd(16)} ${f.desc}`);
  process.exit(0);
}
const names = args.length ? args : Object.keys(FLOWS);
for (const n of names)
  if (!FLOWS[n]) {
    console.error(`unknown flow "${n}"; --list shows them`);
    process.exit(64);
  }

const { chromium } = createRequire(path.join(APP, "package.json"))(
  "playwright"
);
fs.mkdirSync(OUT, { recursive: true });
const env_file = path.join(APP, ".env.verify");
const pk = fs.existsSync(env_file)
  ? ((fs.readFileSync(env_file, "utf8").match(/^VITE_STRIPE_PK=(.*)$/m) ??
      [])[1] ?? "")
  : "";
const browser = await chromium.launch();
const results = [];
for (const name of names) {
  const ctxb = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctxb.newPage();
  const lines = [];
  const net = [];
  const log = (s) => lines.push(`${new Date().toISOString()} ${s}`);
  page.on("console", (m) =>
    log(`console.${m.type()}: ${m.text().slice(0, 300)}`)
  );
  page.on("pageerror", (e) => log(`pageerror: ${e.message.slice(0, 300)}`));
  page.on("response", (r) => {
    if (r.status() >= 400) {
      const s = `${r.request().method()} ${r.status()} ${shown_url(r.url())}`;
      net.push(s);
      log(`http ${s}`);
    }
  });
  const shots = [];
  const aria = [];
  const shot = async (tag) => {
    const stem = `${name}${tag ? `-${tag}` : ""}`;
    const png = path.join(OUT, `${stem}.png`);
    const tree = path.join(OUT, `${stem}.aria.txt`);
    await page.screenshot({ path: png, fullPage: true });
    shots.push(png);
    const snapshot = await page.locator("body").ariaSnapshot();
    fs.writeFileSync(
      tree,
      snapshot.endsWith("\n") ? snapshot : `${snapshot}\n`
    );
    aria.push(tree);
  };
  const t0 = Date.now();
  const entry = { clicked: [], loaded: [] };
  let status,
    facts = [],
    error;
  try {
    facts = await FLOWS[name].run({
      page,
      log,
      shot,
      entry,
      ctx: { net, pk },
    });
    status = "pass";
  } catch (e) {
    status = e instanceof Blocked ? "blocked" : "fail";
    error = e.message.split("\n")[0];
    if (e instanceof Blocked)
      facts = e.message
        .split("\n")
        .slice(1)
        .map((s) => s.trim());
    try {
      await shot("final");
    } catch {}
  }
  fs.writeFileSync(path.join(OUT, `${name}.log`), `${lines.join("\n")}\n`);
  const r = {
    flow: name,
    entry,
    status,
    ms: Date.now() - t0,
    facts,
    error,
    screenshots: shots,
    aria,
    log: path.join(OUT, `${name}.log`),
  };
  results.push(r);
  console.log(
    `${status.toUpperCase().padEnd(7)} ${name}${error ? ` — ${error}` : ""}`
  );
  for (const f of facts) console.log(`        · ${f}`);
  await ctxb.close();
}
await browser.close();
const summary = {
  base: BASE,
  at: new Date().toISOString(),
  git: process.env.VERIFY_GIT ?? null,
  results,
};
fs.writeFileSync(
  path.join(OUT, "results.json"),
  JSON.stringify(summary, null, 2)
);
console.log(`proof: ${OUT}/results.json`);
process.exit(
  results.some((r) => r.status === "fail")
    ? 1
    : results.some((r) => r.status === "blocked")
      ? 2
      : 0
);
