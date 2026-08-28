#!/usr/bin/env python3
"""dicompyler-core reference side of the RTDOSE validation harness (roadmap Phase E, PR 3).

Same folder and the same metrics as `metrics-rtdose-js.ts`, computed with dicompyler-core's
`dvhcalc`. Writes `dvh-dicompyler-core.json`; `compare.mjs` diffs it against the rtdose-js
report.

    python3 scripts/validation/metrics-dicompyler.py <folder> [--out file.json]

Needs:  pip install dicompyler-core pydicom   (tested against dicompyler-core >= 0.5.5)

Method note: `dvhcalc.get_dvh` defaults rasterize each structure contour onto the DOSE
grid, take the nearest dose plane per structure slice, and do no in-plane dose upsampling
(`interpolation_resolution=None`, `interpolation_segments_between_planes=0`). That is the
opposite resampling direction from rtdose-js (which samples dose at the structure voxel
centres) — the expected source of most disagreement. See VALIDATION.md.
"""
import sys
import os
import json
import glob
import datetime


def die(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


try:
    import pydicom
    import dicompylercore
    from dicompylercore import dicomparser, dvhcalc
except ImportError as e:
    die(f"{e} — pip install dicompyler-core pydicom")

args = sys.argv[1:]
if not args or args[0].startswith("--"):
    die("usage: python3 scripts/validation/metrics-dicompyler.py <folder> [--out file.json]")
folder = args[0]
out = args[args.index("--out") + 1] if "--out" in args else os.path.join(folder, "dvh-dicompyler-core.json")

D_PERCENTS = [2, 50, 95]
V_GYS = [5, 20, 30]

rs_path = None
dose_path = None
for path in sorted(glob.glob(os.path.join(folder, "*"))):
    if os.path.isdir(path):
        continue
    try:
        ds = pydicom.dcmread(path, stop_before_pixels=True, force=True)
    except Exception:
        continue
    modality = getattr(ds, "Modality", None)
    if modality == "RTSTRUCT" or "StructureSetROISequence" in ds:
        rs_path = path
    elif modality == "RTDOSE":
        dose_path = path

if rs_path is None:
    die("no RTSTRUCT (Modality RTSTRUCT / StructureSetROISequence) in the folder")
if dose_path is None:
    die("no RTDOSE (Modality RTDOSE) in the folder")

structures = dicomparser.DicomParser(rs_path).GetStructures()


def stat(dvh, name, relative=False):
    """dvh.statistic('D95') / dvh.statistic('V20Gy'); .relative_volume for % volumes."""
    src = dvh.relative_volume if relative else dvh
    try:
        return float(src.statistic(name).value)
    except Exception:
        return None


rois = []
for key, s in structures.items():
    name = s.get("name")
    try:
        calc = dvhcalc.get_dvh(rs_path, dose_path, key)
    except Exception as e:
        print(f"  skip ROI {key} {name!r}: {e}", file=sys.stderr)
        continue
    if calc is None or calc.volume == 0:
        print(f"  skip ROI {key} {name!r}: empty mask / no dose overlap", file=sys.stderr)
        continue

    dgy = {str(p): stat(calc, f"D{p}") for p in D_PERCENTS}
    vcm3 = {str(g): stat(calc, f"V{g}Gy") for g in V_GYS}
    vpct = {str(g): stat(calc, f"V{g}Gy", relative=True) for g in V_GYS}
    rois.append(
        {
            "name": name,
            "roiNumber": key,
            "volumeCm3": float(calc.volume),
            "meanGy": float(calc.mean),
            "minGy": float(calc.min),
            "maxGy": float(calc.max),
            "dGy": dgy,
            "vCm3": vcm3,
            "vPct": vpct,
        }
    )
    print(f"  ROI {key} {name!r}: mean {calc.mean:.3f} Gy, D95 {dgy['95']} Gy", file=sys.stderr)

report = {
    "source": "dicompyler-core",
    "toolVersion": dicompylercore.__version__,
    "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "method": {
        "resampling": "structure-rasterized-onto-dose-grid",
        "interpolation": "none (nearest dose plane, no in-plane upsampling)",
        "volumePolicy": "whole-voxel-binary",
        "notes": "dvhcalc.get_dvh defaults: interpolation_resolution=None, "
        "interpolation_segments_between_planes=0, use_structure_extents=False, "
        "calculate_full_volume=True",
    },
    "inputs": {
        "folder": folder,
        "rtdose": os.path.basename(dose_path),
        "rtstruct": os.path.basename(rs_path),
    },
    "rois": rois,
}

with open(out, "w") as f:
    json.dump(report, f, indent=2)
print(f"\nwrote {out} ({len(rois)} ROIs)", file=sys.stderr)
