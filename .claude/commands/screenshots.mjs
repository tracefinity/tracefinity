#!/usr/bin/env node
// takes screenshots of the running tracefinity app for docs/readme
// usage: node .claude/commands/screenshots.mjs [--light] [--base-url=http://localhost:4001]

import { chromium } from 'playwright'
import { mkdirSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..', '..')
const outDir = join(root, 'docs', 'screenshots')

const args = process.argv.slice(2)
const light = args.includes('--light')
const baseArg = args.find(a => a.startsWith('--base-url='))
const baseUrl = baseArg ? baseArg.split('=')[1] : 'http://localhost:4001'
const apiUrl = baseUrl.replace(':4001', ':8000')
const theme = light ? 'light' : 'dark'

mkdirSync(outDir, { recursive: true })

async function api(path, opts) {
  const r = await fetch(`${apiUrl}${path}`, opts)
  if (!r.ok) throw new Error(`${r.status} ${path}`)
  return r.json()
}

async function ensureData() {
  // get tools
  const toolsRes = await api('/api/tools')
  const tools = Array.isArray(toolsRes) ? toolsRes : toolsRes.tools || []
  if (tools.length === 0) {
    console.log('  no tools in library, bin screenshot will be skipped')
    return { toolId: null, binId: null }
  }
  const toolId = tools[0].id

  // find or create a bin with tools placed
  const binsRes = await api('/api/bins')
  const bins = Array.isArray(binsRes) ? binsRes : binsRes.bins || []
  const existing = bins.find(b => b.tool_count > 0)

  if (existing) {
    return { toolId, binId: existing.id }
  }

  // no bin with tools -- create one with the first tool
  console.log(`  creating bin with "${tools[0].name}"...`)
  const bin = await api('/api/bins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: tools[0].name, tool_ids: [toolId] }),
  })
  const binId = bin.id

  // wait for auto-generation to kick in
  await new Promise(r => setTimeout(r, 2000))

  return { toolId, binId }
}

async function run() {
  let toolId = null
  let binId = null

  try {
    const data = await ensureData()
    toolId = data.toolId
    binId = data.binId
  } catch (e) {
    console.log('could not reach API:', e.message)
  }

  // headed mode required for WebGL (3D preview)
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: light ? 'light' : 'dark',
  })

  const page = await context.newPage()

  await page.addInitScript((t) => {
    localStorage.setItem('theme', t)
  }, theme)

  // dashboard
  console.log('capturing docs/screenshots/dashboard.png')
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(outDir, 'dashboard.png') })

  // tool editor
  if (toolId) {
    console.log('capturing docs/screenshots/tool-editor.png')
    await page.goto(`${baseUrl}/tools/${toolId}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)
    await page.screenshot({ path: join(outDir, 'tool-editor.png') })
  } else {
    console.log('  no tools found, skipping tool-editor.png')
  }

  // bin editor
  if (binId) {
    console.log('capturing docs/screenshots/bin-editor.png')
    await page.goto(`${baseUrl}/bins/${binId}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(6000) // wait for STL generation + 3D render
    await page.screenshot({ path: join(outDir, 'bin-editor.png') })
  } else {
    console.log('  no tools available, skipping bin-editor.png')
  }

  await browser.close()

  const files = readdirSync(outDir).filter(f => f.endsWith('.png')).sort()
  console.log('\ndone:')
  for (const f of files) {
    const size = statSync(join(outDir, f)).size
    console.log(`  docs/screenshots/${f} (${(size / 1024).toFixed(0)}kb)`)
  }
}

run().catch(e => { console.error(e); process.exit(1) })
