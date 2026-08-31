# Pulling real DICOM from login-gated TCIA collections

`nbia-download.mjs` fetches DICOM series by `SeriesInstanceUID` into the gitignored
`scratch/` tree, so the `packages/*/scripts/validation/` harnesses can run against real
data from **restricted** TCIA collections (a second/third planning system for `rtdose-js`,
more SEG pipelines for `dicom-seg-js`, …).

Nothing here ships. The bearer token is only ever sent as an `Authorization: Bearer`
header — never logged, never in a URL.

---

## 1. Create a TCIA account

<https://www.cancerimagingarchive.net/> → **Login / Register** → **Create Account**. Free,
instant.

## 2. Get access to the restricted collection

Fully public collections need nothing beyond an account. **Restricted** ones (e.g.
`Brain-TR-GammaKnife`) require a signed license:

1. Open the collection's TCIA wiki page → **Data Access** section.
2. Download the **TCIA Restricted License Agreement** PDF, sign it.
3. Email it to `help@cancerimagingarchive.net` from the address on your account.
4. Wait for confirmation that your account has been granted access (often 1–2 business
   days). Until then the API returns HTTP 403 for that collection.

## 3. Mint a bearer token (valid 2 hours)

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

## 4. Find the SeriesInstanceUIDs

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

## 5. Build a manifest and download

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

## 6. Re-run the harnesses

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
