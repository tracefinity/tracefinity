import { test, expect } from '@playwright/test'

test('keeps manual grid sizing when a bin is reopened', async ({ page }) => {
  const response = await page.request.post('/api/bins', {
    data: { name: 'Manual bin' },
  })
  expect(response.ok()).toBeTruthy()
  const bin = await response.json()
  const binPath = `/bins/${bin.id}`
  const gridWidth = page.locator('input[type="number"][step="0.5"]').first()
  const autoSize = page.locator('span').filter({ hasText: /^Auto-size grid/ })
    .locator('..').getByRole('button')

  await page.goto(binPath)
  await expect(gridWidth).toBeDisabled()
  const saved = page.waitForResponse(response =>
    response.url().endsWith(`/api/bins/${bin.id}`) && response.request().method() === 'PUT'
    && response.request().postDataJSON().auto_size === false)
  await autoSize.click()
  await expect(gridWidth).toBeEnabled()
  expect((await saved).ok()).toBeTruthy()
  await page.reload()
  await expect(gridWidth).toBeEnabled()
  await page.goto('/')

  const second = await page.request.post('/api/bins', { data: { name: 'Automatic bin' } })
  expect(second.ok()).toBeTruthy()
  await page.goto(`/bins/${(await second.json()).id}`)
  await expect(gridWidth).toBeDisabled()
  await page.goto(binPath)
  await expect(gridWidth).toBeEnabled()

  const enabled = page.waitForResponse(response =>
    response.url().endsWith(`/api/bins/${bin.id}`) && response.request().method() === 'PUT'
    && response.request().postDataJSON().auto_size === true)
  await autoSize.click()
  expect((await enabled).ok()).toBeTruthy()
  await page.reload()
  await expect(gridWidth).toBeDisabled()
})

test('preserves a saved manual width when reopening a bin with a tool', async ({ page }, testInfo) => {
  const response = await page.request.post('/api/bins', {
    data: { name: 'Manually sized bin' },
  })
  expect(response.ok()).toBeTruthy()
  const bin = await response.json()
  const binPath = `/bins/${bin.id}`
  const apiPath = `/api/bins/${bin.id}`
  const seeded = await page.request.put(apiPath, {
    data: {
      bin_config: bin.bin_config,
      placed_tools: [{
        id: 'rectangle',
        tool_id: 'synthetic',
        name: '80 by 30 mm rectangle',
        points: [{ x: 2, y: 6 }, { x: 82, y: 6 }, { x: 82, y: 36 }, { x: 2, y: 36 }],
      }],
    },
  })
  expect(seeded.ok()).toBeTruthy()
  const gridWidth = page.locator('input[type="number"][step="0.5"]').first()
  const autoSize = page.locator('span').filter({ hasText: /^Auto-size grid/ })
    .locator('..').getByRole('button')
  await page.goto(binPath)
  await expect(gridWidth).toHaveValue('3')
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible()
  await autoSize.click()
  await expect(gridWidth).toBeEnabled()
  await gridWidth.fill('2')
  await gridWidth.press('Enter')
  await expect.poll(async () => (await (await page.request.get(apiPath)).json()).bin_config.grid_x).toBe(2)
  const before = await (await page.request.get(apiPath)).json()
  await page.goto('/')
  await page.goto(binPath)
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible()
  const after = await (await page.request.get(apiPath)).json()
  await testInfo.attach('bin-persistence', {
    body: JSON.stringify({ before, after }, null, 2),
    contentType: 'application/json',
  })
  await expect(gridWidth).toBeEnabled()
  await expect(gridWidth).toHaveValue('2')
  expect(after.auto_size).toBe(false)
  expect(after.bin_config.grid_x).toBe(2)
  expect(after.placed_tools).toEqual(before.placed_tools)
})
