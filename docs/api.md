# API Endpoints

## Sessions (trace workflow)
- `POST /api/upload` - upload image and detect corners; optional `station_id` reuses saved station corners, and optional `capture_crop` crops the image before detection/tracing
- `POST /api/sessions/{id}/corners` - set corners, apply perspective correction; optional `save_station_name` saves the confirmed station in the same step
- `POST /api/sessions/{id}/redetect-corners` - rerun default paper corner detection on the original upload
- `GET /api/sessions/{id}/station-suggestions` - list saved photo stations that match the upload dimensions closely enough to reuse
- `POST /api/sessions/{id}/reuse-corners` - prefill session corners from a saved photo station
- `POST /api/sessions/{id}/trace` - AI trace tool outlines
- `POST /api/sessions/{id}/trace-mask` - trace from uploaded mask
- `PUT /api/sessions/{id}/polygons` - save polygon edits
- `POST /api/sessions/{id}/save-tools` - convert traced polygons to library tools
- `GET /api/sessions` - list sessions
- `GET /api/sessions/{id}` - get session state
- `PATCH /api/sessions/{id}` - update session metadata
- `DELETE /api/sessions/{id}` - delete session

## Photo stations
- `GET /api/photo-stations` - list saved camera/paper stations
- `GET /api/photo-stations/{id}` - get one saved station
- `POST /api/photo-stations` - save confirmed session corners as a station
- `PATCH /api/photo-stations/{id}` - rename a station or update saved paper corners
- `DELETE /api/photo-stations/{id}` - delete a station

## Tools (library)
- `GET /api/tools` - list tools
- `GET /api/tools/{id}` - get tool
- `PUT /api/tools/{id}` - update tool (name, points, finger_holes)
- `POST /api/tools/{id}/auto-rotate` - compute optimal rotation angle (degrees) to minimise bounding box
- `DELETE /api/tools/{id}` - delete tool

## Bins
- `GET /api/bins` - list bins
- `GET /api/bins/{id}` - get bin (syncs placed tools with library versions)
- `POST /api/bins` - create bin (optionally with tool_ids for auto-sizing)
- `PUT /api/bins/{id}` - update bin
- `DELETE /api/bins/{id}` - delete bin + output files
- `POST /api/bins/{id}/generate` - generate STL/3MF from bin

## Bin projects
- `GET /api/bin-projects` - list project summaries with tool/bin/placement counts
- `POST /api/bin-projects` - create a project, optionally seeded with tool ids
- `GET /api/bin-projects/{id}` - get project detail with derived placed/unplaced tool ids
- `PATCH /api/bin-projects/{id}` - update project metadata and status
- `DELETE /api/bin-projects/{id}` - delete project metadata; tools and bins are retained
- `POST /api/bin-projects/{id}/tools` - add tools to a project
- `DELETE /api/bin-projects/{id}/tools/{tool_id}` - remove a tool from a project
- `POST /api/bin-projects/{id}/bins` - link existing bins to a project
- `DELETE /api/bin-projects/{id}/bins/{bin_id}` - detach a bin from a project
- `POST /api/bin-projects/{id}/create-bin` - create a new bin from selected project tools
- `GET /api/bin-projects/{id}/health` - report project/tool/bin link mismatches
- `POST /api/bin-projects/{id}/repair` - repair safe project/tool/bin link mismatches

## File serving
- `GET /api/files/{session_id}/bin.stl` - session STL
- `GET /api/files/{session_id}/bin.3mf` - session 3MF
- `GET /api/files/{session_id}/bin_parts.zip` - session split parts
- `GET /api/files/bins/{bin_id}/bin.stl` - bin STL
- `GET /api/files/bins/{bin_id}/bin.3mf` - bin 3MF
- `GET /api/files/bins/{bin_id}/bin_parts.zip` - bin split parts
