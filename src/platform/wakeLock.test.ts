// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createWakeLock, resolveRequester } from './wakeLock'
import type { WakeLockHandle } from './wakeLock'

function fakeRequester(): {
  request: () => Promise<WakeLockHandle>
  requests: number
  releases: number
} {
  const state = {
    requests: 0,
    releases: 0,
    request: (): Promise<WakeLockHandle> => {
      state.requests += 1
      return Promise.resolve({
        release: (): Promise<void> => {
          state.releases += 1
          return Promise.resolve()
        },
      })
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
