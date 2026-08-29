# rt-convert-js

Convert between DICOM **RT Structure Sets** and DICOM **Segmentation**, built on
[`rt-geometry-js`](https://www.npmjs.com/package/rt-geometry-js),
[`rtstruct-js`](https://www.npmjs.com/package/rtstruct-js), and
[`dicom-seg-js`](https://www.npmjs.com/package/dicom-seg-js). Part of the
[DICOM imaging toolkit](https://github.com/adeelbarki/dicom-imaging-toolkit-packages).

**Status:** in development — `0.1.0` not yet published. `rtstructToSeg` (RTSTRUCT ROI →
`BINARY` SEG) is implemented; `segToRtstruct` and the real-file validation land in the
following PRs.

The two directions are not symmetric, and neither is lossless in general:

- **RTSTRUCT → SEG** is a voxel copy. `RTStruct.load` already rasterized the contours onto
  a grid; this writes exactly those voxels. No information is lost *here* (it was lost, if
  at all, at rasterization time).
- **SEG → RTSTRUCT** traces a mask to polygon contours (a vectorization), and — for a
  `FRACTIONAL` SEG — first cuts the probability/occupancy field to a binary mask at a
  **threshold the caller must choose**. RTSTRUCT cannot store a per-voxel value.

Every conversion returns `{ bytes, provenance }`. `provenance.lossySteps` lists each step
that does not round-trip, with the numbers to audit it. See
[`docs/CONVERSION.md`](docs/CONVERSION.md).

## Install

```sh
npm install rt-convert-js rt-geometry-js rtstruct-js dicom-seg-js
```

All three toolkit packages are peer dependencies.

## Use

```ts
import { RTStruct } from "rtstruct-js";
import { rtstructToSeg } from "rt-convert-js";

const rt = await RTStruct.load({ rtstruct: rtssBytes, geometry: ctGeometry });
const { bytes, provenance } = rtstructToSeg(rt, "Kidney", {
  category: { value: "T-D0050", scheme: "SRT", meaning: "Anatomical Structure" },
  propertyType: { value: "T-71000", scheme: "SRT", meaning: "Kidney" },
});

provenance.lossySteps; // []  — this direction is a voxel copy
```

`rt-convert-js` does **not** re-export `rtstruct-js` or `dicom-seg-js` (they each
re-export all of `rt-geometry-js`, so re-exporting both would collide). Import `RTStruct`,
`readSeg`, and the geometry types from those packages directly.

## License

[MIT](LICENSE)
