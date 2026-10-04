#!/usr/bin/env node
/**
 * Renders the PWA/app icons from public/pilefile-icon.svg using Playwright's Chromium.
 *
 *   npm run icons
 *
 * - icon-192.png, icon-512.png: the SVG as-is (rounded corners, transparent outside).
 * - icon-512-maskable.png: full-bleed background with the artwork scaled into the safe zone.
 * - apple-touch-icon.png: 180px, full-bleed (iOS applies its own corner mask).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'public/pilefile-icon.svg'), 'utf8').replace(/<metadata>[\s\S]*?<\/metadata>/, '')

/** Square the background (no rounded corners) and optionally shrink the artwork toward the centre. */
function fullBleed(scale) {
  const squared = svg.replace(/<rect width="512" height="512" rx="\d+"/, '<rect width="512" height="512" rx="0"')
  if (scale === 1) return squared
  const marker = squared.indexOf('<!-- bottom message -->')
  const t = (512 - 512 * scale) / 2
  return `${squared.slice(0, marker)}<g transform="translate(${t} ${t}) scale(${scale})">${squared.slice(marker).replace('</svg>', '')}</g></svg>`
}

const outputs = [
  ['icon-192.png', 192, svg],
  ['icon-512.png', 512, svg],
  ['icon-512-maskable.png', 512, fullBleed(0.8)],
  ['apple-touch-icon.png', 180, fullBleed(1)],
]

const browser = await (async () => {
  try {
    return await chromium.launch({ channel: 'chrome' })
  } catch {
    return chromium.launch()
  }
})()
for (const [name, size, markup] of outputs) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(
    `<!doctype html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${markup.replace('<svg ', '<svg style="display:block;width:100%;height:100%" ')}</div></body>`,
  )
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
  writeFileSync(join(root, 'public/icons', name), png)
  await page.close()
  console.log(`wrote public/icons/${name} (${png.length} bytes)`)
}
await browser.close()
