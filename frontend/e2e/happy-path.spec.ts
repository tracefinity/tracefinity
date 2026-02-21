import { test, expect, Page } from '@playwright/test'
import path from 'path'

const FIXTURE_IMAGE = path.join(__dirname, 'fixtures', 'tool.jpg')

test.describe.serial('happy path', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
  })

  test.afterAll(async () => {
    await page.close()
  })

  let sessionId: string

  test('upload image', async () => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(FIXTURE_IMAGE)

    await page.waitForURL(/\/trace\//, { timeout: 15_000 })
    sessionId = page.url().split('/trace/')[1]
    expect(sessionId).toBeTruthy()
  })

  test('confirm corners', async () => {
    const continueBtn = page.getByRole('button', { name: 'Continue' })
    await expect(continueBtn).toBeVisible({ timeout: 10_000 })
    await continueBtn.click()

    // wait for step change to trace — use the heading, not the button
    await expect(page.getByRole('heading', { name: 'Trace Tools' })).toBeVisible({ timeout: 15_000 })
  })

  test('trace tools', async () => {
    const traceBtn = page.getByRole('button', { name: 'Trace Tools' })
    await expect(traceBtn).toBeVisible()
    await traceBtn.click()

    // mock returns instantly, wait for edit step heading
    await expect(page.getByRole('heading', { name: 'Edit Outlines' })).toBeVisible({ timeout: 30_000 })
  })

  test('verify trace results', async () => {
    const polygonPaths = page.locator('svg path[d]')
    await expect(polygonPaths.first()).toBeVisible({ timeout: 5_000 })

    const saveBtn = page.getByRole('button', { name: 'Save to Library' })
    await expect(saveBtn).toBeVisible()
    await expect(saveBtn).toBeEnabled()
  })

  test('save to library', async () => {
    const saveBtn = page.getByRole('button', { name: 'Save to Library' })
    await saveBtn.click()

    await page.waitForURL('/', { timeout: 10_000 })

    // at least one tool card should exist with "hacksaw" label
    await expect(page.getByText('hacksaw').first()).toBeVisible({ timeout: 5_000 })
  })

  let toolId: string

  test('open tool editor', async () => {
    // click the first hacksaw card
    await page.getByText('hacksaw').first().click()

    await page.waitForURL(/\/tools\//, { timeout: 10_000 })
    toolId = page.url().split('/tools/')[1]
    expect(toolId).toBeTruthy()

    const svgPath = page.locator('svg path[d]')
    await expect(svgPath.first()).toBeVisible({ timeout: 5_000 })

    await expect(page.getByText(/\d+ vertices/)).toBeVisible()
  })

  test('toggle smooth', async () => {
    const statusText = page.getByText(/\d+ vertices/)
    const initialText = await statusText.textContent()

    await page.getByRole('button', { name: 'Smooth' }).click()

    // vertex count text should change when smoothed
    await expect(statusText).not.toHaveText(initialText!, { timeout: 5_000 })

    await page.getByRole('button', { name: 'Accurate' }).click()
  })

  test('navigate home', async () => {
    const backBtn = page.locator('button').filter({ has: page.locator('svg.lucide-arrow-left') })
    await backBtn.click()

    await page.waitForURL('/', { timeout: 10_000 })
    await expect(page.getByText('hacksaw').first()).toBeVisible()
  })

  let binId: string

  test('create bin from tool', async () => {
    // find the first tool card's package icon (create bin button)
    const toolCards = page.locator('[class*="cursor-pointer"]').filter({ hasText: 'hacksaw' })
    const packageBtn = toolCards.first().locator('button').filter({ has: page.locator('svg.lucide-package') })
    await packageBtn.click()

    // name modal
    const modal = page.locator('.fixed.inset-0')
    await expect(modal).toBeVisible({ timeout: 5_000 })
    const nameInput = modal.locator('input[type="text"]')
    await nameInput.fill('Test bin')
    await modal.getByRole('button', { name: 'Create' }).click()

    await page.waitForURL(/\/bins\//, { timeout: 15_000 })
    binId = page.url().split('/bins/')[1]
    expect(binId).toBeTruthy()
  })

  test('verify tool in bin', async () => {
    const svgPath = page.locator('svg path[d]')
    await expect(svgPath.first()).toBeVisible({ timeout: 10_000 })
  })

  test('select tool in bin editor', async () => {
    // target the bin editor SVG (inside the main area, not sidebar thumbnails)
    const binEditor = page.locator('.bg-inset.rounded-lg svg')
    const toolPath = binEditor.locator('path[fill-rule="evenodd"]').first()
    await expect(toolPath).toBeVisible({ timeout: 5_000 })

    // dispatch mousedown directly — click() can miss on SVG paths with fill-rule="evenodd"
    await toolPath.dispatchEvent('mousedown', { bubbles: true })

    await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible({ timeout: 5_000 })
  })

  test('add text label', async () => {
    // deselect first
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // click Text tool button in the toolbar
    const textBtn = page.locator('button').filter({ has: page.locator('svg.lucide-type') })
    await textBtn.click()

    // click in the bin editor SVG background to place a label
    const binSvg = page.locator('.bg-inset.rounded-lg svg')
    const box = await binSvg.boundingBox()
    expect(box).toBeTruthy()
    await page.mouse.click(box!.x + box!.width / 3, box!.y + box!.height / 3)

    // text input appears inside a foreignObject in the SVG
    const labelInput = page.locator('foreignObject input[type="text"]')
    await expect(labelInput).toBeVisible({ timeout: 5_000 })
    await labelInput.fill('E2E label')
    await page.keyboard.press('Enter')

    // wait for the <text> element to appear
    await expect(page.locator('svg text').filter({ hasText: 'E2E label' })).toBeVisible({ timeout: 5_000 })
  })

  test('wait for STL generation', async () => {
    // wait for export button to appear (STL generation finishes)
    const exportBtn = page.getByRole('button', { name: /Export STL|Export ZIP/ })
    await expect(exportBtn).toBeVisible({ timeout: 90_000 })
    await expect(exportBtn).toBeEnabled()
  })

  test('check 3D preview', async () => {
    const canvas = page.locator('canvas')
    await expect(canvas).toBeVisible({ timeout: 10_000 })
  })

  test('download STL', async () => {
    // verify the generated STL file is downloadable
    const response = await page.request.get(`http://localhost:8000/api/files/bins/${binId}/bin.stl`)
    expect(response.ok()).toBeTruthy()
  })
})
