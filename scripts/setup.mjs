#!/usr/bin/env node
//
// One command that builds a new daycare from an empty Supabase project.
//
//   npm run setup
//
// It runs the eighteen SQL files in the order docs/NEW-DATABASE.md describes,
// creates the staff sign-ins, makes the storage bucket, writes the branding
// and leaves you with a working .env.local. The order is held here in code
// rather than in a person following a table, which is where every failure in
// this project has come from.
//
// What it deliberately does NOT do, because no script can:
//
//   - verify a sending domain with Resend (that is DNS)
//   - point a domain at the deployment (that is DNS, at whatever registrar)
//   - register the callback URL in the Square dashboard
//   - enrol multi-factor authentication (that needs a human and a phone)
//
// It prints those at the end rather than pretending they are done.
//
// SECRETS. Everything you type is used and then forgotten. Tokens and
// passwords are read with the echo off, are never printed back, never written
// to a log, and only the two Supabase keys reach disk - in .env.local, which
// is git-ignored and written owner-read-only. Nothing is sent anywhere except
// supabase.com.

import { readFile, writeFile, chmod, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------
// The run order. This is the single source of truth; docs/NEW-DATABASE.md
// documents it for people, and this list is what actually happens.
//
// The split is not cosmetic. security-roles-migration.sql refuses to finish
// unless the staff accounts already exist, so the accounts are created in
// between the two halves.
// ---------------------------------------------------------------------

const SCHEMA_FILES = [
  "00-base-schema.sql",
  "enrollment-migration.sql",
  "boarding-requests-migration.sql",
  "walk-log-per-dog-migration.sql",
  "walk-package-boarding-migration.sql",
  "meet-greet-result-migration.sql",
  "signin-notes-migration.sql",
  "signin-meals-migration.sql",
  "site-photos-migration.sql",
  "site-storage-migration.sql",
  "two-stage-enrollment-migration.sql",
];

const SECURITY_FILES = [
  "security-roles-migration.sql",
  "security-audit-migration.sql",
  "security-exports-migration.sql",
  "customer-accounts-migration.sql",
  "customer-details-handover-migration.sql",
  "customer-second-dog-migration.sql",
  "rls-lockdown.sql",
];

const BUCKET = "site-photos";

// ---------------------------------------------------------------------
// Terminal helpers
// ---------------------------------------------------------------------

const tty = process.stdout.isTTY;
const c = {
  bold: (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s) => (tty ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s) => (tty ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s) => (tty ? `\x1b[33m${s}\x1b[0m` : s),
};

const say = (s = "") => console.log(s);
const step = (s) => console.log(`\n${c.bold("==")} ${c.bold(s)}`);
const ok = (s) => console.log(`   ${c.green("ok")}  ${s}`);
const info = (s) => console.log(`   ${c.dim("--")}  ${c.dim(s)}`);
const warn = (s) => console.log(`   ${c.yellow("!!")}  ${s}`);

function die(message, detail) {
  console.error(`\n${c.red("Stopped.")} ${message}`);
  if (detail) console.error(c.dim(String(detail)));
  process.exit(1);
}

function ask(question, fallback = "") {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const shown = fallback ? `${question} ${c.dim(`[${fallback}]`)} ` : `${question} `;
  return new Promise((resolve) =>
    rl.question(shown, (answer) => {
      rl.close();
      resolve(answer.trim() || fallback);
    })
  );
}

// Same as ask, with the echo off. Used for every token and password.
function askSecret(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    let muted = false;
    rl._writeToOutput = (chunk) => {
      if (!muted) rl.output.write(chunk);
    };
    rl.question(`${question} `, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
    muted = true;
  });
}

async function confirm(question, fallback = "y") {
  const answer = await ask(`${question} (y/n)`, fallback);
  return /^y/i.test(answer);
}

// ---------------------------------------------------------------------
// Supabase Management API
// ---------------------------------------------------------------------

const MGMT = "https://api.supabase.com";

async function mgmt(token, method, endpoint, body) {
  let response;
  try {
    response = await fetch(MGMT + endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`Could not reach supabase.com. ${e.message}`);
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const detail =
      data && typeof data === "object" ? data.message || JSON.stringify(data) : String(data);
    const err = new Error(`${method} ${endpoint} failed (${response.status}): ${detail}`);
    err.status = response.status;
    throw err;
  }
  return data;
}

/** Runs one SQL statement batch against the project. */
async function runSql(token, ref, sql) {
  return mgmt(token, "POST", `/v1/projects/${ref}/database/query`, { query: sql });
}

/** Runs a whole .sql file, naming the file if it fails. */
async function runFile(token, ref, file) {
  const full = path.join(ROOT, file);
  if (!existsSync(full)) die(`${file} is missing from the repository.`);
  const sql = await readFile(full, "utf8");
  try {
    await runSql(token, ref, sql);
    ok(file);
  } catch (e) {
    say();
    die(
      `${file} failed. Nothing after it has run.\n\n${e.message}\n\n` +
        `Fix the cause and run this command again - every file here is safe to run twice.`
    );
  }
}

// ---------------------------------------------------------------------
// Project auth key lookup. The shape of this endpoint has changed over
// time, so be generous about what counts as the anon and service keys.
// ---------------------------------------------------------------------

function pickKey(rows, wanted) {
  if (!Array.isArray(rows)) return null;
  const match = rows.find((r) => {
    const name = String(r.name ?? r.type ?? "").toLowerCase();
    return wanted === "anon"
      ? name === "anon" || name === "publishable"
      : name === "service_role" || name === "secret";
  });
  return match ? match.api_key ?? match.apiKey ?? match.key ?? null : null;
}

// ---------------------------------------------------------------------
// Project-level REST calls, with the service key
// ---------------------------------------------------------------------

async function serviceCall(url, key, method, endpoint, body) {
  const response = await fetch(url + endpoint, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, ok: response.ok, data };
}

// ---------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------

async function main() {
  const printOnly = process.argv.includes("--print-sql");

  if (printOnly) {
    // No credentials, no network. Emits every file in the right order so it
    // can be pasted into the SQL editor in one go. The staff accounts still
    // have to exist before the security half, so it stops there.
    const parts = [];
    for (const f of SCHEMA_FILES) {
      parts.push(`-- ===== ${f} =====\n${await readFile(path.join(ROOT, f), "utf8")}`);
    }
    parts.push(
      "\n-- ===== STOP HERE =====\n" +
        "-- Create the staff sign-ins under Authentication before going on,\n" +
        "-- then run the files below. See docs/NEW-DATABASE.md.\n"
    );
    for (const f of SECURITY_FILES) {
      parts.push(`-- ===== ${f} =====\n${await readFile(path.join(ROOT, f), "utf8")}`);
    }
    process.stdout.write(parts.join("\n\n"));
    return;
  }

  say();
  say(c.bold("  Setting up a new daycare"));
  say(c.dim("  Ctrl-C at any point. Nothing is written until it says so."));
  say();
  say("  You will need:");
  say("    1. A Supabase account, and a project already created in it");
  say("    2. A Supabase personal access token, from");
  say(c.dim("       https://supabase.com/dashboard/account/tokens"));
  say();
  say(c.dim("  Do not paste tokens into a chat window. They are typed here, used"));
  say(c.dim("  against supabase.com, and never stored or printed."));

  // -------------------------------------------------------------------
  step("1. Supabase project");

  const token = await askSecret("Personal access token:");
  if (!token) die("No token, so nothing can be done.");

  let projects;
  try {
    projects = await mgmt(token, "GET", "/v1/projects");
  } catch (e) {
    die("That token was refused by supabase.com.", e.message);
  }

  if (!Array.isArray(projects) || projects.length === 0) {
    die("That token can see no projects. Create one in the Supabase dashboard first.");
  }

  say();
  projects.forEach((p, i) => say(`   ${i + 1}. ${p.name} ${c.dim(`(${p.region}, ${p.status})`)}`));
  say();
  let project = null;
  while (!project) {
    const choice = await ask(`Which project? 1-${projects.length}:`, "1");
    project = projects[Number(choice) - 1] ?? null;
    if (!project) warn(`Pick a number between 1 and ${projects.length}.`);
  }

  const ref = project.ref ?? project.id;
  const url = `https://${ref}.supabase.co`;
  ok(`${project.name}`);

  // A project that already has customer records is not a new deployment.
  // Refuse rather than run eighteen migrations across somebody live data.
  try {
    const rows = await runSql(
      token,
      ref,
      "select coalesce((select count(*) from public.dogs), 0) as dogs"
    );
    const dogs = Array.isArray(rows) && rows[0] ? Number(rows[0].dogs ?? 0) : 0;
    if (dogs > 0) {
      warn(`This project already holds ${dogs} dogs. That is not an empty project.`);
      if (!(await confirm("Really continue?", "n"))) die("Nothing was changed.");
    }
  } catch {
    // No dogs table yet is the normal case for a new project.
    info("Empty project, as expected.");
  }

  // -------------------------------------------------------------------
  step("2. Keys");

  let anonKey = null;
  let serviceKey = null;
  try {
    const keys = await mgmt(token, "GET", `/v1/projects/${ref}/api-keys?reveal=true`);
    anonKey = pickKey(keys, "anon");
    serviceKey = pickKey(keys, "service");
  } catch (e) {
    info(`Could not read the keys automatically (${e.status ?? "error"}).`);
  }

  if (!anonKey) {
    say();
    say(c.dim("   Project Settings -> API -> Project API keys"));
    anonKey = await askSecret("anon / publishable key:");
  }
  if (!serviceKey) {
    serviceKey = await askSecret("service_role / secret key:");
  }
  if (!anonKey || !serviceKey) die("Both keys are needed.");
  ok("both keys in hand");

  // -------------------------------------------------------------------
  step("3. Who works here");

  say(c.dim("   These become the sign-ins. At least one owner is required."));
  say(c.dim("   Addresses ending @staff.local show in the app as just the name."));
  say();

  const staff = [];
  const defaults = [
    ["owner_admin", "owner@staff.local"],
    ["employee", "frontdesk@staff.local"],
    ["kiosk", "kiosk@staff.local"],
  ];

  // Ask again rather than giving up. Throwing away a token, a project choice
  // and two good passwords because the third was short is not a good trade.
  const MIN_PASSWORD = 8;

  for (const [role, suggestion] of defaults) {
    const email = await ask(`${role} email (blank to skip):`, suggestion);
    if (!email) continue;

    let password = "";
    for (;;) {
      password = await askSecret(`   password for ${email}:`);
      if (password.length >= MIN_PASSWORD) break;
      warn(
        password
          ? `Too short - ${password.length} character${password.length === 1 ? "" : "s"}. ` +
              `Use at least ${MIN_PASSWORD}: this account can read every customer record.`
          : `A password is needed. At least ${MIN_PASSWORD} characters.`
      );
    }

    staff.push({ email, password, role });
  }

  if (!staff.some((s) => s.role === "owner_admin")) {
    die("No owner account, and the lockdown would leave nobody able to run the business.");
  }

  // -------------------------------------------------------------------
  step("4. The business");

  const business = {
    name: await ask("Business name:", "The Daycare"),
    phone: await ask("Phone:", ""),
    email: await ask("Public email:", ""),
    street: await ask("Street:", ""),
    city: await ask("City:", ""),
    state: await ask("State:", ""),
    zip: await ask("ZIP:", ""),
    hoursWeekday: await ask("Weekday hours:", "7am - 7pm"),
    hoursWeekend: await ask("Weekend hours:", "9am - 5pm"),
  };

  // -------------------------------------------------------------------
  say();
  say(c.bold("  Ready. This will:"));
  say(`    - run ${SCHEMA_FILES.length + SECURITY_FILES.length} SQL files against ${project.name}`);
  say(`    - create ${staff.length} sign-in${staff.length === 1 ? "" : "s"}`);
  say(`    - create the ${BUCKET} storage bucket`);
  say(`    - write .env.local`);
  say();
  if (!(await confirm("Go?", "y"))) die("Nothing was changed.");

  // -------------------------------------------------------------------
  step("5. Tables and columns");

  for (const file of SCHEMA_FILES) await runFile(token, ref, file);

  // -------------------------------------------------------------------
  step("6. Staff sign-ins");

  for (const person of staff) {
    const res = await serviceCall(url, serviceKey, "POST", "/auth/v1/admin/users", {
      email: person.email,
      password: person.password,
      email_confirm: true,
    });
    if (res.ok) {
      ok(`${person.email} ${c.dim(`(${person.role})`)}`);
    } else if (res.status === 422 || res.status === 409) {
      info(`${person.email} already existed, left alone`);
    } else {
      const detail = res.data && res.data.msg ? res.data.msg : JSON.stringify(res.data);
      die(`Could not create ${person.email}: ${detail}`);
    }
  }

  // The roles migration reads this table in preference to the list written
  // inside it, which is what lets this run without editing any SQL by hand.
  const seedValues = staff
    .map((s) => `(${quote(s.email)}, ${quote(s.role)})`)
    .join(",\n    ");

  await runSql(
    token,
    ref,
    `create table if not exists public.staff_seed (email text primary key, role text not null);
     delete from public.staff_seed;
     insert into public.staff_seed (email, role) values
    ${seedValues};`
  );
  ok("roles queued for seeding");

  // -------------------------------------------------------------------
  step("7. Permissions, audit log and the lockdown");

  for (const file of SECURITY_FILES) await runFile(token, ref, file);

  // The seed table has done its job. Leaving it would be a second place
  // that says who is staff, and one of them would eventually be wrong.
  await runSql(token, ref, "drop table if exists public.staff_seed;");
  ok("seed table removed");

  // -------------------------------------------------------------------
  step("8. Storage bucket");

  const bucket = await serviceCall(url, serviceKey, "POST", "/storage/v1/bucket", {
    id: BUCKET,
    name: BUCKET,
    public: true,
    file_size_limit: 5 * 1024 * 1024,
    allowed_mime_types: ["image/jpeg", "image/png", "image/webp", "image/avif"],
  });
  if (bucket.ok) ok(`${BUCKET} created`);
  else if (bucket.status === 409) info(`${BUCKET} already existed`);
  else warn(`Could not create the bucket: ${JSON.stringify(bucket.data)}`);

  // -------------------------------------------------------------------
  step("9. Branding");

  // Only the fields just collected. Everything else the app fills from its
  // own defaults, so this cannot flatten settings that were never asked for.
  //
  // The merge is nested on purpose. A plain data || excluded.data replaces
  // the whole business object, which on a second run would silently drop the
  // logo, the tagline and the accent colour - none of which this script asks
  // for, and all of which someone may have set in the app by then.
  await runSql(
    token,
    ref,
    `insert into public.settings (id, data, updated_at)
     values (1, jsonb_build_object('business', ${quote(JSON.stringify(business))}::jsonb), now())
     on conflict (id) do update
       set data = public.settings.data
                  || jsonb_build_object(
                       'business',
                       coalesce(public.settings.data -> 'business', '{}'::jsonb)
                         || (excluded.data -> 'business')
                     ),
           updated_at = now();`
  );
  ok(`${business.name} saved`);

  // -------------------------------------------------------------------
  step("10. .env.local");

  const envPath = path.join(ROOT, ".env.local");
  if (existsSync(envPath)) {
    const backup = `${envPath}.backup-${Date.now()}`;
    await copyFile(envPath, backup);
    warn(`An .env.local already existed. Copied to ${path.basename(backup)} before overwriting.`);
  }

  const env = [
    `NEXT_PUBLIC_SUPABASE_URL=${url}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`,
    `SUPABASE_SECRET_KEY=${serviceKey}`,
    `NEXT_PUBLIC_STAFF_UNLOCK_MINUTES=30`,
    ``,
    `# Email. Without these the app sends nothing, silently.`,
    `RESEND_API_KEY=`,
    `EMAIL_FROM=`,
    ``,
  ].join("\n");

  await writeFile(envPath, env, "utf8");
  await chmod(envPath, 0o600);
  ok(".env.local written");

  // -------------------------------------------------------------------
  step("11. Check it holds");

  const checks = await runSql(
    token,
    ref,
    `select
       (select count(*) from public.staff_roles) as roles,
       (select count(*) from public.staff_roles where role = 'owner_admin') as owners,
       (select count(*) from pg_tables
         where schemaname = 'public' and rowsecurity = false) as tables_without_rls,
       (select count(*) from pg_policies where schemaname = 'public') as policies;`
  );
  const r = Array.isArray(checks) && checks[0] ? checks[0] : {};
  ok(`${r.roles ?? 0} staff roles, ${r.owners ?? 0} of them owner`);
  ok(`${r.policies ?? 0} security policies in force`);
  if (Number(r.tables_without_rls ?? 0) > 0) {
    warn(`${r.tables_without_rls} table(s) have row-level security off. Expected 0.`);
  }

  // -------------------------------------------------------------------
  say();
  say(c.green(c.bold("  Done. The database is built and the app can run.")));
  say();
  say(`    ${c.bold("npm run dev")}   and sign in as ${staff[0].email}`);
  say();
  say(c.bold("  Still to do by hand, because a script cannot:"));
  say("    1. Deploy: push to a repo, import it at vercel.com, and add the");
  say("       same variables from .env.local under Environment Variables");
  say("    2. Email: verify a domain at resend.com, then fill RESEND_API_KEY");
  say("       and EMAIL_FROM here and in Vercel");
  say("    3. Square: register the deployed URL as a web callback in the");
  say("       Square dashboard, or payments fail at the counter");
  say("    4. Enrol two-factor on the owner account, in the app");
  say("    5. Check the backup settings in Supabase, and restore one once");
  say();
  say(c.dim("  Isolation test: run customer-isolation-fixtures.sql then"));
  say(c.dim("  customer-isolation-test.sql. See docs/NEW-DATABASE.md."));
  say();
}

/** A single-quoted SQL literal, doubling any quote inside it. */
function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

main().catch((e) => die("Something unexpected went wrong.", e.stack || e.message));
