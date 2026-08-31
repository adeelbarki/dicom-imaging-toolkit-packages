#!/usr/bin/env node
// NBIA (TCIA) series downloader for the validation harnesses.
//
// Pulls DICOM series by SeriesInstanceUID into the gitignored scratch/ tree so the
// packages/*/scripts/validation/ harnesses can run against real data from
// login-gated TCIA collections. Nothing here ships (not in any package's `files`).
//
// Auth: export NBIA_TOKEN with a bearer token — see scripts/README-nbia.md for how to
// mint one (or run `node scripts/nbia-download.mjs login`). Restricted collections
// REQUIRE a token whose account has been granted access; fully public data works without.
// The token is only ever sent as an `Authorization: Bearer` header — never logged, never
// put in a URL.
//
// Commands:
//   login                      exchange NBIA_USER / NBIA_PASS for a token, print the export line
//   list  --collection <C> [--modality <M>] [--patient <P>]
//                              print SeriesInstanceUIDs (tab-separated) to build a manifest
//   fetch <manifest.json> [--force]
//   fetch --out <dir> <SeriesInstanceUID>... [--force]
//
// Manifest JSON:
//   { "outDir": "scratch/data-dose",
//     "cases": [
//       { "name": "GammaPlan-GK-001", "series": ["<ct-uid>", "<rtstruct-uid>", "<rtdose-uid>"] }
//     ] }
// Each case becomes  <outDir>/<name>/  filled with .dcm files from every listed series.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASE = (process.env.NBIA_BASE ?? "https://services.cancerimagingarchive.net/nbia-api").replace(/\/+$/, "");
const API = `${BASE}/services/${process.env.NBIA_API_VERSION ?? "v1"}`; // v1 is the complete namespace; v2 lacks getSeries
const TOKEN_URL = `${BASE}/oauth/token`;
const IMAGE_ENDPOINT = process.env.NBIA_IMAGE_ENDPOINT ?? "getImage"; // or "getImageWithMD5Hash"

function fail(msg) {
  console.error(`nbia-download: ${msg}`);
  process.exit(1);
}

function token() {
  return (process.env.NBIA_TOKEN ?? "").trim();
}

function authHeaders() {
  const t = token();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function apiJson(path, params) {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") url.searchParams.set(k, v);
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 401) fail("HTTP 401 — NBIA_TOKEN is missing or expired (tokens last 2h). Mint a fresh one.");
  if (res.status === 403) fail("HTTP 403 — the token's account is not granted access to this collection.");
  if (!res.ok) fail(`${path} -> HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (!text.trim()) return [];
  try {
    return JSON.parse(text);
  } catch {
    fail(`${path} -> non-JSON response (first 200 chars): ${text.slice(0, 200)}`);
  }
}

// -- login -----------------------------------------------------------------

async function cmdLogin() {
  const user = process.env.NBIA_USER ?? argVal("--user");
  const pass = process.env.NBIA_PASS;
  if (!user) fail("set NBIA_USER (or pass --user <name>)");
  if (!pass) {
    fail(
      "set NBIA_PASS without leaving it in shell history, e.g.:\n" +
        "    read -rs NBIA_PASS && export NBIA_PASS\n" +
        "  then re-run `node scripts/nbia-download.mjs login`, then `unset NBIA_PASS`.",
    );
  }
  const body = new URLSearchParams({ username: user, password: pass, client_id: "NBIA", grant_type: "password" });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (res.status === 400 || res.status === 401) fail("token endpoint rejected the credentials (HTTP " + res.status + ").");
  if (!res.ok) fail(`token endpoint -> HTTP ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (!json.access_token) fail(`no access_token in response: ${JSON.stringify(json).slice(0, 200)}`);
  const mins = Math.round((json.expires_in ?? 7200) / 60);
  process.stderr.write(`# NBIA token minted, valid ~${mins} min. Run the line below (or eval it):\n`);
  process.stdout.write(`export NBIA_TOKEN='${json.access_token}'\n`);
}

// -- list ----------------------------------------------------------------

async function cmdList() {
  const collection = argVal("--collection");
  if (!collection) fail("list needs --collection <name>");
  const rows = await apiJson("getSeries", {
    Collection: collection,
    Modality: argVal("--modality"),
    PatientID: argVal("--patient"),
  });
  if (!Array.isArray(rows) || rows.length === 0) {
    fail("no series returned — check the collection name, your token, and your access rights.");
  }
  rows.sort((a, b) =>
    `${a.PatientID ?? ""}|${a.Modality ?? ""}`.localeCompare(`${b.PatientID ?? ""}|${b.Modality ?? ""}`),
  );
  // patientID <tab> modality <tab> imageCount <tab> seriesDescription <tab> SeriesInstanceUID
  for (const r of rows) {
    console.log(
      [
        r.PatientID ?? "?",
        r.Modality ?? "?",
        r.ImageCount ?? r.imageCount ?? "?",
        (r.SeriesDescription ?? "").replace(/\s+/g, " ").trim(),
        r.SeriesInstanceUID,
      ].join("\t"),
    );
  }
  console.error(`\n${rows.length} series (patientID  modality  #img  description  SeriesInstanceUID)`);
}

// -- fetch ---------------------------------------------------------------

// Modality -> filename prefix the packages/*/scripts/validation/ harnesses recognise
// (they classify by `^(ct|mr|pt)[-_.]` for image series and `^(rt|rs)[-_.]` for RT objects).
const PREFIX = {
  CT: "CT", MR: "MR", PT: "PT", NM: "NM", US: "US",
  RTSTRUCT: "RS", RTDOSE: "RD", RTPLAN: "RP", RTIMAGE: "RI",
  SEG: "SEG", REG: "REG",
};

async function seriesMeta(uid) {
  const rows = await apiJson("getSeriesMetaData", { SeriesInstanceUID: uid });
  const r = Array.isArray(rows) ? rows[0] ?? {} : {};
  return {
    modality: r.Modality ?? r.modality ?? "UNK",
    manufacturer: r.Manufacturer ?? r.manufacturer ?? "",
    model: r["Manufacturer Model Name"] ?? r.ManufacturerModelName ?? "",
    description: (r["Series Description"] ?? r.SeriesDescription ?? "").replace(/\s+/g, " ").trim(),
  };
}

async function downloadSeries(uid, destDir, meta) {
  const url = new URL(`${API}/${IMAGE_ENDPOINT}`);
  url.searchParams.set("SeriesInstanceUID", uid);
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 401) fail("HTTP 401 — NBIA_TOKEN missing or expired.");
  if (res.status === 403) fail(`HTTP 403 — no access to series ${uid}.`);
  if (!res.ok) fail(`${IMAGE_ENDPOINT} ${uid} -> HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4 || buf.readUInt16LE(0) !== 0x4b50) {
    fail(`${uid}: response is not a zip (${buf.length} bytes) — token or endpoint problem.`);
  }
  const work = join(tmpdir(), `nbia-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const tmpZip = `${work}.zip`;
  writeFileSync(tmpZip, buf);
  mkdirSync(work, { recursive: true });
  mkdirSync(destDir, { recursive: true });
  // <MOD>-<last10 of UID>-<origname>.dcm — MOD prefix so the harnesses classify by name;
  // the UID fragment keeps two series of the same modality from colliding in one flat dir.
  const prefix = `${PREFIX[meta.modality] ?? meta.modality}-${uid.slice(-10)}`;
  try {
    execFileSync("unzip", ["-o", "-q", tmpZip, "-d", work], { stdio: ["ignore", "ignore", "inherit"] });
    let n = 0;
    for (const f of readdirSync(work)) {
      if (f.toLowerCase().endsWith(".dcm")) {
        renameSync(join(work, f), join(destDir, `${prefix}-${f}`));
        n++;
      } else if (f === "LICENSE" && !existsSync(join(destDir, "LICENSE.txt"))) {
        renameSync(join(work, f), join(destDir, "LICENSE.txt"));
      }
    }
    return n;
  } finally {
    rmSync(tmpZip, { force: true });
    rmSync(work, { recursive: true, force: true });
  }
}

async function cmdFetch() {
  const args = process.argv.slice(3);
  const force = args.includes("--force");
  let outBase;
  let cases;

  if (args[0] && !args[0].startsWith("--")) {
    const m = JSON.parse(readFileSync(resolve(args[0]), "utf8"));
    outBase = resolve(REPO_ROOT, m.outDir ?? "scratch");
    cases = Array.isArray(m.cases) ? m.cases : [];
  } else {
    const i = args.indexOf("--out");
    if (i < 0) fail("fetch needs <manifest.json>, or --out <dir> followed by SeriesInstanceUIDs");
    const dir = args[i + 1];
    if (!dir) fail("--out needs a directory");
    const series = args.slice(i + 2).filter((a) => !a.startsWith("--"));
    if (series.length === 0) fail("no SeriesInstanceUIDs given after --out <dir>");
    outBase = REPO_ROOT;
    cases = [{ name: dir, series }];
  }
  if (cases.length === 0) fail("manifest has no cases");
  if (!token()) console.error("nbia-download: no NBIA_TOKEN set — this only works for fully public series.");

  for (const c of cases) {
    if (!c.name || !Array.isArray(c.series) || c.series.length === 0) {
      fail(`bad case entry: ${JSON.stringify(c)}`);
    }
    const dir = resolve(outBase, c.name);
    if (existsSync(dir) && readdirSync(dir).length > 0 && !force) {
      console.log(`=  ${c.name}  (exists — skipping; --force to redownload)`);
      continue;
    }
    console.log(`↓  ${c.name}  (${c.series.length} series)`);
    let total = 0;
    const provenance = [];
    for (const uid of c.series) {
      const meta = await seriesMeta(uid);
      const n = await downloadSeries(uid, dir, meta);
      console.log(
        `     ${meta.modality.padEnd(8)} ${String(n).padStart(4)} .dcm  ${meta.manufacturer || "?"}` +
          `${meta.model ? ` / ${meta.model}` : ""}  ${uid}`,
      );
      provenance.push({ seriesInstanceUID: uid, ...meta, files: n });
      total += n;
    }
    writeFileSync(join(dir, "_provenance.json"), JSON.stringify({ case: c.name, series: provenance }, null, 2));
    console.log(`   ${c.name}: ${total} .dcm files in ${dir.replace(REPO_ROOT, "")}  (+ _provenance.json)`);
  }
}

// -- arg helper --------------------------------------------------------

function argVal(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const cmd = process.argv[2];
if (cmd === "login") await cmdLogin();
else if (cmd === "list") await cmdList();
else if (cmd === "fetch") await cmdFetch();
else {
  console.error(
    [
      "usage:",
      "  node scripts/nbia-download.mjs login                       # NBIA_USER/NBIA_PASS -> token",
      "  node scripts/nbia-download.mjs list  --collection <C> [--modality <M>] [--patient <P>]",
      "  node scripts/nbia-download.mjs fetch <manifest.json> [--force]",
      "  node scripts/nbia-download.mjs fetch --out <dir> <SeriesInstanceUID>... [--force]",
      "",
      "  NBIA_TOKEN   bearer token (see scripts/README-nbia.md)",
      "  NBIA_BASE    API base (default https://services.cancerimagingarchive.net/nbia-api)",
    ].join("\n"),
  );
  process.exit(1);
}
