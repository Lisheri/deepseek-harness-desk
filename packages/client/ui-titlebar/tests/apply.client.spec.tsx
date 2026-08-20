// @vitest-environment jsdom
/** Titlebar slot registration and its plain runtime/layout/workspace/input callbacks. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-titlebar/client'
import type { TitlebarInjected } from '@deepseek-ai/dsh-client-ui-titlebar/client'

async function bench({ declare = true, current = undefined as string | undefined, withConversation = true, noScope = false } = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const layout = { toggleSidebar: vi.fn() }
  const workspaces = { startSession: vi.fn(), create: vi.fn() }
  const undo = vi.fn()
  const redo = vi.fn()
  const conversation = { input: { for: vi.fn(() => ({ undo, redo })) } }
  const scoped = { tag: 'scoped' } as never
  const sessions = {
    list: { getSnapshot: () => ({ current }) },
    scope: vi.fn(() => (noScope ? undefined : scoped)),
  }
  ctx.provide('layout', layout)
  ctx.provide('workspaces', workspaces as never)
  ctx.provide('sessions', sessions as never)
  if (withConversation) ctx.provide('conversation', conversation as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const slots = ctx.get('slots') as SlotRegistry
  if (declare) {
    slots.register(
      { name: 'root', children: { 'shell.titlebar': { kind: 'single', scope: 'root' } } } as never,
      () => null,
    )
  }
  return { ctx, slots, layout, workspaces, sessions, conversation, scoped, undo, redo }
}

describe('ui-titlebar apply', () => {
  it('declares only the services it uses (conversation stays optional)', () => {
    expect(inject).toEqual(['slots', 'layout', 'workspaces', 'sessions', 'locale'])
  })

  it('registers the chrome and declares its directory-flow hole', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('shell.titlebar')).toHaveLength(1)
    expect(b.slots.spec('shell.titlebar.directoryFlow')).toEqual({ kind: 'single', scope: 'root' })
    // Copy rides the standard locale seat, not the inject face.
    expect(b.slots.entries('shell.titlebar')[0]!.locale).toBe('titlebar')
    const injected = (b.slots.entries('shell.titlebar')[0]!.inject as () => TitlebarInjected)()
    expect(Object.keys(injected)).toEqual([
      'toggleSidebar', 'newChat', 'createWorkspace', 'startSession', 'undo', 'redo', 'hooks',
    ])
    injected.toggleSidebar()
    expect(b.layout.toggleSidebar).toHaveBeenCalledOnce()
    injected.newChat()
    expect(b.workspaces.startSession).toHaveBeenLastCalledWith()
    injected.startSession('ws' as never)
    expect(b.workspaces.startSession).toHaveBeenLastCalledWith('ws')
    injected.createWorkspace({ path: '/tmp/x' })
    expect(b.workspaces.create).toHaveBeenCalledWith({ path: '/tmp/x' })
    // Occupancy source mirrors the hole's live entry count and delegates its
    // subscription to the slot registry.
    expect(injected.hooks.directoryFlow.getSnapshot()).toBe(false)
    const subscribeSpy = vi.spyOn(b.slots, 'subscribe')
    const listener = vi.fn()
    injected.hooks.directoryFlow.subscribe(listener)
    expect(subscribeSpy).toHaveBeenCalledWith('shell.titlebar.directoryFlow', listener)
  })

  it('undo/redo hop through the current session scope into the input facade', async () => {
    const b = await bench({ current: 's-1' })
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = (b.slots.entries('shell.titlebar')[0]!.inject as () => TitlebarInjected)()
    injected.undo()
    injected.redo()
    expect(b.sessions.scope).toHaveBeenCalledWith('s-1')
    expect(b.conversation.input.for).toHaveBeenCalledWith(b.scoped)
    expect(b.undo).toHaveBeenCalledOnce()
    expect(b.redo).toHaveBeenCalledOnce()
  })

  it('undo/redo no-op without a current session or a conversation service', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = (b.slots.entries('shell.titlebar')[0]!.inject as () => TitlebarInjected)()
    injected.undo()
    expect(b.sessions.scope).not.toHaveBeenCalled()
    // Second bench: no conversation service provided at all.
    const bare = await bench({ withConversation: false })
    await bare.ctx.plugin({ inject: [...inject], apply }).await()
    const bareInjected = (bare.slots.entries('shell.titlebar')[0]!.inject as () => TitlebarInjected)()
    bareInjected.undo()
    expect(bare.sessions.scope).not.toHaveBeenCalled()
  })

  it('undo/redo no-op when the current session has no live scope', async () => {
    const b = await bench({ current: 's-gone', noScope: true })
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = (b.slots.entries('shell.titlebar')[0]!.inject as () => TitlebarInjected)()
    injected.undo()
    expect(b.sessions.scope).toHaveBeenCalledWith('s-gone')
    expect(b.conversation.input.for).not.toHaveBeenCalled()
  })

  it('waits for a live owner to declare the slot, then materializes the contribution', async () => {
    const b = await bench({ declare: false })
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await Promise.resolve() // let the inject controller settle before any declaration exists
    expect(b.slots.entries('shell.titlebar')).toHaveLength(0)
    b.slots.register(
      { name: 'root', children: { 'shell.titlebar': { kind: 'single', scope: 'root' } } } as never,
      () => null,
    )
    await fiber.await()
    expect(b.slots.entries('shell.titlebar')).toHaveLength(1)
  })

  it('removes the entry and child declaration on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('shell.titlebar')).toHaveLength(0)
    expect(b.slots.spec('shell.titlebar.directoryFlow')).toBeUndefined()
  })
})
