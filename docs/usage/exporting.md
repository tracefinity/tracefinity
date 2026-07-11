# Exporting

## Bin export

From the bin editor, click **Export** to open the download menu. Available formats depend on what the bin contains.

### STL

Standard mesh format. Works with every slicer (PrusaSlicer, Cura, OrcaSlicer, etc.).

If the bin is too large for the configured bed size or the bin is separated by the partial bins configuration, the export menu shows **Full STL** (the merged file) and **ZIP** (split parts as separate STLs). The split count is shown in the sidebar banner.

### 3MF

Compressed format with multi-body support. Only generated when the bin has text labels, because the label geometry is stored as a separate body for multi-colour printing. The bin body and text body are exported as distinct objects in the 3MF file.

Internally uses trimesh for the 3MF scene assembly. The bin and text manifolds are converted to trimesh meshes and exported as named geometries.

### Insert STL

Available when **Contrast Insert** is enabled in the bin configuration. This is a separate STL of just the insert piece, intended for printing in a contrasting colour. Download it from the export menu alongside the main bin STL.

## Tool export

From the tool editor, download the outline as an SVG file. Useful for laser cutting, CNC routing, or importing into CAD software.

## Print recommendations

Tracefinity bins are standard Gridfinity geometry, so the usual print settings apply:

| Setting | Recommendation |
|-|-|
| Layer height | 0.2mm default. 0.16mm for a smoother stacking lip. |
| Infill | 10-15%. Bin walls are thin and do not need much internal structure. |
| Supports | Not needed. Bins are designed to print without supports. |
| Material | PLA works well. PETG for more durability. |
| Orientation | Print with the base down (the default orientation in the exported file). |
