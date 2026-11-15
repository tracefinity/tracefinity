# Guides

Step-by-step guides, each covering one job in Tracefinity.

## Start here

- [Make your first bin from a photo](first-bin-from-a-photo.md): The whole path once: photograph a tool, set the corners and paper size, trace it, check it, then make a bin and print it.
- [Take a photo that traces accurately](take-a-photo-that-traces-well.md): Set up the sheet, surface and light, then frame the photo so Tracefinity scales and traces your tools correctly.

## Photos and tracing

- [Trace tall or thick objects at the right size](tall-or-thick-objects.md): Why tall objects trace too large, and how to shoot, measure and set the size so the pocket fits.
- [Trace shiny, chrome or black tools](shiny-or-dark-tools.md): Set up light and background so chrome, black and pale tools trace cleanly, then fix any outline that still comes out wrong.
- [Trace small or thin tools](small-or-thin-tools.md): How small a tool Tracefinity keeps, how thin a part survives, and how to frame bits, hex keys and blades so they trace whole.
- [Trace tools longer than the sheet](tools-longer-than-the-sheet.md): How far a tool can hang off the sheet, when to use A3 or Tabloid, and how long a bin a long tool can have.
- [Trace a whole set in one photo](trace-a-set-in-one-photo.md): Lay a set out on one sheet, trace it once, then pick and name the tools to keep.
- [Fix a trace that's slightly off](fix-a-trace.md): Repair a missing part, a shadow, a stray hole or a ragged edge in the tool editor, mirror symmetric tools, and know when to trace again.
- [Fix a cutout that comes out the wrong size](cutout-wrong-size.md): Find out whether a pocket that rattles or binds comes from the photo, the paper size, Clearance or your printer, and fix that cause.

## Designing bins

- [Get a snug fit](snug-fit.md): Check the outline on paper, print a shallow test pocket, then set Clearance so tools drop in without rattling.
- [Add finger holes so tools lift out](finger-holes.md): Put a finger hole on the edge of a tool's outline, make it deep enough to reach the tool, and keep it clear of the walls.
- [Make a two-colour bin with a contrast insert](contrast-insert.md): Print a thin insert in a second colour for each pocket, so an empty pocket shows the shape of the missing tool.
- [Label a bin](label-a-bin.md): Add raised or recessed text to a bin, keep it where it will print, and print it in a second colour.
- [Save filament with partial bins](partial-bins.md): Switch off the grid cells your tools do not need, pick how the rest prints, and keep the pockets whole.
- [Stack bins over tools taller than their pocket](stack-over-tall-tools.md): Use Raise Lip so a bin stacked on top clears a tool that sticks up out of its pocket, and work out how many units it needs.

## Printing and planning

- [Print a bin bigger than your printer bed](bigger-than-your-bed.md): Set your bed size, see where Tracefinity cuts an oversized bin, export the pieces and join them in the baseplate.
- [Plan a whole drawer](plan-a-drawer.md): Measure a drawer, make a project and its bins, then lay them out in a drawer plan and check the fit in 3D before you print.
- [Use outlines for laser cutting, CNC and foam](laser-cutting-and-cnc.md): Export a tool's outline as a full-size SVG, import it at the right scale, and add the clearance a pocket needs.

## Maintaining these guides

Check a guide against the app's code, not only the usage docs: labels and limits come from `frontend/src`, tracing, sizes and exports from `backend/app`. Tracing steps differ between one tracer and several, so check both. A guide that works round a bug names its issue, such as [#273](https://github.com/tracefinity/tracefinity/issues/273) in [Make your first bin from a photo](first-bin-from-a-photo.md); update the guide when the fix ships.

The SVG diagrams are drawn by hand. The PNG screenshots come from `frontend/scripts/guide-screenshots.ts`, which needs Node 22.6 or newer. It drives a running Tracefinity with `AUTH_MODE=open` over a copy of the demo library in `backend/storage/default`, whose tools and photos it picks by id, and makes its own bins, projects and uploads, named `Guide: ...`. The photos are too large to keep in the repository, so the script needs a library that has them; it checks before taking any shots and lists whatever is missing. It captures at twice the display size, so `@2x.png` files show at half their pixel size.

```sh
mkdir -p /tmp/guide-storage && cp -R backend/storage/default /tmp/guide-storage/
docker run -d --name tf-guides -p 3300:3000 -e AUTH_MODE=open --user "$(id -u):$(id -g)" \
  -v /tmp/guide-storage:/app/storage ghcr.io/tracefinity/tracefinity:<version>
cd frontend
pnpm exec playwright install chromium
node --experimental-strip-types scripts/guide-screenshots.ts http://localhost:3300
```

To retake only some shots, add their paths, such as `fix-a-trace/mirror@2x.png`.
