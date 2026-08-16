// Does the policy matrix actually do what rls-lockdown.sql says it does?
//
// Runs the four real migration files, unmodified, against a Postgres running
// in this process, then tries roughly a hundred things as each role and
// checks that the ones that should be refused are refused. Nothing here
// touches the live database, which is the point: the migration can be proved
// before it goes anywhere near the business.
//
// What it covers, in the order the sections appear:
//
//   the public website holding only the anon key
//   an employee, which is the account requirement 3 is about
//   the lobby kiosk
//   an account nobody has given a role to
//   a manager, before and after enrolling in MFA and before and after
//     presenting a code, which is where most of the lockout risk lives
//   the owner
//   the audit log: completeness, attribution, redaction, append-only
//   that nothing was left wide open
//   that re-running every migration changes nothing
//   that the rollback restores access and the lockdown can be re-applied
//
// Run it with:
//
//   npm run test:policies      (or npm test, which runs this and the rest)
//
// pglite is a devDependency rather than an install-when-you-remember. It used
// to be documented as `npm install --no-save`, which meant the next npm
// install of anything at all deleted it and this suite stopped running — the
// same way it had already stopped running for a different reason. A gate that
// disappears quietly is worse than no gate, because it still reads as one.
//
// It exits non-zero if any check fails, so it can go in front of a deploy.
// Add a case here whenever the matrix changes: the cheapest place to find
// out that employees can no longer sign a dog in is this file.

import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

const db = new PGlite();
let failures = 0;
let checks = 0;

function ok(pass, label, extra = "") {
  checks++;
  if (!pass) failures++;
  console.log(`${pass ? "  ok  " : "  FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
}

// Migration files hold several statements plus dollar-quoted blocks, so they
// go in whole via exec() the way the SQL editor would take them.
async function runFile(path, label) {
  const sql = fs.readFileSync(path, "utf8");
  try {
    await db.exec(sql);
    console.log(`  ok   ${label}`);
    return true;
  } catch (e) {
    failures++;
    console.log(`  FAIL ${label}\n       ${String(e.message).split("\n").join("\n       ")}`);
    return false;
  }
}

/** Become a signed-in user with the given claims, or reset to superuser. */
async function as(userId, aal = "aal1", role = "authenticated") {
  await db.exec("reset role");
  if (userId === null) {
    await db.query("select set_config('request.jwt.claims', '', false)");
    if (role) await db.exec(`set role ${role}`);
    return;
  }
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, role, aal }),
  ]);
  await db.exec(`set role ${role}`);
}

async function superuser() {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', '', false)");
}

/**
 * Attempts a statement and says what the database did.
 * RLS refuses a SELECT by returning nothing and refuses an UPDATE or DELETE
 * by matching nothing, so "denied" has to mean both an error and zero rows.
 */
async function attempt(sql, params = []) {
  try {
    const r = await db.query(sql, params);
    const rows = r.rows?.length ?? 0;
    const affected = r.affectedRows ?? 0;
    return { allowed: rows > 0 || affected > 0, rows, affected, error: null };
  } catch (e) {
    return { allowed: false, rows: 0, affected: 0, error: e.message };
  }
}

async function expectAllowed(label, sql, params) {
  const r = await attempt(sql, params);
  ok(r.allowed, label, r.error ? `refused: ${r.error.slice(0, 90)}` : r.allowed ? "" : "no rows");
  return r;
}

async function expectDenied(label, sql, params) {
  const r = await attempt(sql, params);
  ok(!r.allowed, label, r.allowed ? `ALLOWED (${r.rows} rows, ${r.affected} affected)` : "");
  return r;
}

// =====================================================================
console.log("\n=== 1. Supabase stand-in and application tables ===");
await runFile(`${HERE}/supabase-stand-in.sql`, "supabase-stand-in.sql");

// Steps 0 to 10 of docs/NEW-DATABASE.md: the real schema and the feature
// migrations, not a copy of them. See the note at the foot of the stand-in.
//
// Running the whole runbook rather than only the security block is the point.
// The security migrations reference tables these create — boarding_requests,
// enrollments, the two-stage columns — so a lockdown proved against a partial
// schema proves very little. This way the deployment documented for a new
// client is exercised from nothing on every run.
//
// site-storage-migration.sql is the one omission: it writes policies on
// storage.objects, which is Supabase infrastructure rather than application
// schema, and standing that up here would be testing Supabase rather than
// this app.
const schemaOrder = [
  ["00-base-schema.sql", "0. base schema"],
  ["enrollment-migration.sql", "1. enrollments"],
  ["boarding-requests-migration.sql", "2. boarding requests"],
  ["walk-log-per-dog-migration.sql", "3. walk logs per dog"],
  ["walk-package-boarding-migration.sql", "4. walk packages"],
  ["meet-greet-result-migration.sql", "5. meet & greet result"],
  ["signin-notes-migration.sql", "6. sign-in notes"],
  ["signin-meals-migration.sql", "7. meals"],
  ["site-photos-migration.sql", "8. site photos"],
  ["two-stage-enrollment-migration.sql", "10. two-stage enrollment"],
];
for (const [file, label] of schemaOrder) {
  if (!(await runFile(`${REPO}/${file}`, label))) {
    console.log("\nStopping: a migration failed, so the rest would be meaningless.");
    process.exit(1);
  }
}

// Only now that the tables exist: "all tables in schema public" grants on
// what is there when it runs, not on what arrives later.
await runFile(`${HERE}/supabase-grants.sql`, "supabase default grants");

const users = {};
for (const [name, email] of [
  ["owner", "cesar@staff.local"],
  ["kioskUser", "kiosk@staff.local"],
  ["manager", "manager@staff.local"],
  ["employee", "frontdesk@staff.local"],
  ["stranger", "nobody@staff.local"],
]) {
  const r = await db.query("insert into auth.users (email) values ($1) returning id", [email]);
  users[name] = r.rows[0].id;
}
console.log(`  ok   five accounts created`);

// =====================================================================
console.log("\n=== 2. The migrations, in the documented order ===");
// Steps 11 to 17 of docs/NEW-DATABASE.md. The customer-account migrations are
// not optional scenery here: rls-lockdown.sql calls customer_owner_id() in the
// client policies, so without step 14 it refuses to run at all — which is
// exactly how this file started failing, silently, while still being the thing
// that was supposed to be run in front of a deploy. Keep this list in step with
// the runbook.
const order = [
  ["security-roles-migration.sql", "1. roles"],
  ["security-audit-migration.sql", "2. audit log"],
  ["security-exports-migration.sql", "3. export gate"],
  ["customer-accounts-migration.sql", "4. customer accounts"],
  ["customer-details-handover-migration.sql", "5. details handover"],
  ["customer-second-dog-migration.sql", "6. second dog"],
  // Recreates the my_dogs view, so it must run before the lockdown has its
  // say about what the portal can read.
  ["dog-retire-migration.sql", "6b. retiring a dog"],
  ["rls-lockdown.sql", "7. per-role RLS"],
];
for (const [file, label] of order) {
  const okRun = await runFile(`${REPO}/${file}`, label);
  if (!okRun) {
    console.log("\nStopping: a migration failed, so the rest would be meaningless.");
    console.log(`\n${checks} checks, ${failures} failed`);
    process.exit(1);
  }
}

// The accounts the seed list does not cover get roles the way an owner would.
//
// Upserted rather than inserted because the seed list is not fixed: it is
// edited per client, and scripts/setup.mjs writes it from a staff_seed table.
// This suite asserts what each ROLE may do, so it must not also depend on
// which emails some install happens to seed — that coupling is what turned a
// changed seed list into a crash here rather than a failed check.
await superuser();
for (const [user, role] of [
  [users.manager, "manager"],
  [users.employee, "employee"],
]) {
  await db.query(
    `insert into public.staff_roles (user_id, role) values ($1,$2)
       on conflict (user_id) do update set role = excluded.role`,
    [user, role]
  );
}

console.log("\n=== 3. Roles as the database sees them ===");
const roleRows = await db.query(
  `select u.email, coalesce(r.role,'(none)') as role
   from auth.users u left join public.staff_roles r on r.user_id = u.id order by u.email`
);
for (const row of roleRows.rows) console.log(`       ${row.email.padEnd(26)} ${row.role}`);
ok(
  roleRows.rows.find((r) => r.email === "cesar@staff.local")?.role === "owner_admin",
  "seed gave the existing account owner_admin"
);
ok(
  roleRows.rows.find((r) => r.email === "kiosk@staff.local")?.role === "kiosk",
  "seed gave the lobby iPad the kiosk role"
);
ok(
  roleRows.rows.find((r) => r.email === "nobody@staff.local")?.role === "(none)",
  "an account nobody assigned has no role"
);

// Seed rows the tests read and write.
await superuser();
const dogId = (
  await db.query(
    "insert into public.dogs (dog_name, last_name, phone, notes) values ('Bella','Fixture','6305551234','likes shade') returning id"
  )
).rows[0].id;
await db.query("insert into public.owners (phone, owner_name, email, address) values ('6305551234','Alice A','a@example.com','1 Main St')");
await db.query("insert into public.payments (phone, amount) values ('6305551234', 42.50)");
await db.query("insert into public.packages (phone, client_name, total_days, days_used, kind) values ('6305551234','Alice A',10,2,'daycare')");
// A stay for the meal log to hang off. meal_logs keys on boarding_id, not
// dog_id: a meal is fed during a boarding, and the old hand-written stand-in
// had this wrong, so the check below was passing against a table shape the
// business does not have.
const boardingId = (
  await db.query(
    `insert into public.boardings (dog_name, last_name, phone, start_date, end_date)
       values ('Bella','Fixture','6305551234', current_date, current_date + 1) returning id`
  )
).rows[0].id;
await db.query(
  "insert into public.meal_logs (boarding_id, date, meal_type) values ($1, current_date, 'lunch')",
  [boardingId]
);
await db.query("insert into public.vaccinations (dog_id, vaccine) values ($1,'rabies')", [dogId]);
await db.query("insert into public.enrollments (owner_name, phone) values ('Bob B','6305559999')");
// The singleton settings row. Created by scripts/setup.mjs on a real install;
// the schema ships the table empty, and "the website can read prices" is not a
// meaningful check against no rows.
await db.query("insert into public.settings (id, data) values (1, '{}'::jsonb) on conflict (id) do nothing");

// =====================================================================
console.log("\n=== 4. The public website, holding only the anon key ===");
await as(null, null, "anon");
ok((await attempt("select * from public.settings")).rows > 0, "reads settings (prices and branding)");
ok((await attempt("select * from public.dogs")).rows === 0, "gets nothing from dogs");
ok((await attempt("select * from public.owners")).rows === 0, "gets nothing from owners");
ok((await attempt("select * from public.payments")).rows === 0, "gets nothing from payments");
ok((await attempt("select * from public.audit_log")).rows === 0, "gets nothing from the audit log");
await expectAllowed("submits an enrollment form", "insert into public.enrollments (owner_name, phone) values ('Web Visitor','6305558801')");
await expectDenied(
  "and cannot ask for the row back, because RETURNING is a read",
  "insert into public.enrollments (owner_name, phone) values ('Web Visitor 2','6305558802') returning id"
);
await expectDenied("cannot read back what others submitted", "select * from public.enrollments");
await expectDenied("cannot call the export function", "select * from public.export_dataset('dogs')");

// =====================================================================
console.log("\n=== 5. An employee — the account that matters most here ===");
await as(users.employee);
await expectAllowed("looks up a dog", "select * from public.dogs");
await expectAllowed("reads the owner record, for an emergency contact", "select * from public.owners");
await expectAllowed("updates a dog note", "update public.dogs set notes = 'likes shade, hates rain' where id = $1", [dogId]);
await expectAllowed("signs a dog in", "insert into public.signins (dog_name, phone, action) values ('Bella','6305551234','drop_off') returning id");
await expectAllowed("sees a balance", "select * from public.payments");
await expectAllowed("takes a payment at pick-up", "insert into public.payments (phone, amount) values ('6305551234', 10) returning id");
await expectAllowed("corrects today: removes a meal log", "delete from public.meal_logs where boarding_id = $1", [boardingId]);
await expectDenied("CANNOT export dogs", "select * from public.export_dataset('dogs')");
await expectDenied("CANNOT export owners", "select * from public.export_dataset('owners')");
await expectDenied("CANNOT export payments", "select * from public.export_dataset('payments')");
await expectDenied("CANNOT record a browser-composed export", "select public.record_export('dogs-and-owners', 529)");
await expectDenied("cannot delete a dog", "delete from public.dogs where id = $1", [dogId]);
await expectDenied("cannot delete an owner", "delete from public.owners where phone = '6305551234'");
await expectDenied("cannot alter a payment", "update public.payments set amount = 0 where phone = '6305551234'");
await expectDenied("cannot delete a payment", "delete from public.payments where phone = '6305551234'");
// Selling a package is an employee action, deliberately. The matrix cell was
// widened with a note in rls-lockdown.sql: an employee can already take a
// payment, which is the same act, and a front desk that cannot sell the thing
// on the price list either stops the sale or shares the manager password. The
// audit log records who sold it; DELETING one still needs a manager, which is
// the check on the next line.
await expectAllowed("sells a package — the till is not blocked", "insert into public.packages (phone, client_name, total_days, kind) values ('6305551234','Alice',10,'daycare') returning id");
await expectDenied("but cannot delete one", "delete from public.packages where client_name = 'Alice'");
await expectDenied("cannot change prices or branding", "update public.settings set data = '{}'::jsonb where id = 1");
await expectDenied("cannot read the audit log", "select * from public.audit_log");
await expectDenied("cannot promote itself", "insert into public.staff_roles (user_id, role) values ($1,'owner_admin')", [users.stranger]);
await expectDenied(
  "cannot promote itself by updating its own row",
  "update public.staff_roles set role = 'owner_admin' where user_id = $1",
  [users.employee]
);
await expectAllowed(
  "CAN harden its own account",
  "update public.staff_roles set require_mfa = true where user_id = $1",
  [users.employee]
);
await expectDenied(
  "cannot switch its own MFA requirement back off",
  "update public.staff_roles set require_mfa = false where user_id = $1",
  [users.employee]
);
// Put it back so later checks are unaffected.
await superuser();
await db.query("update public.staff_roles set require_mfa = false where user_id = $1", [users.employee]);

// =====================================================================
console.log("\n=== 6. The lobby iPad ===");
await as(users.kioskUser);
await expectAllowed("finds a dog by phone", "select * from public.dogs where phone = '6305551234'");
await expectDenied("CANNOT read the owners table at all", "select * from public.owners");
await expectAllowed("signs a dog in", "insert into public.signins (dog_name, phone, action) values ('Bella','6305551234','drop_off') returning id");
await expectAllowed("spends a package day", "update public.packages set days_used = days_used + 1 where phone = '6305551234'");
await expectAllowed("records a package use", "insert into public.package_uses (dog_id) values ($1) returning id", [dogId]);
await expectAllowed("takes a payment", "insert into public.payments (phone, amount) values ('6305551234', 25) returning id");
await expectAllowed("takes a signup form from a new client", "insert into public.enrollments (owner_name, phone) values ('Kiosk Visitor','6305558803')");
await expectDenied("cannot add a dog", "insert into public.dogs (dog_name, last_name, phone) values ('New','Fixture','6305550000') returning id");
await expectDenied("cannot sell a package", "insert into public.packages (phone, client_name, total_days, kind) values ('x','y',5,'daycare') returning id");
await expectDenied("cannot export", "select * from public.export_dataset('dogs')");
await expectDenied("cannot read the audit log", "select * from public.audit_log");
await expectDenied("cannot delete anything", "delete from public.dogs where id = $1", [dogId]);

// =====================================================================
console.log("\n=== 7. An account with no role ===");
await as(users.stranger);
await expectDenied("reads nothing from dogs", "select * from public.dogs");
await expectDenied("reads nothing from owners", "select * from public.owners");
await expectDenied("writes nothing", "insert into public.signins (dog_name, action) values ('x','drop_off') returning id");
await expectAllowed("still sees its own (absent) role row without error", "select 1 as reachable");

// =====================================================================
console.log("\n=== 8. A manager, and what MFA changes ===");
await as(users.manager, "aal1");
await expectAllowed("before enrolling, manager work is allowed", "select * from public.export_dataset('dogs')");
await superuser();
await db.query("insert into public.dogs (dog_name, last_name, phone) values ('Spare1','Fixture','6305550001')");
await as(users.manager, "aal1");
await expectAllowed("deletes a dog record", "delete from public.dogs where dog_name = 'Spare1'");

// Enrol a factor, the way Supabase Auth would, and mark the account as the
// app does after a verified enrolment.
await superuser();
await db.query("insert into auth.mfa_factors (user_id, status) values ($1,'verified')", [users.manager]);
await db.query("update public.staff_roles set require_mfa = true where user_id = $1", [users.manager]);

await as(users.manager, "aal1");
await expectDenied("once enrolled, aal1 CANNOT export", "select * from public.export_dataset('dogs')");
await expectDenied("once enrolled, aal1 cannot delete a dog", "delete from public.dogs where id = $1", [dogId]);
await expectAllowed("but can still do employee work, so a shift is not stuck", "select * from public.dogs");
await expectAllowed("and can still read its own role, so the app can prompt for the code", "select * from public.staff_roles where user_id = $1", [users.manager]);

await as(users.manager, "aal2");
await expectAllowed("with the code accepted, exports work", "select * from public.export_dataset('dogs')");
await superuser();
await db.query("insert into public.dogs (dog_name, last_name, phone) values ('Spare2','Fixture','6305550002')");
await as(users.manager, "aal2");
await expectAllowed("with the code accepted, deletion works", "delete from public.dogs where dog_name = 'Spare2'");
await expectAllowed("reads the audit log", "select * from public.audit_log");
await expectDenied("still cannot change prices or branding", "update public.settings set data = '{}'::jsonb where id = 1");
await expectDenied("still cannot delete a payment", "delete from public.payments where phone = '6305551234'");
await expectDenied("still cannot grant a role", "insert into public.staff_roles (user_id, role) values ($1,'manager')", [users.stranger]);

// =====================================================================
// The demo case, stated as its own section because it is the one that must
// never regress: an owner who has NOT set up an authenticator, signing in
// with a password only, has to be able to run the whole business. If this
// section ever fails, the migration locks the owner out of their own app.
console.log("\n=== 9. The owner, with NO authenticator set up (aal1) ===");
await superuser();
const ownerFactors = (
  await db.query("select count(*)::int as n from auth.mfa_factors where user_id = $1", [users.owner])
).rows[0].n;
ok(ownerFactors === 0, "precondition: the owner has enrolled nothing");
const ownerRequire = (
  await db.query("select require_mfa from public.staff_roles where user_id = $1", [users.owner])
).rows[0].require_mfa;
ok(ownerRequire === false, "precondition: nobody has required MFA on it");

await as(users.owner, "aal1");
await expectAllowed("reads dogs", "select * from public.dogs");
await expectAllowed("reads the audit log", "select * from public.audit_log");
await expectAllowed("lists staff", "select * from public.list_staff()");
await expectAllowed("EXPORTS, with no second factor", "select * from public.export_dataset('owners')");
await expectAllowed("changes prices and branding", "update public.settings set data = '{\"a\":1}'::jsonb where id = 1");
await expectAllowed("deletes a payment", "delete from public.payments where amount = 25");
await expectAllowed("grants a role", "insert into public.staff_roles (user_id, role) values ($1,'employee') returning user_id", [users.stranger]);
await expectAllowed("changes a role", "update public.staff_roles set role = 'manager' where user_id = $1", [users.stranger]);
await expectAllowed("revokes a role", "delete from public.staff_roles where user_id = $1", [users.stranger]);

// =====================================================================
console.log("\n=== 10. The audit log ===");
await superuser();
const log = await db.query(
  "select action, actor_email, actor_role, entity, summary, detail from public.audit_log order by at"
);
console.log(`       ${log.rows.length} entries recorded`);
for (const r of log.rows.slice(0, 40)) {
  console.log(
    `       ${String(r.action).padEnd(22)} ${String(r.actor_email ?? "(service)").padEnd(24)} ${String(r.summary ?? "").slice(0, 74)}`
  );
}

const actions = log.rows.map((r) => r.action);
ok(actions.includes("role.granted"), "permission changes are recorded");
ok(actions.includes("role.changed"), "a role change is recorded");
ok(actions.includes("role.revoked"), "a revocation is recorded");
ok(actions.includes("dogs.update"), "a staff edit to a customer record is recorded");
ok(actions.some((a) => a === "export.dogs" || a === "export.owners"), "data exports are recorded");
ok(actions.includes("payments.insert"), "taking a payment is recorded");
ok(actions.includes("settings.update"), "a settings change is recorded");
ok(!actions.includes("signins.insert"), "routine sign-ins are deliberately not recorded");

const dogEdit = log.rows.find((r) => r.action === "dogs.update");
ok(
  Array.isArray(dogEdit?.detail?.changed) && dogEdit.detail.changed.includes("notes"),
  "the edit names the column that changed",
  JSON.stringify(dogEdit?.detail)
);
ok(
  !JSON.stringify(dogEdit?.detail).includes("hates rain"),
  "and does NOT copy the value into the log"
);
const exportEntry = log.rows.find((r) => String(r.action).startsWith("export."));
ok((exportEntry?.detail?.rows ?? -1) >= 0, "an export records how many rows left", JSON.stringify(exportEntry?.detail));

// Attribution is stamped by the database, not sent by the caller.
await as(users.employee);
await db.query("select public.audit_write($1,$2,$3,$4,$5)", [
  "auth.sign_in",
  "auth",
  null,
  "Signed in",
  JSON.stringify({ password: "hunter2", access_token: "eyJhbGciOiJIUzI1NiJ9.abcdefghij", card: "4111 1111 1111 1111", note: "took 42.50 on 4111-1111-1111-1111", method: "square" }),
]);
await superuser();
const signIn = (
  await db.query("select * from public.audit_log where action = 'auth.sign_in' order by at desc limit 1")
).rows[0];
ok(signIn?.actor_email === "frontdesk@staff.local", "the actor is stamped from the session", signIn?.actor_email);
ok(signIn?.actor_role === "employee", "so is the role at the time");
const detailText = JSON.stringify(signIn?.detail ?? {});
ok(!detailText.includes("hunter2"), "a password is stripped", detailText);
ok(!detailText.includes("eyJhbGciOiJIUzI1NiJ9"), "a token is stripped");
ok(!detailText.includes("4111"), "a card number is stripped, grouped or dashed", detailText);
ok(detailText.includes("square"), "ordinary business data survives");
ok(!String(signIn?.summary ?? "").includes("4111"), "and a card inside a sentence is stripped too");

// Forging and tampering.
await as(users.employee);
await expectDenied(
  "an employee cannot forge an entry directly",
  "insert into public.audit_log (action, summary) values ('role.granted','I promoted myself') returning id"
);
await superuser();
const upd = await attempt("update public.audit_log set summary = 'never happened' where id = $1", [signIn.id]);
ok(!upd.allowed && /append-only/i.test(upd.error ?? ""), "not even the secret key can edit history", upd.error?.slice(0, 80));
const del = await attempt("delete from public.audit_log where id = $1", [signIn.id]);
ok(!del.allowed && /append-only/i.test(del.error ?? ""), "or delete an entry", del.error?.slice(0, 80));

const before = (await db.query("select count(*)::int as n from public.audit_log")).rows[0].n;
const pruned = await attempt("select public.prune_audit_log($1) as removed", ["2099-01-01"]);
ok(pruned.allowed, "retention works through the one audited door");
const after = (await db.query("select count(*)::int as n from public.audit_log")).rows[0].n;
ok(after === 1, "which leaves behind its own record of the prune", `before ${before}, after ${after}`);

// =====================================================================
console.log("\n=== 10b. The staff list the Settings screen reads ===");
await as(users.employee);
const asEmployee = await attempt("select * from public.list_staff()");
ok(!asEmployee.allowed, "an employee cannot list who works here", asEmployee.error?.slice(0, 60));
await as(users.owner, "aal1");
const asOwner = await attempt("select * from public.list_staff()");
ok(asOwner.rows === 5, "an owner sees every account, including unassigned ones", `${asOwner.rows} rows`);

// =====================================================================
console.log("\n=== 10c. The staging table nobody had locked down ===");
await as(users.employee);
ok((await attempt("select * from public.vaccinations_staging")).rows === 0, "an employee gets nothing from it");
await expectDenied(
  "and cannot write to it",
  "insert into public.vaccinations_staging (dog_name) values ('x')"
);
await as(null, null, "anon");
await expectDenied("nor can the public website", "insert into public.vaccinations_staging (dog_name) values ('x')");
await as(users.manager, "aal2");
await expectAllowed(
  "a manager can, for an import",
  "insert into public.vaccinations_staging (dog_name) values ('Import Row')"
);

// =====================================================================
// PostgREST returns at most 1,000 rows per request whatever is asked for, so
// an export bigger than that has to be paged. It is checked here because the
// failure mode is silence: a truncated spreadsheet that looks complete.
console.log("\n=== 10d. An export bigger than one page ===");
await superuser();
await db.query(
  `insert into public.dogs (dog_name, last_name, phone)
   select 'Paged' || g, 'Fixture', '630555' || lpad(g::text, 4, '0') from generate_series(1, 2500) g`
);
await as(users.owner, "aal1");
const pages = [];
for (let offset = 0; ; offset += 1000) {
  const r = await db.query("select * from public.export_dataset('dogs', $1, 1000)", [offset]);
  pages.push(r.rows.length);
  if (r.rows.length < 1000) break;
  if (offset > 20000) break;
}
const totalPaged = pages.reduce((a, b) => a + b, 0);
const realTotal = (await db.query("select count(*)::int as n from public.dogs")).rows[0].n;
ok(totalPaged === realTotal, "paging returns every row, not the first page", `${totalPaged} of ${realTotal} in pages ${pages.join("+")}`);
ok(pages.length > 1, "and it really did take more than one page", `${pages.length} pages`);

// A total order matters as much as the paging: without the primary key as a
// tiebreak two dogs with the same name can swap between pages, so one row
// arrives twice and another never arrives.
await superuser();
await db.query("insert into public.dogs (dog_name, last_name, phone) select 'Same Name', 'Fixture', '6305557777' from generate_series(1, 40)");
await as(users.owner, "aal1");
const seen = new Set();
let duplicates = 0;
for (let offset = 0; ; offset += 1000) {
  const r = await db.query("select * from public.export_dataset('dogs', $1, 1000)", [offset]);
  for (const row of r.rows) {
    const id = row.export_dataset.id;
    if (seen.has(id)) duplicates++;
    seen.add(id);
  }
  if (r.rows.length < 1000) break;
  if (offset > 20000) break;
}
const afterDupes = (await db.query("select count(*)::int as n from public.dogs")).rows[0].n;
ok(duplicates === 0, "no row is handed over twice across pages", `${duplicates} duplicates`);
ok(seen.size === afterDupes, "and none is missed", `${seen.size} of ${afterDupes}`);

// =====================================================================
console.log("\n=== 11. Nothing left open ===");
await superuser();
const wide = await db.query(
  `select tablename, policyname, cmd from pg_policies
   where schemaname = 'public' and 'authenticated' = any(roles)
     and coalesce(qual,'true') = 'true' and coalesce(with_check,'true') = 'true'`
);
ok(wide.rows.length === 0, "no policy grants authenticated a bare true", JSON.stringify(wide.rows));

const noRls = await db.query(
  `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`
);
ok(noRls.rows.length === 0, "every table has RLS enabled", noRls.rows.map((r) => r.relname).join(", "));

const policyCount = (await db.query("select count(*)::int as n from pg_policies where schemaname='public'")).rows[0].n;
console.log(`       ${policyCount} policies in force`);

// =====================================================================
console.log("\n=== 12. Re-running every migration is safe ===");
for (const [file, label] of order) {
  await superuser();
  await runFile(`${REPO}/${file}`, `${label} again`);
}
await superuser();
const policyCount2 = (await db.query("select count(*)::int as n from pg_policies where schemaname='public'")).rows[0].n;
ok(policyCount2 === policyCount, "and does not duplicate policies", `${policyCount} then ${policyCount2}`);

// The employee is still refused after a re-run.
await as(users.employee);
await expectDenied("employee still cannot export after a re-run", "select * from public.export_dataset('dogs')");

// =====================================================================
console.log("\n=== 13. The rollback, and the lockdown again after it ===");
await superuser();
await runFile(`${REPO}/security-rollback.sql`, "security-rollback.sql stage 1");
await as(users.employee);
await superuser();
await db.query("insert into public.dogs (dog_name, last_name, phone) values ('Spare3','Fixture','6305550003')");
await as(users.employee);
await expectAllowed("after rollback an employee has full access again", "delete from public.dogs where dog_name = 'Spare3'");
await superuser();
const stillThere = (await db.query("select count(*)::int as n from public.staff_roles")).rows[0].n;
ok(stillThere > 0, "and the role assignments survived the rollback", `${stillThere} rows`);
await runFile(`${REPO}/rls-lockdown.sql`, "lockdown re-applied after rollback");
await as(users.employee);
await expectDenied("employee is locked down again", "select * from public.export_dataset('dogs')");

console.log(`\n${checks} checks, ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
