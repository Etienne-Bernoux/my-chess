import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Géométrie et atteignabilité (R5, R6, R10, R11). Tout ce qui se mesure dans un
 * vrai moteur de rendu — pas ce qui se juge à l'œil.
 */

/** Quel élément reçoit réellement un contact à ce point de l'écran ? */
const targetAt = (page: Page, x: number, y: number): Promise<string> =>
  page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px as number, py as number)
      // On remonte jusqu'à la zone de tap : c'est elle qui porte le gestionnaire.
      return el?.closest('.half, .band, .overlay')?.id ?? el?.tagName ?? 'aucun'
    },
    [x, y],
  )

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  // L'application s'ouvre sur l'accueil ; la géométrie des moitiés ne se mesure
  // qu'une fois cet écran refermé.
  await page.locator('#reset-button').click()
  await expect(page.locator('#overlay')).toBeHidden()
  await expect(page.locator('#half-bottom')).toBeVisible()
})

test('R5 : la moitié adverse est réellement pivotée à 180°', async ({ page }) => {
  const matrices = await page.evaluate(() => ({
    top: getComputedStyle(document.querySelector('#half-top')!).transform,
    bottom: getComputedStyle(document.querySelector('#half-bottom')!).transform,
  }))

  // matrix(-1, 0, 0, -1, 0, 0) est une rotation d'un demi-tour.
  expect(matrices.top).toMatch(/matrix\(-1,\s*0,\s*0,\s*-1/)
  expect(matrices.bottom).toMatch(/none|matrix\(1,\s*0,\s*0,\s*1/)
})

test('R6 : chaque moitié est atteignable jusqu’à ses coins', async ({ page }) => {
  const boxes = await page.evaluate(() =>
    ['half-top', 'half-bottom'].map((id) => {
      const r = document.querySelector(`#${id}`)!.getBoundingClientRect()
      return { id, ...r.toJSON() }
    }),
  )

  for (const box of boxes) {
    const inset = 4
    const corners: ReadonlyArray<readonly [number, number]> = [
      [box.left + inset, box.top + inset],
      [box.right - inset, box.top + inset],
      [box.left + inset, box.bottom - inset],
      [box.right - inset, box.bottom - inset],
      [box.left + box.width / 2, box.top + box.height / 2],
    ]
    for (const [x, y] of corners) {
      expect(await targetAt(page, x, y), `${box.id} en (${x}, ${y})`).toBe(box.id)
    }
  }
})

test('R10 : la bande centrale ne vole aucun tap aux moitiés', async ({ page }) => {
  const band = await page.evaluate(() =>
    document.querySelector('#band')!.getBoundingClientRect().toJSON(),
  )
  const x = band.left + band.width / 2

  // Juste au-dessus et juste en dessous de la bande : la moitié doit gagner.
  expect(await targetAt(page, x, band.top - 2)).toBe('half-top')
  expect(await targetAt(page, x, band.bottom + 2)).toBe('half-bottom')

  // Et sur la bande elle-même, c'est bien elle qui reçoit.
  expect(await targetAt(page, x, band.top + band.height / 2)).toBe('band')
})

test('rien ne déborde du viewport, sur aucun des deux axes', async ({ page }) => {
  // `scrollWidth <= innerWidth` ne prouverait rien : `overflow: hidden` sur
  // `body` le masque. On mesure donc chaque élément visible.
  const overflowing = await page.evaluate(() => {
    const w = window.innerWidth
    const h = window.innerHeight
    return [...document.querySelectorAll('#app *, #app')]
      .map((el) => ({ id: el.id || el.className, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0)
      .filter(({ r }) => r.left < -1 || r.top < -1 || r.right > w + 1 || r.bottom > h + 1)
      .map(({ id, r }) => `${id} (${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)})`)
  })

  expect(overflowing).toEqual([])
})

test('les deux cadrans restent lisibles et non tronqués', async ({ page }) => {
  for (const id of ['clock-top', 'clock-bottom']) {
    const metrics = await page.evaluate((sel) => {
      const el = document.querySelector(`#${sel}`)!
      const r = el.getBoundingClientRect()
      const parent = el.parentElement!.getBoundingClientRect()
      return { w: r.width, h: r.height, fits: r.width <= parent.width && r.height <= parent.height }
    }, id)

    expect(metrics.w, `${id} a une largeur`).toBeGreaterThan(20)
    expect(metrics.fits, `${id} tient dans sa moitié`).toBe(true)
  }
})

test('R11 : le reset demande deux gestes, il n’est pas atteignable d’emblée', async ({ page }) => {
  // Partie en cours : c'est le seul moment où un reset a un sens, et donc le
  // seul cas que R11 protège.
  await page.locator('#half-bottom').tap()
  await expect(page.locator('#reset-button')).toBeHidden()

  // Premier geste : ouvrir l'écran de pause.
  await page.locator('#menu-button').click()
  await expect(page.locator('#overlay')).toBeVisible()

  // Second geste seulement.
  await expect(page.locator('#reset-button')).toBeVisible()
})

test('R31, R32 : le panneau agrandi par la saisie manuelle reste utilisable', async ({ page }) => {
  await page.locator('#menu-button').click()
  await page.locator('#preset-select').selectOption('custom')
  await expect(page.locator('#custom-fields')).toBeVisible()

  // Handicap ouvert : c'est la variante la plus haute du panneau, et le cas où
  // le projet `short-viewport` peut couper le bouton d'ouverture.
  await page.locator('#custom-handicap').check()
  await expect(page.locator('#custom-white')).toBeVisible()
  await expect(page.locator('#custom-time-field')).toBeHidden()

  // Piège de grille : la paire Blancs/Noirs est une grille à deux pistes, et une
  // piste `1fr` gonfle à son min-content au lieu de rester dans son conteneur.
  const overflowing = await page.evaluate(() => {
    const panel = document.querySelector('.panel')!.getBoundingClientRect()
    return [...document.querySelectorAll('#custom-fields *')]
      .map((el) => ({ id: el.id || el.className, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0)
      .filter(({ r }) => r.left < panel.left - 1 || r.right > panel.right + 1)
      .map(({ id }) => id)
  })
  expect(overflowing).toEqual([])

  // Le bouton reste réellement actionnable : Playwright échoue ici si le
  // panneau l'a repoussé hors de portée.
  await page.locator('#custom-white').fill('7')
  await page.locator('#custom-black').fill('4')
  await page.locator('#reset-button').click()
  await expect(page.locator('#overlay')).toBeHidden()

  // Avant le tap, l'orientation n'est pas décidée : l'affichage prend le défaut.
  await expect(page.locator('#clock-bottom')).toHaveText('7:00')
  await expect(page.locator('#clock-top')).toHaveText('4:00')

  // R8 : c'est ce tap qui attribue les deux temps. Taper le haut en fait la
  // moitié des Blancs, et les deux temps s'échangent. Seul le camp à l'arrêt
  // s'asserte à la valeur exacte — l'autre court pour de bon.
  await page.locator('#half-top').tap()
  await expect(page.locator('#clock-bottom')).toHaveText('4:00')
  await expect(page.locator('#clock-top')).toHaveText(/^(7:00|6:5\d)$/)
})

test('avant toute partie, l’accueil ne propose ni reprise ni geste destructeur', async ({ page }) => {
  await page.locator('#menu-button').click()
  await expect(page.locator('#overlay')).toBeVisible()
  await expect(page.locator('#preset-select')).toBeEnabled()
  // Rien à reprendre, et rien à détruire : le bouton d'action ouvre une partie
  // au lieu d'en remettre une à zéro.
  await expect(page.locator('#resume-button')).toBeHidden()
  await expect(page.locator('#reset-button')).toHaveText('Commencer')
})
