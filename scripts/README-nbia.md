# Pulling real DICOM from TCIA collections

`nbia-download.mjs` fetches DICOM series by `SeriesInstanceUID` into the gitignored
`scratch/` tree, so the `packages/*/scripts/validation/` harnesses can run against real
data (a second/third planning system for `rtdose-js`, more SEG pipelines for
`dicom-seg-js`, …).

Nothing here ships. The bearer token is only ever sent as an `Authorization: Bearer`
header — never logged, never in a URL.

---

## 1. You often need *no* account — try a guest token first

Fully public collections (most of TCIA, including `Vestibular-Schwannoma-SEG` — Elekta
GammaPlan RTDOSE) download with an anonymous **guest** token:

```sh
export NBIA_TOKEN=$(
  curl -s -d "username=nbia_guest&password=&client_id=NBIA&grant_type=password" \
    https://services.cancerimagingarchive.net/nbia-api/oauth/token | jq -r .access_token
)
node scripts/nbia-download.mjs list --collection Vestibular-Schwannoma-SEG --modality RTDOSE
```

If `list` returns rows, you're set — skip to step 5. Only **restricted / limited-access**
collections (`Brain-TR-GammaKnife`, …) return nothing to guest and need steps 2–4.

## 2. Create a TCIA account (restricted collections only)

The account link is **not** on the marketing homepage any more. Use the **NBIA Data
Portal**: <https://nbia.cancerimagingarchive.net/nbia-search/> → let it finish
"Initializing…" → **Login** (top-right) → **"Create a new account"** in the dialog. If that
link isn't visible, email **help@cancerimagingarchive.net** (or text +1 385-275-8242) and
ask them to create the account — they do this routinely. The same credentials drive the
REST API `oauth/token`.

## 3. Get the restricted-license grant

1. Open the collection's TCIA wiki page → **Data Access**.
2. Download the **TCIA Restricted License Agreement** PDF, sign it.
3. Email it to `help@cancerimagingarchive.net` from the address on your account.
4. Wait for confirmation your account was granted access (often 1–2 business days). Until
   then the API returns HTTP 403 for that collection, and `getCollectionValues` /
   `list` won't show it.

## 4. Mint a bearer token — restricted collections (valid 2 hours)

The token endpoint takes your account username + password as form fields. Keep the
password out of your shell history:

```sh
read -rs NBIA_PASS && export NBIA_PASS        # type password, hidden, then Enter
export NBIA_USER='your-tcia-username'

export NBIA_TOKEN=$(
  curl -s \
    --data-urlencode "username=$NBIA_USER" \
    --data-urlencode "password=$NBIA_PASS" \
    -d client_id=NBIA -d grant_type=password \
    https://services.cancerimagingarchive.net/nbia-api/oauth/token | jq -r .access_token
)

unset NBIA_PASS
echo "${NBIA_TOKEN:0:12}…  (len ${#NBIA_TOKEN})"   # sanity check, not the whole token
```

Or let the script do the POST and print the `export` line for you:

```sh
read -rs NBIA_PASS && export NBIA_PASS
export NBIA_USER='your-tcia-username'
eval "$(node scripts/nbia-download.mjs login)"
unset NBIA_PASS
```

If a later command prints **HTTP 401**, the token expired — repeat this step. Downloaded
cases are skipped on re-run, so it just resumes.

## 5. Find the SeriesInstanceUIDs

```sh
# every RTDOSE series in a collection:
node scripts/nbia-download.mjs list --collection Brain-TR-GammaKnife --modality RTDOSE

# everything for one patient (to grab the matching MR/CT + RTSTRUCT + RTDOSE):
node scripts/nbia-download.mjs list --collection Brain-TR-GammaKnife --patient GK_MMH_0001
```

Output is tab-separated: `patientID  modality  #img  description  SeriesInstanceUID`.

A restricted collection returns **nothing** (and isn't in `getCollectionValues`) until your
account is granted access — that's expected, not a typo. The exact collection string is on
the collection's TCIA wiki page; once access lands, `list` shows its series.

## 6. Build a manifest and download

```sh
cp scripts/nbia-cases.example.json scripts/nbia-cases.json   # gitignored
# edit: one case per folder, list the CT/MR series first, then RTSTRUCT, then RTDOSE/SEG

node scripts/nbia-download.mjs fetch scripts/nbia-cases.json
```

or a one-off without a manifest:

```sh
node scripts/nbia-download.mjs fetch --out scratch/data-dose/GammaPlan-GK-001 \
  <mr-or-ct-uid> <rtstruct-uid> <rtdose-uid>
```

Each case lands in `<outDir>/<name>/` as flat `.dcm` files, named by modality —
`CT-<id>-NNNNNNNN.dcm`, `RS-<id>-*.dcm`, `RD-<id>-*.dcm`, `SEG-<id>-*.dcm` — the prefix
the harnesses classify by. Also written:

- `_provenance.json` — per-series `SeriesInstanceUID` / `Modality` / `Manufacturer` /
  model / description. Copy the manufacturer + model straight into the package's
  `VALIDATION.md` data-sources table.
- `LICENSE.txt` — the collection's data-use terms, from the NBIA zip.

The harnesses ignore both (they only read `*.dcm`).

## 7. Re-run the harnesses

See each package's `scripts/validation/README.md`. In short:

```sh
# rtdose — needs an isolated venv (dicompyler-core needs pydicom<3)
python3 -m venv /tmp/dvh-venv && /tmp/dvh-venv/bin/pip install "pydicom<3" "dicompyler-core==0.5.6" "numpy<2"
cd packages/rtdose
CASE=../../scratch/data-dose/GammaPlan-GK-001
npx tsx scripts/validation/metrics-rtdose-js.ts "$CASE" --method trilinear
/tmp/dvh-venv/bin/python scripts/validation/metrics-dicompyler.py "$CASE"
node scripts/validation/compare.mjs "$CASE"/dvh-rtdose-js.trilinear.json "$CASE"/dvh-dicompyler-core.json

# dicom-seg — needs highdicom (pydicom 3.x)
python3 -m venv /tmp/seg-venv && /tmp/seg-venv/bin/pip install highdicom
cd packages/dicom-seg
npx tsx scripts/validation/metrics-dicom-seg-js.ts ../../scratch/data-seg/<case>/SEG.dcm
/tmp/seg-venv/bin/python scripts/validation/metrics-highdicom.py ../../scratch/data-seg/<case>/SEG.dcm
node scripts/validation/compare.mjs <a>.dicom-seg-js.json <b>.highdicom.json
```

---

**Data-use reminder.** Restricted-collection DICOM must not be committed or redistributed
(`scratch/` is gitignored). Only aggregate, derived numbers go into the `VALIDATION.md`
files — the same rule the existing entries follow.
