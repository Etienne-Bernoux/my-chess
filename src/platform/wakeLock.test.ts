// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createWakeLock, resolveRequester } from './wakeLock'
import type { WakeLockHandle } from './wakeLock'

type MutableHandle = { released: boolean; release: () => Promise<void> }

function fakeRequester(): {
  request: () => Promise<WakeLockHandle>
  requests: number
  releases: number
  handles: MutableHandle[]
} {
  const state = {
    requests: 0,
    releases: 0,
    handles: [] as MutableHandle[],
    request: (): Promise<WakeLockHandle> => {
      state.requests += 1
      const handle: MutableHandle = {
        released: false,
        release: (): Promise<void> => {
          state.releases += 1
          handle.released = true
          return Promise.resolve()
        },
      }
      state.handles.push(handle)
      return Promise.resolve(handle)
    },
  }
  return state
}

const settle = (): Promise<void> => Promise.resolve().then(() => {})

describe('createWakeLock', () => {
  it('acquiert le verrou quand la pendule tourne, le relâche à l’arrêt', async () => {
    const fake = fakeRequester()
    const lock = createWakeLock(fake.request)

    lock.setDesired(true)
    await settle()
    expect(fake.requests).toBe(1)

    lock.setDesired(false)
    await settle()
    expect(fake.releases).toBe(1)
  })

  it('rester dans le même état ne redemande rien', async () => {
    const fake = fakeRequester()
    const lock = createWakeLock(fake.request)

    lock.setDesired(true)
    lock.setDesired(true)
    await settle()
    lock.setDesired(true)
    await settle()

    expect(fake.requests).toBe(1)
  })

  it('une double relâche ne jette pas et ne compte qu’une fois', async () => {
    const fake = fakeRequester()
    const lock = createWakeLock(fake.request)

    lock.setDesired(true)
    await settle()
    lock.setDesired(false)
    lock.setDesired(false)
    await settle()

    expect(fake.releases).toBe(1)
  })

  it('dispose relâche le verrou encore tenu', async () => {
    const fake = fakeRequester()
    const lock = createWakeLock(fake.request)

    lock.setDesired(true)
    await settle()
    lock.dispose()
    await settle()

    expect(fake.releases).toBe(1)
  })

  it('une pause survenue pendant la promesse relâche immédiatement', async () => {
    const fake = fakeRequester()
    const lock = createWakeLock(fake.request)

    lock.setDesired(true)
    lock.setDesired(false) // la promesse n'est pas encore résolue
    await settle()
    await settle()

    expect(fake.requests).toBe(1)
    expect(fake.releases).toBe(1)
  })

  it('un verrou relâché par le navigateur est redemandé, pas tenu pour acquis', async () => {
    const fake = fakeRequester()
    const lock = createWakeLock(fake.request)

    lock.setDesired(true)
    await settle()
    expect(fake.requests).toBe(1)

    // Le navigateur relâche de lui-même (batterie faible, écran éteint au bouton) :
    // ni `release()` de notre part, ni changement de visibilité.
    fake.handles[0]!.released = true

    // L'état voulu n'a pas changé — c'est justement le cas qui court-circuitait.
    lock.setDesired(true)
    await settle()
    expect(fake.requests).toBe(2)
  })

  it('une demande refusée n’est pas retentée à chaque frame', async () => {
    let attempts = 0
    const lock = createWakeLock(() => {
      attempts += 1
      return Promise.reject(new Error('batterie faible'))
    })

    lock.setDesired(true)
    await settle()
    for (let i = 0; i < 10; i += 1) {
      lock.setDesired(true)
      await settle()
    }
    expect(attempts).toBe(1)

    // Un vrai changement d'état rouvre le droit d'essayer.
    lock.setDesired(false)
    lock.setDesired(true)
    await settle()
    expect(attempts).toBe(2)
  })

  it('un environnement sans Screen Wake Lock ne jette jamais', () => {
    const lock = createWakeLock(null)
    expect(() => {
      lock.setDesired(true)
      lock.setDesired(false)
      lock.dispose()
    }).not.toThrow()
  })

  it('resolveRequester rend null quand l’API est absente', () => {
    expect(resolveRequester()).toBeNull()
  })
})
