#!/usr/bin/env python3
"""highdicom reference side of the SEG validation harness (roadmap §9, Phase F PR 4).

Reconstructs a SEG with highdicom (its authoritative BINARY bit-unpacking + functional-group
parse) and emits the same per-(segment, z) FNV-1a slice checksums + invariants as
`metrics-dicom-seg-js.ts`, so `compare.mjs` can diff the two reconstructions.

    python3 scripts/validation/metrics-highdicom.py <seg.dcm> [--out file.json]

Needs:  pip install highdicom pydicom   (tested highdicom 0.28, pydicom 3.0)
"""
import sys
import os
import json


def die(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


try:
    import numpy as np
    from highdicom.seg import segread
except ImportError as e:
    die(f"{e} — pip install highdicom pydicom numpy")

args = sys.argv[1:]
if not args or args[0].startswith("--"):
    die("usage: python3 scripts/validation/metrics-highdicom.py <seg.dcm> [--out file.json]")
path = args[0]
out = args[args.index("--out") + 1] if "--out" in args else os.path.splitext(path)[0] + ".highdicom.json"

seg = segread(path)

iop = [float(x) for x in seg.SharedFunctionalGroupsSequence[0].PlaneOrientationSequence[0].ImageOrientationPatient]
row_dir = np.array(iop[:3])
col_dir = np.array(iop[3:])
normal = np.cross(row_dir, col_dir)
spacing = [float(x) for x in seg.SharedFunctionalGroupsSequence[0].PixelMeasuresSequence[0].PixelSpacing]

pixels = seg.pixel_array  # (frames, rows, cols) uint8 — 0/1 for BINARY, 0..max for FRACTIONAL
if pixels.ndim == 2:
    pixels = pixels[np.newaxis, ...]
is_binary = str(seg.SegmentationType).upper() == "BINARY"


def fnv1a(buf: bytes) -> str:
    h = 0x811C9DC5
    for b in buf:
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return format(h, "08x")


def rnd(x):
    return round(x * 1000) / 1000


def _code(info, attr):
    if info is None or not hasattr(info, attr):
        return None
    seqv = getattr(info, attr)
    if len(seqv) == 0:
        return None
    return str(getattr(seqv[0], "CodeMeaning", "")) or None


frames_by_segment = {}
for i, fg in enumerate(seg.PerFrameFunctionalGroupsSequence):
    n = int(fg.SegmentIdentificationSequence[0].ReferencedSegmentNumber)
    ipp = np.array([float(x) for x in fg.PlanePositionSequence[0].ImagePositionPatient])
    z = float(np.dot(ipp, normal))
    frames_by_segment.setdefault(n, []).append((z, i))

seg_infos = {int(s.SegmentNumber): s for s in seg.SegmentSequence}
segments = []
all_z = set()
for n in sorted(frames_by_segment):
    info = seg_infos.get(n)
    count = 0
    vsum = 0
    vmax = 0
    slices = []
    for z, fi in sorted(frames_by_segment[n], key=lambda t: t[0]):
        frame = pixels[fi]
        if is_binary:
            b = (frame != 0).astype(np.uint8)
        else:
            b = frame.astype(np.uint8)
        nz = int((b != 0).sum())
        count += nz
        if not is_binary:
            vsum += int(b[b != 0].sum())
            vmax = max(vmax, int(b.max()))
        slices.append({"z": rnd(z), "nonzero": nz, "checksum": fnv1a(b.tobytes())})
        all_z.add(rnd(z))
    segments.append(
        {
            "number": n,
            "label": str(getattr(info, "SegmentLabel", "")) if info is not None else "",
            "category": _code(info, "SegmentedPropertyCategoryCodeSequence"),
            "propertyType": _code(info, "SegmentedPropertyTypeCodeSequence"),
            "nonzeroVoxelCount": count,
            "rawValueSum": None if is_binary else vsum,
            "rawValueMax": None if is_binary else vmax,
            "slices": slices,
        }
    )


report = {
    "source": "highdicom",
    "file": os.path.basename(path),
    "segmentationType": str(seg.SegmentationType),
    "fractionalType": str(getattr(seg, "SegmentationFractionalType", "")) or None,
    "maximumFractionalValue": int(getattr(seg, "MaximumFractionalValue", 0)) or None,
    "segmentsOverlap": str(getattr(seg, "SegmentsOverlap", "UNDEFINED")),
    "geometry": {
        "rows": int(seg.Rows),
        "columns": int(seg.Columns),
        "planes": len(all_z),
        "pixelSpacing": spacing,
        "planeZ": sorted(all_z),
    },
    "segments": segments,
}

with open(out, "w") as f:
    json.dump(report, f, indent=2)
print(f"wrote {out} — {seg.SegmentationType}, {len(segments)} segment(s), {len(all_z)} planes", file=sys.stderr)
for s in segments:
    print(f"  seg {s['number']} {s['label']!r}: {s['nonzeroVoxelCount']} voxels", file=sys.stderr)
