# Uploading Photos

## Paper as a size reference

Tracefinity uses a sheet of paper as a known-size reference to scale outlines to real-world dimensions. Place tools flat on A4, Letter, A3, or Tabloid paper.

The paper is for scale only. Tools can overflow the paper edges. The full visible area beyond the paper is included in the corrected image.

## Tips for good results

- **Contrasting background** -- use a dark surface under white paper (or vice versa). The AI needs to distinguish paper edges from the background.
- **Even lighting** -- avoid harsh shadows across the tools. Diffused overhead light works best.
- **Flat tools** -- tools should lie flat on the paper. Raised handles or 3D shapes confuse the mask generation.
- **No overlap** -- leave a small gap between tools so the AI can separate them.
- **Shoot from above** -- aim for directly overhead. Perspective correction handles some angle, but straight-down gives the most accurate scale.

## Supported formats

JPG, PNG, WebP, and HEIC. There is no hard file size limit, but large photos take longer to upload and process.

Images are automatically downscaled to a maximum of 2048px on the longest edge. Original uploads are deleted after perspective correction; only the corrected image is retained.

## Paper size

After uploading, select A4, Letter, A3, or Tabloid. Pick whichever you actually used. This determines the scale of everything downstream: tool outlines, bin dimensions, and exported STL geometry.
