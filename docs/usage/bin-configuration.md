# Bin Configuration

Gridfinity is a modular storage system where bins snap into a baseplate grid. Each grid unit is 42mm x 42mm. Tracefinity generates bins that conform to the Gridfinity spec.

## Configuration options

| Setting | Range | Default | Notes |
|-|-|-|-|
| Grid width | 1-10 u | 2 | Each unit is 42mm |
| Grid depth | 1-10 u | 2 | |
| Height | 1-20 u | 4 | Each unit is 7mm + 4.75mm base |
| Cutout depth | 5mm-max | 20mm | Max depends on height and stacking lip |
| Clearance | 0-5mm | 1.0mm | Gap around tool outlines |
| Cutout chamfer | 0-3mm | 0mm | Bevel on top edge of pockets |
| Magnet diameter | 3-10mm | 6mm | Standard Gridfinity magnets are 6x2mm |
| Magnet depth | 1-5mm | 2.4mm | Slightly deeper than magnet for press-fit |
| Insert height | 0.5-10mm | 1.0mm | Only shown when insert is enabled |
| Bed size | 150-400mm | 256mm | For auto-splitting oversized bins |

## Toggles

**Magnet holes** -- recesses in the bin base for magnets. On by default.

**Corners only** -- magnet holes only at the four outer corners instead of all grid positions.

**Stacking lip** -- raised rim so bins stack securely. On by default. Adds approximately 4.4mm to total height and reduces maximum cutout depth.

**Contrast insert** -- generates a separate STL to print in a different colour. The pocket is deepened automatically to accommodate the insert thickness.

## Auto grid sizing

On by default. When enabled, grid width and depth automatically adjust to fit all placed tools, and the grid width/depth sliders are disabled. Toggle it off to set grid size manually; the sliders become active again.

## Default bin settings

Defaults can be saved at two levels:

- **Global** -- stored in browser localStorage. Apply to all new bins. Set from the bin editor or settings page.
- **Per-project** -- stored on the project via the API. Override global defaults for bins created within that project.

Use "Save as defaults" to capture the current bin config. Use "Reset defaults" to restore factory settings (2x2 grid, 4u height, magnets on, stacking lip on).

## Bed splitting

If the bin dimensions exceed your configured bed size, Tracefinity automatically splits it into printable pieces. You get:

- Individual STLs for each piece (also available as a ZIP).
- The full merged STL for large-format printers.
- A split preview in the 3D viewer.
