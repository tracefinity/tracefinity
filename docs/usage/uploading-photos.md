# Uploading Photos

## Paper as a size reference

Tracefinity uses a sheet of paper as a known-size reference to scale outlines to real-world dimensions. Place tools flat on A4, Letter, A3, or Tabloid paper.

The paper is for scale only. Tools can overflow the paper edges. The full visible area beyond the paper is included in the corrected image.

## Tips for good results

- **Contrasting background** -- use a dark surface under white paper (or vice versa). The AI needs to distinguish paper edges from the background.
- **Even lighting** -- avoid harsh shadows across the tools. Diffused overhead light works best.
- **Flat tools** -- tools should lie flat on the paper. Raised handles or 3D shapes confuse the mask generation.
- **No overlap** -- leave a small gap between tools so the AI can separate them.
- **Shoot from above** -- aim for directly overhead. Perspective correction handles some angle, but straight-down needs the least correction. Overhead does not mean close up: distance matters more than angle for scale accuracy.
- **Shoot from a distance** -- 50-60cm or more, with the page filling around half the frame; zoom in if the page looks small. The paper calibrates the table surface, so an outline raised above it traces oversized by H/(H-t) (camera height H, outline height t): about 2.5% for an edge 15mm above the paper from 60cm. See [Tall or thick objects](#tall-or-thick-objects).

## Tall or thick objects

The paper sets the scale at the table surface. The outline Tracefinity traces is the widest edge the camera can see, and on a tall object that edge is the top, which is nearer the lens than the paper. It traces too large, by roughly the height of that edge divided by the camera height.

| Edge above the paper | From 30cm | From 60cm | From 1.5m |
|-|-|-|-|
| 15mm | 5% | 2.5% | 1% |
| 40mm | 15% | 7% | 3% |
| 75mm | 33% | 14% | 5% |

To get the size right:

1. Lay the object on its flattest side, so the traced edge is as low as it can be.
2. Shoot from as far as is practical and zoom in until the page fills about half the frame.
3. Measure one dimension of the object, open the tool in the [tool editor](tool-editor.md#transforms) and type that measurement into the matching Size field. The whole outline scales to fit.

One scale suits an object whose outline forms at a single height. Where parts of the outline sit at different heights, set the size from the main body and adjust the rest by moving vertices.

## Photo warnings

After you confirm the paper corners, Tracefinity checks the photo and flags problems that reduce trace accuracy:

- **Camera too close** -- estimated from the photo's EXIF data. Close shots exaggerate outlines of thick tools (a 15 mm-thick tool shot from 25 cm traces roughly 6% oversized). Shoot from 60 cm or higher. Skipped when the photo has no EXIF data (e.g. screenshots), or when its EXIF records a different pixel size than the file has, as after a crop or resize. An editor that rewrites the EXIF size hides the crop, and the estimate then reads too close.
- **Paper cut off** -- a paper corner sits at or beyond the photo edge.
- **Extreme perspective** -- a strong camera angle degrades edge accuracy even after correction.

Warnings are advisory: you can dismiss them and continue, but retaking the photo gives better results.

## Supported formats

JPG, PNG, WebP, and HEIC. Uploads are limited to 20 MB and 64 megapixels by
default. Self-hosted instances can tune these limits with `MAX_UPLOAD_MB` and
`MAX_IMAGE_PIXELS`.

Images are automatically downscaled to a maximum of 2048px on the longest edge. Original uploads are deleted after perspective correction; only the corrected image is retained.

## Paper size

After uploading, select A4, Letter, A3, or Tabloid. Pick whichever you actually used. This determines the scale of everything downstream: tool outlines, bin dimensions, and exported STL geometry.

## Troubleshooting

- **Cutout comes out larger than the tool** -- the tool's outline sits above the paper, nearer the camera, so it traces oversized. Measure the tool and type that dimension into the Size fields in the [tool editor](tool-editor.md#transforms). See [Tall or thick objects](#tall-or-thick-objects).
