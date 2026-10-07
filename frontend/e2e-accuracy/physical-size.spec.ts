import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

async function downloadPocket(page: Page, testInfo: TestInfo, name: string, clearance = 1) {
  const exportButton = page.getByRole('button', { name: 'Export', exact: true })
  await expect(exportButton).toBeVisible({ timeout: 90_000 })
  await exportButton.click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'STL', exact: true }).click()
  const downloadedPath = testInfo.outputPath(`${name}.stl`)
  await (await downloading).saveAs(downloadedPath)

  const backend = path.resolve(__dirname, '../../backend')
  const measurement = JSON.parse(execFileSync(path.join(backend, 'venv/bin/python'), [
    '-m', 'tests.measure_pocket', downloadedPath, String(clearance),
  ], { cwd: backend, encoding: 'utf8' }))
  await testInfo.attach(`${name}-measurement`, {
    body: JSON.stringify(measurement, null, 2), contentType: 'application/json',
  })
  return measurement
}

function clearanceInput(page: Page) {
  return page.locator('input[type="range"][min="0"][max="5"][step="0.1"]')
    .locator('..').locator('input[type="number"]')
}

async function createScannedBin(page: Page, { accurate = true } = {}) {
  const fixture = await page.request.get('http://127.0.0.1:8011/__accuracy/photo.jpg')
  expect(fixture.ok()).toBeTruthy()
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles({
    name: '80-by-30-mm-rectangle.jpg',
    mimeType: 'image/jpeg',
    buffer: await fixture.body(),
  })
  await page.waitForURL(/\/trace\//)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Select Tools', exact: true })).toBeVisible()
  await page.locator('.space-y-3 .text-xs.space-y-0\\.5 > div').first().click()
  await page.getByRole('button', { name: 'Save 1 tool', exact: true }).click()
  await page.waitForURL('/')

  const card = page.locator('[class*="cursor-pointer"]').filter({ hasText: 'tool 1' }).first()
  await card.locator('button').filter({ has: page.locator('svg.lucide-package') }).click()
  const modal = page.locator('.fixed.inset-0')
  await modal.locator('input[type="text"]').fill('Physical accuracy fixture')
  await modal.getByRole('button', { name: 'Create', exact: true }).click()
  await page.waitForURL(/\/bins\//)
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible({ timeout: 90_000 })
  if (accurate) {
    // Sharp fixture corners require Accurate output; Smooth deliberately rounds them.
    await page.getByTestId('bin-canvas').locator('path[fill-rule="evenodd"]').first().click()
    const generated = page.waitForResponse(response =>
      response.url().endsWith('/generate') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Accurate', exact: true }).click()
    await generated
  }
}

test('Accurate output preserves known photo dimensions and sharp corners', async ({ page }, testInfo) => {
  await createScannedBin(page)
  const measurement = await downloadPocket(page, testInfo, 'accurate-pocket')
  expect(Math.abs(measurement.dimensions_mm[0] - 32)).toBeLessThan(1)
  expect(Math.abs(measurement.dimensions_mm[1] - 82)).toBeLessThan(1)
  expect(measurement.boundary_error_mm).toBeLessThan(1)
})

test('default Smooth output fits the known physical tool without excessive enlargement', async ({ page }, testInfo) => {
  await createScannedBin(page, { accurate: false })
  const binId = page.url().split('/bins/')[1]
  const bin = await (await page.request.get(`/api/bins/${binId}`)).json()
  const tool = await (await page.request.get(`/api/tools/${bin.placed_tools[0].tool_id}`)).json()
  expect(tool.smoothed).toBe(true)
  const measurement = await downloadPocket(page, testInfo, 'smooth-pocket')
  expect(Math.abs(measurement.dimensions_mm[0] - 32)).toBeLessThan(1)
  expect(Math.abs(measurement.dimensions_mm[1] - 82)).toBeLessThan(1)
  expect(measurement.contains_physical_tool).toBe(true)
  expect(measurement.minimum_clearance_mm).toBeGreaterThan(0)
})

test('auto-size preserves the cavity inside the stacking lip after reducing clearance', async ({ page }, testInfo) => {
  await createScannedBin(page)
  const binId = page.url().split('/bins/')[1]
  const clearance = clearanceInput(page)
  const generated = page.waitForResponse(response =>
    response.url().endsWith(`/api/bins/${binId}/generate`) && response.request().method() === 'POST')
  await clearance.fill('0.1')
  await clearance.press('Enter')
  await generated
  const measurement = await downloadPocket(page, testInfo, 'auto-sized-pocket', 0.1)
  expect(Math.abs(measurement.dimensions_mm[0] - 30.2)).toBeLessThan(1)
  expect(Math.abs(measurement.dimensions_mm[1] - 80.2)).toBeLessThan(1)
  expect(measurement.boundary_error_mm).toBeLessThan(1)
  const bin = await (await page.request.get(`/api/bins/${binId}`)).json()
  expect(bin.bin_config.grid_x).toBe(3)
})

test('export uses current clearance after a slow settings save', async ({ page }, testInfo) => {
  await createScannedBin(page)
  const binId = page.url().split('/bins/')[1]
  const exportButton = page.getByRole('button', { name: 'Export', exact: true })
  await expect(exportButton).toBeVisible({ timeout: 90_000 })
  // Keep grid size fixed so this tests save ordering independently of auto-fit.
  await page.locator('span').filter({ hasText: /^Auto-size grid/ })
    .locator('..').getByRole('button').click()
  const clearance = clearanceInput(page)
  await expect(clearance).toHaveValue('1')

  let releaseSave!: () => void
  let observeSave!: () => void
  const heldSave = new Promise<void>(resolve => { releaseSave = resolve })
  const saveStarted = new Promise<void>(resolve => { observeSave = resolve })
  await page.route(`**/api/bins/${binId}`, async route => {
    if (route.request().method() === 'PUT') {
      observeSave()
      await heldSave
    }
    await route.continue()
  })
  const generated = page.waitForResponse(response =>
    response.url().endsWith(`/api/bins/${binId}/generate`) && response.request().method() === 'POST')
  await clearance.fill('0.1')
  await clearance.press('Enter')
  await saveStarted
  // Cross the one-second generation debounce with the save still in flight.
  await page.waitForTimeout(2000)
  releaseSave()
  await generated
  await expect.poll(async () => {
    const response = await page.request.get(`/api/bins/${binId}`)
    return (await response.json()).bin_config.cutout_clearance
  }).toBe(0.1)
  const measurement = await downloadPocket(page, testInfo, 'updated-clearance', 0.1)
  expect(Math.abs(measurement.dimensions_mm[0] - 30.2)).toBeLessThan(1)
  expect(Math.abs(measurement.dimensions_mm[1] - 80.2)).toBeLessThan(1)
  expect(measurement.boundary_error_mm).toBeLessThan(1)
})

test('Detail preserves a manual size correction through saved STL export', async ({ page }, testInfo) => {
  await createScannedBin(page)
  const binId = page.url().split('/bins/')[1]
  const bin = await (await page.request.get(`/api/bins/${binId}`)).json()
  const toolId = bin.placed_tools[0].tool_id
  // A single protruding vertex makes the manual correction unambiguous:
  // moving its x from 40 to 32 shortens the outline from 80 to 72 mm.
  const points = [[-40, -15], [32, -15], [40, 0], [32, 15], [-40, 15]]
    .map(([x, y]) => ({ x, y }))
  const width = (outline: { x: number }[]) => Math.max(...outline.map(p => p.x)) - Math.min(...outline.map(p => p.x))
  expect((await page.request.put(`/api/tools/${toolId}`, { data: { points, smoothed: false } })).ok()).toBeTruthy()
  await page.goto(`/tools/${toolId}`)
  const vertex = page.locator('svg circle.cursor-move').nth(2)
  await expect(vertex).toBeVisible()
  const target = await vertex.evaluate(element => {
    const circle = element as SVGCircleElement
    const svg = circle.ownerSVGElement!
    const matrix = svg.getScreenCTM()!
    const start = svg.createSVGPoint()
    start.x = circle.cx.baseVal.value
    start.y = circle.cy.baseVal.value
    const end = svg.createSVGPoint()
    end.x = 32 * 8
    end.y = 0
    const from = start.matrixTransform(matrix), to = end.matrixTransform(matrix)
    return { from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } }
  })
  // Loading the editor can also trigger a save. Wait for the corrected
  // outline, rather than accepting an earlier save of the original points.
  const saved = page.waitForResponse(response =>
    response.url().endsWith(`/api/tools/${toolId}`)
    && response.request().method() === 'PUT'
    && width(response.request().postDataJSON().points) === 72)
  await page.mouse.move(target.from.x, target.from.y)
  await page.mouse.down()
  await page.mouse.move(target.to.x, target.to.y, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByText('5 vertices, 0 cutouts · 72.0×30.0 mm', { exact: true })).toBeVisible()
  expect((await saved).ok()).toBeTruthy()
  const corrected = await (await page.request.get(`/api/tools/${toolId}`)).json()
  expect(width(corrected.points)).toBeCloseTo(72, 2)

  const detailSaved = page.waitForResponse(response =>
    response.url().endsWith(`/api/tools/${toolId}`)
    && response.request().method() === 'PUT'
    && response.request().postDataJSON().points.length < corrected.points.length)
  const detail = page.locator('input[type="range"][min="0"][max="1"][step="0.01"]')
  await detail.fill('0.5')
  await detail.dispatchEvent('pointerup')
  expect((await detailSaved).ok()).toBeTruthy()
  expect((await page.request.put(`/api/bins/${binId}`, {
    data: { bin_config: { ...bin.bin_config, cutout_clearance: .1, cutout_chamfer: 0 } },
  })).ok()).toBeTruthy()
  await page.goto(`/bins/${binId}`)
  // This manual edit makes a 72 x 30 mm fixture; compare its measured dimensions.
  const measurement = await downloadPocket(page, testInfo, 'manually-corrected-tool', 0.1)
  expect(measurement.dimensions_mm[0]).toBeCloseTo(30.2, 1)
  expect(measurement.dimensions_mm[1]).toBeCloseTo(72.2, 1)
})
