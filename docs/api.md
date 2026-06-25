# API Endpoints

## Sessions (trace workflow)
- `POST /api/upload` - upload image, auto-detect corners
- `POST /api/sessions/{id}/corners` - set corners, apply perspective correction
- `POST /api/sessions/{id}/trace` - AI trace tool outlines
- `POST /api/sessions/{id}/trace-mask` - trace from uploaded mask
- `PUT /api/sessions/{id}/polygons` - save polygon edits
- `POST /api/sessions/{id}/save-tools` - convert traced polygons to library tools
- `GET /api/sessions` - list sessions
- `GET /api/sessions/{id}` - get session state
- `PATCH /api/sessions/{id}` - update session metadata
- `DELETE /api/sessions/{id}` - delete session

## Tools (library)
- `GET /api/tools` - list tools
- `GET /api/tools/{id}` - get tool
- `PUT /api/tools/{id}` - update tool (name, points, finger_holes)
- `POST /api/tools/{id}/auto-rotate` - compute optimal rotation angle (degrees) to minimise bounding box
- `DELETE /api/tools/{id}` - delete tool

## Bins
- `GET /api/bins` - list bins
- `GET /api/bins/{id}` - get bin (syncs placed tools with library versions)
- `POST /api/bins` - create bin (optionally with tool_ids for auto-sizing and bin_config defaults)
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
- `POST /api/bin-projects/{id}/create-bin` - create a new bin from selected project tools, using project or request bin defaults
- `GET /api/bin-projects/{id}/health` - report project/tool/bin link mismatches
- `POST /api/bin-projects/{id}/repair` - repair safe project/tool/bin link mismatches

## API Keys and tracer status
- `GET /api-keys` - returns current provider and available tracers

Response fields:
- `google` (bool): true when the server can trace without a user-supplied key (cloud env key, local, or remote).
- `provider` (string|null): one of `gemini` | `local` | `remote`.
- `provider_label` (string|null): human label for the primary tracer, e.g. `Replicate`.
- `tracers` (array): `{id, label}` entries. Remote tracers include `{"id":"replicate","label":"Replicate"}` and `{"id":"fal","label":"fal.ai"}` when the respective tokens are configured.

## File serving
- `GET /api/files/{session_id}/bin.stl` - session STL
- `GET /api/files/{session_id}/bin.3mf` - session 3MF
- `GET /api/files/{session_id}/bin_parts.zip` - session split parts
- `GET /api/files/bins/{bin_id}/bin.stl` - bin STL
- `GET /api/files/bins/{bin_id}/bin.3mf` - bin 3MF
- `GET /api/files/bins/{bin_id}/bin_parts.zip` - bin split parts

## Webhooks

Tracefinity can POST a callback to an external URL when a bin is successfully
generated. This lets external services kick off a session and receive the
result automatically when generation finishes.

### Setting up a webhook

Provide `webhook_url` and optionally `webhook_metadata` as form fields when
uploading an image:

```
POST /api/upload
Content-Type: multipart/form-data

image: <file>
webhook_url: https://your-service.com/callbacks/tracefinity
webhook_metadata: {"job_id": "abc-123"}
```

`webhook_metadata` must be a JSON object (string-encoded). It is echoed back
in the webhook payload unchanged, making it a convenient place for an external
service to store a job ID, customer reference, or routing key.

The webhook can also be set or updated later via the session PATCH endpoint:

```
PATCH /api/sessions/{id}
Content-Type: application/json

{"webhook_url": "https://your-service.com/callbacks/updated"}
```

### Propagation to tools and bins

When tools are saved from a session (`POST /api/sessions/{id}/save-tools`),
the session's webhook config is copied to every library `Tool` that is
created. When those tools are later used to create a bin (via `POST /api/bins`
or `POST /api/bin-projects/{id}/create-bin`), the first tool's webhook is
propagated to the resulting `BinModel`.

This means a webhook set at upload time fires for generation on both paths:

| Generation endpoint | When it fires |
|---|---|
| `POST /api/sessions/{id}/generate` | Immediately, if the session has a webhook URL |
| `POST /api/bins/{id}/generate` | Immediately, if the bin has a webhook URL (inherited from its tools) |

### Payload

The webhook is delivered as a `POST` with `Content-Type: application/json`:

```json
{
  "event": "bin_generated",
  "session_id": "<session-id or null>",
  "bin_id": "<bin-id or null>",
  "webhook_metadata": { ... whatever was provided at upload ... },
  "result": {
    "stl_url": "/storage/default/outputs/<id>.stl",
    "stl_urls": ["/storage/default/outputs/<id>_part0.stl", "..."],
    "threemf_url": "/storage/default/outputs/<id>.3mf",
    "split_count": 3,
    "zip_url": "/storage/default/outputs/<id>_parts.zip",
    "insert_stl_url": "/storage/default/outputs/<id>_insert.stl",
    "warning": null
  }
}
```

- `session_id` — the originating trace session (null if unresolvable).
- `bin_id` — null for session-based generation; the bin ID for bin-based generation.
- `result` — mirrors the `GenerateResponse` returned by the generate endpoint that
  triggered the webhook. File URLs are relative paths under `/storage/{user_id}/`.

### Behaviour

- **Fire-and-forget.** The webhook is dispatched in a background thread. The
  generate response is returned to the caller without waiting for the webhook
  to complete.
- **No retries.** If the POST fails (network error, timeout, non-2xx response),
  the error is logged and discarded. Tracefinity does not retry or queue.
- **Timeout.** 30 seconds.
- **Idempotency.** Calling generate again (e.g. after changing parameters)
  fires the webhook again. There is no deduplication.
- **Backward compatible.** Existing sessions, tools, and bins without webhook
  fields deserialize with `webhook_url = null` and no webhook is fired.
