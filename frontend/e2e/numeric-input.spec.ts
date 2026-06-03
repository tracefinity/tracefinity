import { test, expect, Page } from '@playwright/test'

test.describe('numeric input deferred validation', () => {
  let page: Page
  let binId: string

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()

    // create a bin via API so we have a configurator with numeric inputs
    const resp = await page.request.post('http://localhost:8000/api/bins', {
      data: { name: 'Numeric input test bin' },
    })
    expect(resp.ok()).toBeTruthy()
    const body = await resp.json()
    binId = body.id
  })

  test.afterAll(async () => {
    if (binId) {
      await page.request.delete(`http://localhost:8000/api/bins/${binId}`)
    }
    await page.close()
  })

  test('allows free typing without mid-keystroke clamping', async () => {
    await page.goto(`/bins/${binId}`)
    await page.waitForLoadState('networkidle')

    // use the Cutout Clearance input (min=0, max=5, step=0.1) -- always enabled
    const clearanceInput = page.locator('input[type="number"][min="0"][max="5"][step="0.1"]').first()
    await expect(clearanceInput).toBeVisible({ timeout: 10_000 })

    // clear and type a value that's within range -- should not be clamped mid-keystroke
    await clearanceInput.click()
    await clearanceInput.fill('')
    await clearanceInput.pressSequentially('3', { delay: 50 })

    // while still focused, the displayed value should be exactly what was typed
    await expect(clearanceInput).toHaveValue('3')
  })

  test('clamps value on blur when out of range', async () => {
    await page.goto(`/bins/${binId}`)
    await page.waitForLoadState('networkidle')

    // use the cutout clearance input (min=0, max=5, step=0.1)
    const clearanceInput = page.locator('input[type="number"][min="0"][max="5"][step="0.1"]').first()
    await expect(clearanceInput).toBeVisible({ timeout: 10_000 })

    // type a value above max
    await clearanceInput.click()
    await clearanceInput.fill('')
    await clearanceInput.pressSequentially('99', { delay: 50 })

    // while focused, value is unclamped
    await expect(clearanceInput).toHaveValue('99')

    // blur triggers clamping to max (5)
    await clearanceInput.blur()
    await expect(clearanceInput).toHaveValue('5')
  })

  test('clamps value on Enter when out of range', async () => {
    await page.goto(`/bins/${binId}`)
    await page.waitForLoadState('networkidle')

    const clearanceInput = page.locator('input[type="number"][min="0"][max="5"][step="0.1"]').first()
    await expect(clearanceInput).toBeVisible({ timeout: 10_000 })

    await clearanceInput.click()
    await clearanceInput.fill('')
    await clearanceInput.pressSequentially('99', { delay: 50 })

    // pressing Enter commits and clamps
    await clearanceInput.press('Enter')
    await expect(clearanceInput).toHaveValue('5')
  })

  test('reverts to previous value on empty blur', async () => {
    await page.goto(`/bins/${binId}`)
    await page.waitForLoadState('networkidle')

    // use the Cutout Clearance input (always enabled)
    const clearanceInput = page.locator('input[type="number"][min="0"][max="5"][step="0.1"]').first()
    await expect(clearanceInput).toBeVisible({ timeout: 10_000 })

    const originalValue = await clearanceInput.inputValue()
    expect(originalValue).toBeTruthy()

    // clear the field and blur -- should revert to original
    await clearanceInput.click()
    await clearanceInput.fill('')
    await clearanceInput.blur()

    await expect(clearanceInput).toHaveValue(originalValue)
  })
})
