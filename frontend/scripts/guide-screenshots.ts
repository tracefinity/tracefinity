// captures the app screenshots in docs/guides/images from a running
// tracefinity, so they can be retaken whenever the app changes. see
// docs/guides/README.md. from frontend/:
//
//   node --experimental-strip-types scripts/guide-screenshots.ts http://localhost:3300 [file ...]
//
// tracefinity must run with AUTH_MODE=open over a copy of the demo library in
// backend/storage/default. the script makes its own bins, projects and photo
// uploads, named "Guide: ...", and replaces them on every run.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Locator, type Page } from '@playwright/test'

const OUT_DIR = fileURLToPath(new URL('../../docs/guides/images/', import.meta.url))
const PREFIX = 'Guide: '
// device pixels per css pixel: every capture is @2x
const SCALE = 2

// tools in the demo library, by id: several share a name
const TOOLS = {
  spanner: '6634dd4c-495c-432b-96a5-da9b264474ff',
  speedSquare: 'a86a2d54-59fa-4e19-b44b-8b8afed0adbf',
  lockingPliers: '73c04ed4-9ac5-48b9-aeff-8f30c834bdb1',
  hexKeys: 'fac06242-6301-450e-9a62-e3ebf32e1147',
  pipeCutter: 'c308c17d-fcee-4aaf-b186-677230ea04ac',
  // shaped like a screwdriver, though the library calls it Scraper
  scraper: 'f4933cb2-d6fe-46c1-9a12-3f62404e291c',
  hacksaw: '1d1b5c37-2947-42ca-9e34-4c138b4c6702',
  pipeWrench: '096fcc1d-db2e-4361-ad10-d5b3205fca2b',
}

// trace sessions in the demo library
const SESSIONS = {
  // locking pliers on A4, still at the corners step, its corners on the sheet
  pliersCorners: 'c67757fb-c36d-4c7f-9fba-cab2f1a341a8',
  // a pipe wrench whose handle runs past the bottom of the sheet, traced
  pipeWrenchOverhang: '35f5cff9-44a9-41f1-b342-7cffaf55e0fa',
  // a traced upload of the e2e photo, e2e/fixtures/tool.jpg: a hacksaw on A4
  // on a brown board
  hacksawPhoto: '03a0f141-0dea-4d0e-b518-a59250f57d85',
}

type BinConfig = Record<string, unknown>

interface Point {
  x: number
  y: number
}

interface PlacedTool {
  points: Point[]
  finger_holes: Point[]
  interior_rings: Point[][]
  rotation: number
}

interface Bin {
  bin_config: BinConfig
  placed_tools: PlacedTool[]
}

interface Shot {
  // written to docs/guides/images/<file>; @2x files are captured at twice the
  // size they are shown at
  file: string
  // css pixels, for a shot that needs a window other than 1280 x 1000
  viewport?: { width: number; height: number }
  capture: (page: Page) => Promise<Buffer>
}

let baseUrl = ''

async function api<T>(method: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${await response.text()}`)
  return (response.status === 204 ? undefined : await response.json()) as T
}

// the demo library's tools and sessions, and the photos and masks they show.
// without them a run fails part way through or captures shots with no photo
async function missingFixtures(): Promise<string[]> {
  const fixtures = [
    ...Object.entries(TOOLS).map(([key, id]) => ({
      name: `TOOLS.${key} ${id}`,
      route: `/api/tools/${id}`,
      files: ['source_image_path'],
    })),
    ...Object.entries(SESSIONS).map(([key, id]) => ({
      name: `SESSIONS.${key} ${id}`,
      route: `/api/sessions/${id}`,
      files: ['original_image_path', 'corrected_image_path', 'mask_image_path'],
    })),
  ]
  const missing: string[] = []
  for (const { name, route, files } of fixtures) {
    const response = await fetch(`${baseUrl}${route}`)
    if (response.status === 404) {
      missing.push(name)
      continue
    }
    if (!response.ok) throw new Error(`GET ${route}: ${response.status} ${await response.text()}`)
    const record = (await response.json()) as Record<string, unknown>
    for (const field of files) {
      const file = record[field]
      if (typeof file !== 'string') continue
      const stored = await fetch(`${baseUrl}/storage/${file.replace(/^storage\//, '')}`, { method: 'HEAD' })
      if (!stored.ok) missing.push(`${name}: ${field} ${file}`)
    }
  }
  return missing
}

// a fresh bin with known contents and settings, replacing the last run's
async function guideBin(name: string, toolIds: string[], config: BinConfig = {}): Promise<string> {
  const { bins } = await api<{ bins: { id: string; name: string | null }[] }>('GET', '/api/bins')
  for (const bin of bins.filter((b) => b.name === PREFIX + name)) {
    await api('DELETE', `/api/bins/${bin.id}`)
  }
  const bin = await api<{ id: string }>('POST', '/api/bins', {
    name: PREFIX + name,
    tool_ids: toolIds,
    bin_config: config,
  })
  return bin.id
}

// fixes a bin's grid with auto-size off, turning each tool about its centre and
// centring the outlines in the new grid. the server applies `rotation` to the
// library outline, about the placed centre, whenever the bin loads.
async function fixGrid(id: string, gridX: number, gridY: number, rotation = 0): Promise<void> {
  const bin = await api<Bin>('GET', `/api/bins/${id}`)
  const turn = (rotation * Math.PI) / 180
  const turned = bin.placed_tools.flatMap((tool) => {
    const cx = tool.points.reduce((sum, p) => sum + p.x, 0) / tool.points.length
    const cy = tool.points.reduce((sum, p) => sum + p.y, 0) / tool.points.length
    return tool.points.map((p) => ({
      x: cx + (p.x - cx) * Math.cos(turn) - (p.y - cy) * Math.sin(turn),
      y: cy + (p.x - cx) * Math.sin(turn) + (p.y - cy) * Math.cos(turn),
    }))
  })
  const xs = turned.map((p) => p.x)
  const ys = turned.map((p) => p.y)
  const dx = (gridX * 42) / 2 - (Math.min(...xs) + Math.max(...xs)) / 2
  const dy = (gridY * 42) / 2 - (Math.min(...ys) + Math.max(...ys)) / 2
  const move = <T extends Point>(p: T): T => ({ ...p, x: p.x + dx, y: p.y + dy })
  const placed = bin.placed_tools.map((tool) => ({
    ...tool,
    rotation: tool.rotation + rotation,
    points: tool.points.map(move),
    finger_holes: tool.finger_holes.map(move),
    interior_rings: tool.interior_rings.map((ring) => ring.map(move)),
  }))
  await api('PUT', `/api/bins/${id}`, {
    auto_size: false,
    bin_config: {
      ...bin.bin_config,
      grid_x: gridX,
      grid_y: gridY,
      partial_bins_values: Array(Math.ceil(gridX) * Math.ceil(gridY)).fill(true),
    },
    placed_tools: placed,
  })
}

// a fresh upload of a demo session's photo, replacing the last run's; it starts
// at the corners step with the corners found again
async function guideUpload(name: string, photoSession: string): Promise<string> {
  const { sessions } = await api<{ sessions: { id: string; name: string | null }[] }>('GET', '/api/sessions')
  for (const old of sessions.filter((s) => s.name === PREFIX + name)) {
    await api('DELETE', `/api/sessions/${old.id}`)
  }
  const source = await api<{ original_image_path: string }>('GET', `/api/sessions/${photoSession}`)
  const photo = await fetch(`${baseUrl}/storage/${source.original_image_path}`)
  if (!photo.ok) throw new Error(`photo of ${photoSession}: ${photo.status}`)
  const form = new FormData()
  form.append('image', new Blob([await photo.arrayBuffer()], { type: 'image/jpeg' }), 'photo.jpg')
  const upload = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: form })
  if (!upload.ok) throw new Error(`upload: ${upload.status} ${await upload.text()}`)
  const { session_id: id } = (await upload.json()) as { session_id: string }
  await api('PATCH', `/api/sessions/${id}`, { name: PREFIX + name })
  return id
}

// shows the page only the first tracer, so whatever TRACERS holds, Continue
// traces straight away and the steps are Corners and Save
async function oneTracer(page: Page): Promise<void> {
  await page.route(`${baseUrl}/api/api-keys`, async (route) => {
    const response = await route.fetch()
    const keys = (await response.json()) as { tracers: unknown[] }
    await route.fulfill({ response, json: { ...keys, tracers: keys.tracers.slice(0, 1) } })
  })
}

// a fresh project with known tools, replacing the last run's along with its bins
async function guideProject(name: string, toolIds: string[]): Promise<string> {
  const { projects } = await api<{ projects: { id: string; name: string }[] }>('GET', '/api/bin-projects')
  for (const old of projects.filter((p) => p.name === PREFIX + name)) {
    const { bin_ids } = await api<{ bin_ids: string[] }>('GET', `/api/bin-projects/${old.id}`)
    for (const binId of bin_ids) await api('DELETE', `/api/bins/${binId}`)
    await api('DELETE', `/api/bin-projects/${old.id}`)
  }
  const project = await api<{ id: string }>('POST', '/api/bin-projects', {
    name: PREFIX + name,
    tool_ids: toolIds,
  })
  return project.id
}

// edits in the tool editor autosave; keep them out of the library so every run
// starts from the same outlines
async function openTool(page: Page, id: string): Promise<void> {
  await page.route(`${baseUrl}/api/tools/${id}`, (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ json: { status: 'ok' } }) : route.continue(),
  )
  await page.goto(`${baseUrl}/tools/${id}`, { waitUntil: 'networkidle' })
  await page.getByTitle('Auto-rotate to minimise bounding box').waitFor()
}

// waits for the 3D preview's model as well as the page
async function openBin(page: Page, id: string): Promise<void> {
  const generated = page.waitForResponse(
    (response) => /\/api\/bins\/[^/]+\/generate/.test(response.url()) && response.ok(),
    { timeout: 180_000 },
  )
  await page.goto(`${baseUrl}/bins/${id}`, { waitUntil: 'networkidle' })
  await generated
  await page.waitForTimeout(1500)
}

// a labelled row in the bin settings sidebar: the label's own text, not its help tip
function settingRow(page: Page, label: string): Locator {
  return page.locator(`xpath=//span[normalize-space(text()[1])="${label}"]/..`).first()
}

// everything under the app's 44px top bar
function belowTopBar(page: Page): Promise<Buffer> {
  const { width, height } = page.viewportSize()!
  return page.screenshot({ clip: { x: 0, y: 44, width, height: height - 44 } })
}

// whether a polygon, grown by `margin`, reaches an axis-aligned square
function reaches(polygon: Point[], x0: number, y0: number, size: number, margin: number): boolean {
  const x1 = x0 + size
  const y1 = y0 + size
  const toSquare = (p: Point) => Math.hypot(Math.max(x0 - p.x, 0, p.x - x1), Math.max(y0 - p.y, 0, p.y - y1))
  const toSegment = (p: Point, a: Point, b: Point) => {
    const length = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length))
    return Math.hypot(p.x - a.x - t * (b.x - a.x), p.y - a.y - t * (b.y - a.y))
  }
  // liang-barsky: does any part of the segment lie inside the square
  const crosses = (a: Point, b: Point) => {
    let low = 0
    let high = 1
    const dx = b.x - a.x
    const dy = b.y - a.y
    for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]]) {
      if (p === 0) {
        if (q < 0) return false
      } else if (p < 0) {
        low = Math.max(low, q / p)
      } else {
        high = Math.min(high, q / p)
      }
    }
    return low <= high
  }
  const corners = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ]
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    if (crosses(a, b) || toSquare(a) <= margin || corners.some((corner) => toSegment(corner, a, b) <= margin)) {
      return true
    }
  }
  // no edge comes near, so the square is either wholly inside or wholly outside
  const centre = { x: x0 + size / 2, y: y0 + size / 2 }
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (a.y > centre.y !== b.y > centre.y && centre.x < ((b.x - a.x) * (centre.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

// a project with one bin per tool, the pliers bin 6u high, and an 11 x 8.5 unit
// drawer plan laid out by auto arrange, then a second spanner placed with D and
// left selected
async function drawerPlan(page: Page): Promise<void> {
  // 2 x 4, 3 x 6, 3 x 7 and 3 x 7 units, which leaves room for a second spanner
  const bins: [string, string, BinConfig | null][] = [
    ['Spanner', TOOLS.spanner, null],
    ['Hacksaw', TOOLS.hacksaw, null],
    ['Hex keys', TOOLS.hexKeys, null],
    ['Locking pliers', TOOLS.lockingPliers, { height_units: 6 }],
  ]
  const projectId = await guideProject(
    'Top drawer',
    bins.map(([, toolId]) => toolId),
  )
  for (const [name, toolId, config] of bins) {
    await api('POST', `/api/bin-projects/${projectId}/create-bin`, { name, tool_ids: [toolId], bin_config: config })
  }
  const plan = await api<{ id: string }>('POST', `/api/bin-projects/${projectId}/sketches`, {
    target_grid_x: 11,
    target_grid_y: 8.5,
  })
  await page.goto(`${baseUrl}/projects/${projectId}/sketch/${plan.id}`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Auto arrange' }).click()
  await page
    .getByTestId('drawer-sketch-canvas')
    .locator('g', { has: page.locator('title', { hasText: /^Spanner ·/ }) })
    .click()
  await page.keyboard.press('d')
  await page.getByTitle('2 placed in the drawer').waitFor()
  const warnings = await page.getByText(/overlapping|outside drawer|did not fit/).count()
  if (warnings > 0) throw new Error('drawer plan: a bin does not fit')
  // the plan saves after 400 ms
  await page.waitForTimeout(1000)
}

function outline(locator: Locator): Promise<void> {
  return locator.evaluate((element) => {
    const style = (element as HTMLElement).style
    style.outline = '2px solid #3b9ece'
    style.outlineOffset = '3px'
    style.borderRadius = '6px'
  })
}

// sidebar rows carry 8px of space above and below; padding them vertically
// would pick up the end of an indented group's line from the row above
const ROWS = { x: 2, y: 0 }

// the area around some elements, padded and kept inside the viewport
async function crop(page: Page, locators: Locator[], pad: number | { x: number; y: number } = 12): Promise<Buffer> {
  const { x: padX, y: padY } = typeof pad === 'number' ? { x: pad, y: pad } : pad
  // the last element into view, then the first, so a sidebar shows both
  await locators[locators.length - 1].scrollIntoViewIfNeeded()
  await locators[0].scrollIntoViewIfNeeded()
  const boxes = await Promise.all(locators.map((locator) => locator.boundingBox()))
  if (boxes.some((box) => box === null)) throw new Error('crop: an element is not visible')
  const viewport = page.viewportSize()!
  const x = Math.max(0, Math.min(...boxes.map((b) => b!.x)) - padX)
  const y = Math.max(0, Math.min(...boxes.map((b) => b!.y)) - padY)
  const right = Math.min(viewport.width, Math.max(...boxes.map((b) => b!.x + b!.width)) + padX)
  const bottom = Math.min(viewport.height, Math.max(...boxes.map((b) => b!.y + b!.height)) + padY)
  return page.screenshot({ clip: { x, y, width: right - x, height: bottom - y } })
}

// an area centred on an element, kept inside the panel it sits in
async function cropAround(page: Page, locator: Locator, within: Locator, width: number, height: number): Promise<Buffer> {
  const box = await locator.boundingBox()
  const panel = await within.boundingBox()
  if (!box || !panel) throw new Error('cropAround: an element is not visible')
  const w = Math.min(width, panel.width)
  const h = Math.min(height, panel.height)
  const x = Math.min(Math.max(panel.x, box.x + box.width / 2 - w / 2), panel.x + panel.width - w)
  const y = Math.min(Math.max(panel.y, box.y + box.height / 2 - h / 2), panel.y + panel.height - h)
  return page.screenshot({ clip: { x, y, width: w, height: h } })
}

// zooms the tool editor's canvas with the mouse wheel, 1.15 times a notch
// about the pointer
async function wheelZoom(page: Page, notches: number, at: Point): Promise<void> {
  await page.mouse.move(at.x, at.y)
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(0, -100)
    await page.waitForTimeout(50)
  }
}

// the centre of an element on screen
async function centre(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('centre: the element is not visible')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function waitUntil(condition: () => boolean, timeout = 600_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

// drags from one point to another, in steps the app sees as a drag
async function drag(page: Page, from: Point, to: Point, button: 'left' | 'middle' = 'left'): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down({ button })
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up({ button })
}

// a floating panel cut out to its own edges, rounded as it is so whatever is
// behind it does not show in its corners
interface Panel {
  png: Buffer
  radius: number
}

async function panel(page: Page, locator: Locator): Promise<Panel> {
  const radius = await locator.evaluate((element) => parseFloat(getComputedStyle(element).borderTopLeftRadius))
  const box = await locator.boundingBox()
  if (!box) throw new Error('panel: the element is not visible')
  // inward to whole device pixels, so no part-covered pixel at an edge shows the background
  const x = Math.ceil(box.x * SCALE) / SCALE
  const y = Math.ceil(box.y * SCALE) / SCALE
  const right = Math.floor((box.x + box.width) * SCALE) / SCALE
  const bottom = Math.floor((box.y + box.height) * SCALE) / SCALE
  return { png: await page.screenshot({ clip: { x, y, width: right - x, height: bottom - y } }), radius }
}

// several crops in a row on the app's background, for settings that sit far
// apart; an array in the row is a column of crops, top to bottom
async function sideBySide(page: Page, parts: (Buffer | Panel | (Buffer | Panel)[])[]): Promise<Buffer> {
  const sheet = await page.context().newPage()
  const image = (part: Buffer | Panel) => {
    const { png, radius } = Buffer.isBuffer(part) ? { png: part, radius: 0 } : part
    const width = png.readUInt32BE(16) / SCALE
    return `<img src="data:image/png;base64,${png.toString('base64')}" style="width:${width}px;border-radius:${radius}px">`
  }
  const columns = parts
    .map((part) =>
      Array.isArray(part)
        ? `<div style="display:flex;flex-direction:column;gap:24px">${part.map(image).join('')}</div>`
        : image(part),
    )
    .join('')
  await sheet.setContent(
    `<body style="margin:0;background:#0f1115"><div id="sheet" style="display:inline-flex;align-items:flex-start;gap:24px;padding:12px">${columns}</div></body>`,
  )
  const shot = await sheet.locator('#sheet').screenshot()
  await sheet.close()
  return shot
}

const shots: Shot[] = [
  {
    file: 'tall-or-thick-objects/size-fields@2x.png',
    async capture(page) {
      await openTool(page, TOOLS.speedSquare)
      const size = page.locator('xpath=//span[normalize-space(.)="Size"]/..').first()
      await outline(size)
      return crop(page, [page.getByTitle('Auto-rotate to minimise bounding box'), size], 6)
    },
  },
  {
    file: 'tall-or-thick-objects/deep-pocket-settings@2x.png',
    async capture(page) {
      const id = await guideBin('Deep pocket', [TOOLS.pipeCutter], {
        height_units: 6,
        cutout_depth: 30,
        stacking_lip: true,
        rim_units: 2,
      })
      await openBin(page, id)
      return sideBySide(page, [
        await crop(page, [settingRow(page, 'Height'), settingRow(page, 'Cutout Depth')], ROWS),
        await crop(page, [settingRow(page, 'Stacking lip'), settingRow(page, 'Raise Lip')], ROWS),
      ])
    },
  },
  {
    file: 'stack-over-tall-tools/raise-lip-settings@2x.png',
    async capture(page) {
      const id = await guideBin('Raise lip', [TOOLS.lockingPliers], {
        height_units: 4,
        cutout_depth: 20,
        stacking_lip: true,
        rim_units: 2,
      })
      await openBin(page, id)
      const dimensions = page.getByRole('heading', { name: 'Dimensions' })
      return sideBySide(page, [
        await crop(page, [settingRow(page, 'Height'), settingRow(page, 'Cutout Depth')], ROWS),
        [
          await crop(page, [settingRow(page, 'Stacking lip'), settingRow(page, 'Raise Lip')], ROWS),
          await crop(page, [dimensions, dimensions.locator('xpath=following-sibling::div')], 2),
        ],
      ])
    },
  },
  {
    file: 'bigger-than-your-bed/split-export-menu@2x.png',
    async capture(page) {
      const id = await guideBin('Split', [TOOLS.pipeCutter], { height_units: 3, bed_size: 256 })
      // a 7 x 2 bin is longer than the bed; the tool turns to run along it
      await fixGrid(id, 7, 2, 90)
      await openBin(page, id)
      await page.getByText('Split into 2 pieces').waitFor()
      // bring the bed size note down to the export button
      await page.getByText(/exceeds bed/).evaluate((note) => note.scrollIntoView({ block: 'end' }))
      const exportButton = page.getByRole('button', { name: 'Export', exact: true })
      const area = [settingRow(page, 'Bed Size'), exportButton]
      // the open menu covers the split banner, so the shot shows it before and after
      const closed = await crop(page, area, 2)
      await exportButton.click()
      await page.getByRole('button', { name: 'ZIP (2 parts)' }).waitFor()
      await page.mouse.move(640, 0)
      return sideBySide(page, [closed, await crop(page, area, 2)])
    },
  },
  {
    file: 'plan-a-drawer/drawer-plan-2d@2x.png',
    // the narrowest window that keeps the view buttons on one line
    viewport: { width: 860, height: 760 },
    async capture(page) {
      await drawerPlan(page)
      // this page sits in the padded layout and runs 32px past the window
      return page.locator('main > div').first().screenshot()
    },
  },
  {
    file: 'plan-a-drawer/drawer-plan-3d@2x.png',
    // wide rather than tall, so the drawer fills the 3d view
    viewport: { width: 860, height: 560 },
    async capture(page) {
      await drawerPlan(page)
      // a click on an empty cell clears the selection
      const drawer = page.getByTestId('drawer-sketch-canvas').locator('svg > rect').first()
      const box = (await drawer.boundingBox())!
      await page.mouse.click(box.x + box.width * 0.05, box.y + box.height * 0.95)
      const bins = new Set<string>()
      page.on('response', (response) => {
        const generated = /\/api\/bins\/([^/]+)\/generate/.exec(response.url())
        if (generated && response.ok()) bins.add(generated[1])
      })
      await page.getByRole('button', { name: '3D', exact: true }).click()
      await waitUntil(() => bins.size === 4)
      await page.getByText(/Generating \d+ model/).waitFor({ state: 'detached' })
      // the models load once generated
      await page.waitForLoadState('networkidle')
      // home turns the camera to the default angle, fit frames the whole drawer from it
      await page.getByTitle('Home', { exact: true }).click()
      await page.getByTitle('Fit', { exact: true }).click()
      await page.mouse.move(0, 300)
      await page.waitForTimeout(2000)
      return page.locator('main > div > div').nth(1).screenshot()
    },
  },
  {
    file: 'laser-cutting-and-cnc/export-svg@2x.png',
    // narrow enough that the toolbar wraps into a block that reads at full size
    viewport: { width: 1000, height: 700 },
    async capture(page) {
      // the hacksaw has holes, so Fill in shows, and its output is Accurate
      await openTool(page, TOOLS.hacksaw)
      const title = page.getByRole('link', { name: 'Export SVG' }).locator('..')
      const toolbar = page
        .getByTitle('Fill in interior holes')
        .locator("xpath=ancestor::div[contains(@class, 'glass-toolbar')][1]")
      return sideBySide(page, [[await panel(page, title), await panel(page, toolbar)]])
    },
  },
  {
    file: 'take-a-photo-that-traces-well/corner-zoom@2x.png',
    viewport: { width: 820, height: 600 },
    async capture(page) {
      await page.goto(`${baseUrl}/trace/${SESSIONS.pliersCorners}`, { waitUntil: 'networkidle' })
      const canvas = page
        .getByRole('button', { name: 'Fit', exact: true })
        .locator("xpath=ancestor::div[contains(@class, 'overflow-hidden')][1]")
      // + zooms 1.15 times about the middle, twelve times to about 535%, close
      // enough that neither the photo's edge nor the pliers come into frame.
      // scrolling zooms about the point opposite the pointer, so it would lose
      // the corner.
      for (let i = 0; i < 12; i++) await page.getByRole('button', { name: '+', exact: true }).click()
      await page.getByText('535%').waitFor()
      // then drag the photo until the sheet's top left handle sits in the middle
      const handles = page.locator('circle[fill="#27272a"]')
      const topLeft = async () =>
        (await Promise.all((await handles.all()).map(centre))).reduce((a, b) => (b.x + b.y < a.x + a.y ? b : a))
      const middle = await centre(canvas)
      // the corner comes in from the top left, so a drag that starts below and
      // right of the middle grabs the photo, never the handle
      const start = { x: middle.x + 60, y: middle.y + 60 }
      for (let i = 0; i < 3; i++) {
        const corner = await topLeft()
        const step = { x: (middle.x - corner.x) / (3 - i), y: (middle.y - corner.y) / (3 - i) }
        await drag(page, start, { x: start.x + step.x, y: start.y + step.y })
      }
      await page.mouse.move(0, 300)
      return canvas.screenshot()
    },
  },
  {
    file: 'shiny-or-dark-tools/fill-in@2x.png',
    async capture(page) {
      // the pliers' outline has one hole, near the pivot
      await openTool(page, TOOLS.lockingPliers)
      const fillIn = page.getByTitle('Fill in interior holes')
      await fillIn.click()
      // in fill-in mode each hole gets a hit area that turns green under the pointer
      const hole = page.locator('svg path.cursor-pointer').first()
      const spot = await centre(hole)
      await wheelZoom(page, 10, spot)
      await page.getByText('405%').waitFor()
      // the hole grew under a still pointer; nudge it so the hover registers
      await page.mouse.move(spot.x + 1, spot.y)
      await page.mouse.move(spot.x, spot.y)
      const editor = page.locator('main > div').first()
      return sideBySide(page, [
        [await crop(page, [fillIn.locator('..')], 2), await cropAround(page, hole, editor, 440, 260)],
      ])
    },
  },
  {
    file: 'tools-longer-than-the-sheet/overhang-trace@2x.png',
    // short enough that the tall photo fits the guide's column
    viewport: { width: 1280, height: 800 },
    async capture(page) {
      // keep any edit out of the session
      await page.route(`${baseUrl}/api/sessions/${SESSIONS.pipeWrenchOverhang}/polygons`, (route) =>
        route.fulfill({ json: { status: 'ok' } }),
      )
      await page.goto(`${baseUrl}/trace/${SESSIONS.pipeWrenchOverhang}`, { waitUntil: 'networkidle' })
      // ticking the tool in the list selects its outline; clicking the outline
      // would also open its points for editing
      await page.getByText('pipe wrench', { exact: true }).click()
      await page.getByText('1 of 1 selected').waitFor()
      await page.mouse.move(0, 300)
      const photo = page.getByRole('img', { name: 'Corrected' })
      return photo.locator("xpath=ancestor::div[contains(@class, 'rounded-lg')][1]").screenshot()
    },
  },
  {
    file: 'snug-fit/test-print-settings@2x.png',
    async capture(page) {
      const id = await guideBin('Snug fit test', [TOOLS.spanner], {
        height_units: 2,
        cutout_depth: 5,
        cutout_clearance: 1,
        cutout_chamfer: 1,
      })
      await openBin(page, id)
      return sideBySide(page, [await crop(page, [settingRow(page, 'Height'), settingRow(page, 'Cutout Chamfer')], ROWS)])
    },
  },
  {
    file: 'finger-holes/cutout-menu@2x.png',
    async capture(page) {
      await openTool(page, TOOLS.scraper)
      await page.getByRole('button', { name: 'Cutout' }).click()
      const menu = page.locator('div.min-w-\\[210px\\]')
      await menu.waitFor()
      // off the menu, so no row shows its hover colour
      await page.mouse.move(0, 300)
      // the menu drops over the toolbar's second row, so it is shown under the
      // buttons rather than in place
      const modes = page.getByTitle('Select and drag vertices / cutouts').locator('..')
      return sideBySide(page, [[await crop(page, [modes], 2), await panel(page, menu)]])
    },
  },
  {
    file: 'finger-holes/cutout-depth@2x.png',
    async capture(page) {
      // bins take their cutouts from the library tool; the spanner has two finger holes
      const id = await guideBin('Finger hole depth', [TOOLS.spanner], { cutout_depth: 10 })
      await openBin(page, id)
      const hole = page.getByTestId('bin-canvas').locator('circle.cursor-default').first()
      await hole.click()
      const depth = page.getByTitle(/Set deeper than the tool/).locator('input')
      await depth.fill('15')
      await depth.press('Enter')
      await page.getByTitle('Reset to default').waitFor()
      await page.mouse.move(0, 300)
      const toolbar = page
        .getByTitle('Place text label')
        .locator("xpath=ancestor::div[contains(@class, 'glass-toolbar')][1]")
      const { width } = (await toolbar.boundingBox())!
      return sideBySide(page, [
        [await crop(page, [toolbar], 4), await cropAround(page, hole, page.getByTestId('bin-editor'), width + 8, 220)],
      ])
    },
  },
  {
    file: 'contrast-insert/insert-settings@2x.png',
    async capture(page) {
      const id = await guideBin('Contrast insert', [TOOLS.spanner], {
        insert_enabled: true,
        insert_height: 1,
        insert_clearance: 0.2,
      })
      await openBin(page, id)
      return sideBySide(page, [
        await crop(page, [settingRow(page, 'Contrast Insert'), settingRow(page, 'Insert Fit')], ROWS),
      ])
    },
  },
  {
    file: 'label-a-bin/label-toolbar@2x.png',
    // the label toolbar is wider than the canvas below about 1600px, which clips its ends
    viewport: { width: 1600, height: 1000 },
    async capture(page) {
      const id = await guideBin('Label', [TOOLS.hexKeys])
      // one more unit of depth, with the tool moved down into it, leaves a free
      // 42 mm band along the top; auto-size off keeps it, and the label goes in
      // the middle of the band, just under the toolbar
      const bin = await api<Bin>('GET', `/api/bins/${id}`)
      const gridX = bin.bin_config.grid_x as number
      const gridY = (bin.bin_config.grid_y as number) + 1
      const down = <T extends Point>(p: T): T => ({ ...p, y: p.y + 42 })
      await api('PUT', `/api/bins/${id}`, {
        auto_size: false,
        bin_config: {
          ...bin.bin_config,
          grid_y: gridY,
          partial_bins_values: Array(Math.ceil(gridX) * Math.ceil(gridY)).fill(true),
        },
        placed_tools: bin.placed_tools.map((tool) => ({
          ...tool,
          points: tool.points.map(down),
          finger_holes: tool.finger_holes.map(down),
          interior_rings: tool.interior_rings.map((ring) => ring.map(down)),
        })),
        text_labels: [
          {
            id: 'tl-guide',
            text: 'HEX KEYS',
            x: (gridX * 42) / 2,
            y: 21,
            font_size: 6,
            rotation: 0,
            emboss: true,
            depth: 0.6,
          },
        ],
      })
      await openBin(page, id)
      const label = page.getByTestId('bin-canvas').locator('text', { hasText: 'HEX KEYS' })
      // the text lets clicks through to the hit area under it
      const spot = await centre(label)
      await page.mouse.click(spot.x, spot.y)
      await page.getByPlaceholder('Label text').waitFor()
      await page.mouse.move(0, 300)
      const toolbar = (await page
        .getByTitle('Place text label')
        .locator("xpath=ancestor::div[contains(@class, 'glass-toolbar')][1]")
        .boundingBox())!
      const text = (await label.boundingBox())!
      const canvas = (await page.getByTestId('bin-editor').boundingBox())!
      // the toolbar and the label, with room under the label for the top of the
      // pocket, inside the canvas
      const x = Math.max(canvas.x, toolbar.x - 12)
      const y = Math.max(canvas.y, toolbar.y - 12)
      const right = Math.min(canvas.x + canvas.width, toolbar.x + toolbar.width + 12)
      const bottom = Math.min(canvas.y + canvas.height, text.y + text.height + 100)
      return page.screenshot({ clip: { x, y, width: right - x, height: bottom - y } })
    },
  },
  {
    file: 'partial-bins/speed-square-cells@2x.png',
    async capture(page) {
      const id = await guideBin('Partial bins', [TOOLS.speedSquare])
      // switch off each cell the outline does not reach, grown by 1 mm of
      // clearance and 4 mm to spare. cells run along rows from the top left.
      const bin = await api<Bin>('GET', `/api/bins/${id}`)
      const gridX = bin.bin_config.grid_x as number
      const gridY = bin.bin_config.grid_y as number
      const cells = Array.from({ length: gridX * gridY }, (_, i) =>
        bin.placed_tools.some((tool) => reaches(tool.points, (i % gridX) * 42, Math.floor(i / gridX) * 42, 42, 5)),
      )
      await api('PUT', `/api/bins/${id}`, {
        bin_config: { ...bin.bin_config, partial_bins: true, partial_bins_values: cells },
      })
      await openBin(page, id)
      const matrix = settingRow(page, 'Partial Bins').locator('xpath=following-sibling::div[1]/div[1]')
      await matrix.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      return sideBySide(page, [
        await crop(page, [settingRow(page, 'Partial Bins'), matrix], 2),
        await crop(page, [page.getByTestId('bin-canvas')], 0),
      ])
    },
  },
  {
    file: 'first-bin-from-a-photo/corners-and-paper-size@2x.png',
    // the whole corners step, at a width that reads at full size
    viewport: { width: 800, height: 580 },
    async capture(page) {
      const id = await guideUpload('Corners', SESSIONS.hacksawPhoto)
      await oneTracer(page)
      await page.goto(`${baseUrl}/trace/${id}`, { waitUntil: 'networkidle' })
      await page.getByText('Paper Size', { exact: true }).waitFor()
      return belowTopBar(page)
    },
  },
  {
    file: 'first-bin-from-a-photo/export-menu@2x.png',
    // the whole bin page, at a width that reads at near full size
    viewport: { width: 860, height: 640 },
    async capture(page) {
      const id = await guideBin('Spanner', [TOOLS.spanner])
      await openBin(page, id)
      // the preview loads its model once generated
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(2000)
      // the library strip starts on unnamed demo tools; scroll it to named ones
      await page
        .locator('button', { hasText: 'hex keys' })
        .first()
        .evaluate((card) => card.scrollIntoView({ inline: 'start', block: 'nearest' }))
      await page.getByRole('button', { name: 'Export', exact: true }).click()
      await page.getByRole('button', { name: 'STL', exact: true }).waitFor()
      await page.mouse.move(430, 0)
      return belowTopBar(page)
    },
  },
  {
    file: 'trace-a-set-in-one-photo/name-the-tools@2x.png',
    async capture(page) {
      const id = await guideUpload('Trace', SESSIONS.hacksawPhoto)
      await oneTracer(page)
      await page.goto(`${baseUrl}/trace/${id}`, { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: 'Continue', exact: true }).click()
      await page.getByRole('heading', { name: 'Select Tools' }).waitFor({ timeout: 300_000 })
      await page.getByText('tool 1', { exact: true }).click()
      const hint = page.getByText(/selected\. Click to add or remove/)
      await hint.waitFor()
      await page.getByRole('button', { name: 'Edit tool 1' }).click()
      await page.keyboard.type('hacksaw')
      const name = page.getByRole('textbox', { name: 'Tool name hacksaw' })
      await name.waitFor()
      await page.mouse.move(640, 0)
      const save = page.getByRole('button', { name: 'Save 1 tool' })
      return sideBySide(page, [await crop(page, [hint, name.locator('..')], 6), await crop(page, [save], 6)])
    },
  },
  {
    file: 'fix-a-trace/mirror@2x.png',
    // tall enough that the mirror handle, 12% down the canvas, clears the toolbar
    viewport: { width: 1100, height: 1200 },
    async capture(page) {
      await openTool(page, TOOLS.scraper)
      const rotated = page.waitForResponse((response) => response.url().endsWith('/auto-rotate') && response.ok())
      await page.getByTitle('Auto-rotate to minimise bounding box').click()
      await rotated
      await page.getByTitle('Rotate 90 clockwise').click()
      await page.getByTitle(/^Symmetric editing/).click()
      const handle = page.locator('svg circle.cursor-ew-resize')
      await handle.waitFor()
      // the toolbar sits right of centre; a middle-button drag on the photo,
      // clear of the outline, moves the tool and photo under it, so the photo
      // fills the width below the toolbar
      const axis = await centre(handle)
      const start = { x: axis.x - 250, y: axis.y + 450 }
      await drag(page, start, { x: start.x + 110, y: start.y }, 'middle')
      await page.mouse.move(0, 600)
      // the toolbar, and the top of the tool under it: the handle end, the
      // dashed axis and its round handle, with the photo behind
      const toolbar = (await page
        .getByTitle(/^Symmetric editing/)
        .locator("xpath=ancestor::div[contains(@class, 'glass-toolbar')][1]")
        .boundingBox())!
      const knob = (await handle.boundingBox())!
      const x = toolbar.x - 12
      const y = toolbar.y - 12
      return page.screenshot({
        clip: { x, y, width: toolbar.width + 24, height: knob.y + knob.height + 360 - y },
      })
    },
  },
  {
    file: 'tools-longer-than-the-sheet/long-bin-sidebar@2x.png',
    async capture(page) {
      // 38 x 339 mm, so auto-size makes it 2 x 9 units
      const id = await guideBin('Pipe wrench', [TOOLS.pipeWrench])
      await openBin(page, id)
      return sideBySide(page, [
        await crop(page, [settingRow(page, 'Auto-size grid'), settingRow(page, 'Grid Depth')], ROWS),
        await crop(page, [settingRow(page, 'Bed Size'), page.getByText(/exceeds bed/)], 2),
      ])
    },
  },
]

async function main(): Promise<void> {
  const [url, ...only] = process.argv.slice(2)
  if (!url) throw new Error('usage: guide-screenshots.ts <tracefinity url> [file ...]')
  baseUrl = url.replace(/\/$/, '')

  const unknown = only.filter((file) => !shots.some((shot) => shot.file === file))
  if (unknown.length > 0) throw new Error(`no such shot: ${unknown.join(', ')}`)
  const selected = only.length > 0 ? shots.filter((shot) => only.includes(shot.file)) : shots

  const missing = await missingFixtures()
  if (missing.length > 0) {
    console.error(`missing from the library at ${baseUrl}:\n${missing.map((entry) => `  ${entry}`).join('\n')}`)
    process.exitCode = 1
    return
  }

  let browser: Browser | undefined
  try {
    // software webgl, so the 3d views render headless
    browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
    for (const shot of selected) {
      const context = await browser.newContext({
        viewport: shot.viewport ?? { width: 1280, height: 1000 },
        deviceScaleFactor: SCALE,
        colorScheme: 'dark',
      })
      await context.addInitScript(() => localStorage.setItem('theme', 'dark'))
      const page = await context.newPage()
      const png = await shot.capture(page)
      const out = path.join(OUT_DIR, shot.file)
      fs.mkdirSync(path.dirname(out), { recursive: true })
      fs.writeFileSync(out, png)
      console.log(`wrote ${path.relative(process.cwd(), out)}`)
      await context.close()
    }
  } finally {
    await browser?.close()
  }
}

await main()
