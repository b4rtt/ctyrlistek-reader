/**
 * End-to-end smoke test: launches the built Electron app in mock-AI mode with a
 * throw-away data folder, imports the sample comic, walks through the review
 * and plays the comic with system voices. Screenshots land in ./screenshots.
 *
 *   npm run test:e2e
 */
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dataDir = join(root, '.e2e-data')
const shots = join(root, 'screenshots')
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
mkdirSync(shots, { recursive: true })
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ voiceMode: 'system', pace: 0.8 }))

const errors = []
const app = await electron.launch({
  args: [root],
  env: {
    ...process.env,
    CTYRLISTEK_DATA_DIR: dataDir,
    CTYRLISTEK_MOCK_AI: '1',
    // Treat the (single) test screen as a TV so the AirPlay flow can run.
    CTYRLISTEK_TV_TEST: '1',
    OPENAI_API_KEY: '',
    ELEVENLABS_API_KEY: '',
  },
})
const step = async (name, fn) => {
  const t0 = Date.now()
  await fn()
  console.log(`✓ ${name} (${Date.now() - t0} ms)`)
}

try {
  const win = await app.firstWindow()
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.setViewportSize({ width: 1400, height: 900 })

  await step('library renders', async () => {
    await win.getByText('Nahrát komiks v PDF').waitFor()
    await win.screenshot({ path: join(shots, '1-library.png') })
  })

  await step('import + mock analysis', async () => {
    await win.setInputFiles('input[type=file]', join(root, 'test/fixtures/sample-comic.pdf'))
    await win
      .getByText('AI čte stránky')
      .or(win.getByText('Načítám stránky'))
      .first()
      .waitFor({ timeout: 20000 })
    await win.waitForTimeout(700)
    await win.screenshot({ path: join(shots, '2-processing.png') })
    await win.getByText('Postavy a hlasy').waitFor({ timeout: 60000 })
  })

  await step('review screen', async () => {
    await win
      .getByText('Rozzlobený soused')
      .or(win.locator('input[value="Rozzlobený soused"]'))
      .first()
      .waitFor({ timeout: 10000 })
    await win.waitForTimeout(500)
    await win.screenshot({ path: join(shots, '3-review.png') })
    // Resolve the uncertain character: set gender.
    const card = win.locator('.char-card.needs').first()
    await card.getByRole('button', { name: '👨 Muž' }).click()
    await win.waitForTimeout(300)
    await win.screenshot({ path: join(shots, '4-review-resolved.png') })
  })

  await step('pages editor', async () => {
    await win.getByRole('button', { name: /Stránky a texty/ }).click()
    await win.locator('.editor .box.panel').first().waitFor()
    await win.waitForTimeout(400)
    await win.screenshot({ path: join(shots, '5-editor.png') })
  })

  await step('prepare voices + play', async () => {
    await win.getByRole('button', { name: /Přehrát komiks/ }).click()
    await win.locator('.start-btn').waitFor({ timeout: 90000 })
    await win.screenshot({ path: join(shots, '6-player-start.png') })
    await win.locator('.start-btn').click()
    await win.waitForTimeout(4200)
    await win.screenshot({ path: join(shots, '7-player-panel.png') })
    await win.locator('.subtitle:not(.off)').waitFor({ timeout: 15000 })
    await win.waitForTimeout(600)
    await win.screenshot({ path: join(shots, '8-player-line.png') })
  })

  await step('navigation', async () => {
    await win.keyboard.press('ArrowDown')
    await win.waitForTimeout(1800)
    await win.screenshot({ path: join(shots, '9-player-page2.png') })
    await win.keyboard.press('Space')
    await win.waitForTimeout(300)
    const paused = await win.locator('.round.main').getAttribute('title')
    if (!paused) throw new Error('transport missing')
  })

  await step('play on TV (remote control)', async () => {
    await win.getByTitle('Přehrát na televizi (AirPlay)').click()
    const tvWindow = app.waitForEvent('window')
    await win.locator('.tv-choice').first().click()
    const tv = await tvWindow
    tv.on('pageerror', (e) => errors.push('[tv] ' + String(e)))
    tv.on('console', (m) => m.type() === 'error' && errors.push('[tv] ' + m.text()))
    await win.getByText('Ukončit přehrávání na televizi').waitFor({ timeout: 15000 })
    // The TV plays on its own and reports its state to the remote.
    await win.locator('.remote-now .small', { hasText: 'Strana' }).waitFor({ timeout: 20000 })
    await tv.locator('.subtitle:not(.off)').waitFor({ timeout: 20000 })
    await tv.screenshot({ path: join(shots, '10-tv.png') })
    await win.screenshot({ path: join(shots, '11-remote.png') })
    // Remote commands reach the TV.
    await win.locator('.remote-transport .round.main').click()
    await tv.waitForTimeout(600)
    const playing = await win.locator('.remote-transport .round.main').getAttribute('title')
    if (!playing) throw new Error('remote transport missing')
    await win.getByRole('button', { name: /Pokračovat na počítači/ }).click()
    await win.locator('.start-btn').waitFor({ timeout: 15000 })
    await tv.waitForEvent('close', { timeout: 5000 }).catch(() => undefined)
    if (app.windows().length !== 1) throw new Error('TV window did not close')
  })
} finally {
  await app.close()
}

const relevant = errors.filter((e) => !/Autofill|DevTools|Electron Security Warning/.test(e))
if (relevant.length) {
  console.error('Console errors:\n' + relevant.join('\n'))
  process.exit(1)
}
console.log('E2E passed – screenshots in ./screenshots')
