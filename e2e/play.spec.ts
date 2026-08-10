import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Le parcours de jeu dans un vrai moteur, au doigt (`tap`, pas `click`) : ce que
 * jsdom ne peut pas montrer — que le geste atteint la cible, que la couleur
 * change vraiment, que le temps affiché décroît.
 */

const clock = (page: Page, half: 'top' | 'bottom') => page.locator(`#clock-${half}`)

const background = (page: Page, half: 'top' | 'bottom'): Promise<string> =>
  page.evaluate(
    (sel) => getComputedStyle(document.querySelector(`#half-${sel}`)!).backgroundColor,
    half,
  )

/** Tape une moitié au doigt, en son centre. */
async function tapHalf(page: Page, half: 'top' | 'bottom'): Promise<void> {
  await page.locator(`#half-${half}`).tap()
}

/**
 * Relève l'état de confirmation à chaque frame pendant `durationMs`. Rendre la
 * promesse sans l'attendre permet de lancer le relevé AVANT le geste : c'est ce
 * qui rend l'observation déterministe plutôt que dépendante d'un sondage
 * chanceux sur une fenêtre de ~220 ms.
 */
function sampleFlash(page: Page, half: 'top' | 'bottom', durationMs: number): Promise<boolean[]> {
  return page.evaluate(
    ([sel, ms]) =>
      new Promise<boolean[]>((resolve) => {
        const el = document.querySelector(`#half-${sel as string}`)!
        const out: boolean[] = []
        const started = performance.now()
        const step = (): void => {
          out.push(el.classList.contains('is-confirming'))
          if (performance.now() - started < (ms as number)) requestAnimationFrame(step)
          else resolve(out)
        }
        requestAnimationFrame(step)
      }),
    [half, durationMs],
  )
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  // L'accueil s'ouvre à chaque lancement : « Commencer » le referme sur une
  // pendule à l'arrêt — c'est le tap des Noirs, ensuite, qui la lance (R8).
  await page.locator('#reset-button').click()
  await expect(page.locator('#overlay')).toBeHidden()
  await expect(clock(page, 'bottom')).toHaveText('3:00')
})

test('R8 : le premier tap lance l’adversaire et le contraste bascule', async ({ page }) => {
  const avant = await background(page, 'bottom')

  // R36 : tant que le tap n'a pas décidé de l'orientation, aucun camp n'est écrit.
  await expect(page.locator('#side-bottom')).toBeHidden()
  await expect(page.locator('#side-top')).toBeHidden()

  await tapHalf(page, 'bottom')

  // R36 : le camp est écrit sur chaque moitié, et suit ce que le tap a décidé.
  await expect(page.locator('#side-bottom')).toHaveText('Blancs')
  await expect(page.locator('#side-top')).toHaveText('Noirs')

  // La moitié tapée devient celle des Blancs et part : son fond change.
  await expect
    .poll(() => background(page, 'bottom'), { timeout: 2_000 })
    .not.toBe(avant)

  // Et le temps décroît réellement, sans qu'aucun compteur ne le décrémente.
  await expect.poll(() => clock(page, 'bottom').textContent(), { timeout: 3_000 }).not.toBe('3:00')
  await expect(clock(page, 'top')).toHaveText('3:00')
})

test('R7 et R9 : seul le joueur au trait rend la main', async ({ page }) => {
  await tapHalf(page, 'bottom') // démarrage, le bas part
  await page.waitForTimeout(400)

  await tapHalf(page, 'bottom') // le joueur au trait rend la main
  await page.waitForTimeout(400)

  const hautApres = await clock(page, 'top').textContent()
  await expect.poll(() => clock(page, 'top').textContent(), { timeout: 2_000 }).not.toBe(hautApres)

  // Le bas n'est plus au trait : son tap n'a aucun effet, son temps est figé.
  const basFige = await clock(page, 'bottom').textContent()
  await tapHalf(page, 'bottom')
  await page.waitForTimeout(600)
  expect(await clock(page, 'bottom').textContent()).toBe(basFige)
})

test('R12 : la confirmation visuelle se déclenche puis retombe', async ({ page }) => {
  await tapHalf(page, 'bottom')
  await page.waitForTimeout(400)

  // Échantillonner frame par frame plutôt que lire une fois : le flash dure
  // ~220 ms, et une lecture juste après le geste tomberait AVANT le re-render
  // (le piège que CLAUDE.md nomme). Le sondeur démarre avant le tap.
  const samples = sampleFlash(page, 'bottom', 800)
  await tapHalf(page, 'bottom')
  const seen = await samples

  expect(seen.some(Boolean), 'la confirmation a bien été rendue').toBe(true)
  expect(seen.at(-1), 'et elle est retombée toute seule').toBe(false)
})

test('R12 : la confirmation va au cédant, jamais à l’adversaire', async ({ page }) => {
  await tapHalf(page, 'bottom')
  await page.waitForTimeout(400)

  const surLAdversaire = sampleFlash(page, 'top', 800)
  await tapHalf(page, 'bottom')

  expect((await surLAdversaire).some(Boolean)).toBe(false)
})

test('R21 : l’affichage repart juste après un vrai rechargement', async ({ page }) => {
  await tapHalf(page, 'bottom')
  await page.waitForTimeout(1_200)
  const avantRechargement = await clock(page, 'bottom').textContent()

  await page.reload()

  // R26 : la partie non close est proposée à la reprise.
  await expect(page.locator('#overlay')).toBeVisible()
  await expect(page.locator('#overlay-title')).toContainText(/en cours/i)

  await page.locator('#resume-button').click()
  await expect(page.locator('#overlay')).toBeHidden()

  // Le temps de l'absence a été consommé : on n'est jamais revenu en arrière.
  const apres = await clock(page, 'bottom').textContent()
  expect(apres).not.toBe('3:00')
  expect(apres! <= avantRechargement!).toBe(true)
})

test('la pendule survit à une mise en arrière-plan', async ({ page, context }) => {
  await tapHalf(page, 'bottom')
  await page.waitForTimeout(400)

  // Une autre page prend le premier plan : la nôtre passe en caché et la boucle
  // de redessin s'arrête. L'état, lui, ne doit pas dériver.
  const autre = await context.newPage()
  await autre.goto('about:blank')
  await page.waitForTimeout(1_500)
  await autre.close()
  await page.bringToFront()

  // Au retour, l'affichage repart et reflète le temps réellement écoulé.
  await expect.poll(() => clock(page, 'bottom').textContent(), { timeout: 3_000 }).not.toBe('3:00')
  await expect(clock(page, 'top')).toHaveText('3:00')
})
