These photos were taken by Jason Madigan and explicitly provided for use as
Tracefinity test fixtures. The fixtures were
resized through image ingest to 1536 × 2048 pixels; re-encoding removed EXIF,
including location metadata.

| Fixture | Original | Regression |
| --- | --- | --- |
| `bevel-square.jpg` | `IMG_2777.jpeg` | Uneven lighting cuts into the apparent top of the bright paper region. |
| `rafter-square.jpg` | `IMG_2786.jpeg` | Bright tabletop joins the paper region and moves the proposed bottom edge beyond the sheet. |
| `shadowed-pliers.jpg` | `IMG_2904.jpeg` | A brightness contour clips a shaded paper corner. |
| `line-level.jpg` | `IMG_2780.jpeg` | A brightness contour places the top edge inside the shaded sheet, stretching the traced level. |
| `distant-sheet.jpg` | `IMG_0742.HEIC` | The sheet covers a tenth of the frame on a light wooden floor. The brightness rectangle takes in floor beside it, and a saliency mask of the sheet moves the corners with it. The object in the photo is painted over. |

`test_paper_corners_photos.py` compares detected corners with manually annotated
visible sheet corners. These are calibration regressions, not claims about the
physical dimensions of raised tools. Synthetic photo-to-STL tests separately
check known flat-object dimensions and output clearance.
