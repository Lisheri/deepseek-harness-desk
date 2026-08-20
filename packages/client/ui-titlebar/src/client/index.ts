/**
 * Titlebar plugin, browser half: registers the TitleBar chrome into the
 * layout-owned `shell.titlebar` hole (through slots.inject, since ui-layout
 * may activate later or replace its declaration) and declares the
 * add-workspace directory-flow hole the composed picker packages fill. All
 * Host verbs arrive through the inject face; undo/redo reach the current
 * Session's input machine through the scope-addressed conversation service
 * (optional — a composition without ui-conversation keeps the buttons as
 * no-ops). Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ui-layout's SlotMap merge (the 'shell.titlebar' entry).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { TitlebarInjected } from './contract/slots.ts'
import { TitleBar } from './TitleBar.tsx'
import { en, zh, type TitlebarKey } from './locales.ts'

export type { TitlebarInjected, TitleBarComponentProps } from './contract/slots.ts'
export type { TitlebarKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Titlebar chrome copy. */
    titlebar: TitlebarKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'titlebar'

/** Required services (cordis fiber inject); `conversation` stays optional via ctx.get. */
export const inject = ['slots', 'layout', 'workspaces', 'sessions', 'locale']

/**
 * Register the titlebar chrome once the layout hole exists.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-titlebar: dictionaries')

  // Stable occupancy source for the titlebar's directory-flow hole (the
  // renderer binds it into the component's useDirectoryFlow hook).
  const flowSource = (): TitlebarInjected['hooks']['directoryFlow'] => ({
    getSnapshot: () => ctx.slots.entries('shell.titlebar.directoryFlow').length > 0,
    subscribe: listener => ctx.slots.subscribe('shell.titlebar.directoryFlow', listener),
  })

  /** One undo/redo hop through the current Session's input facade. */
  const inputHop = (verb: 'undo' | 'redo'): void => {
    const conversation = ctx.get('conversation')
    if (conversation === undefined) return
    const currentId = ctx.sessions.list.getSnapshot().current
    if (currentId === undefined) return
    const scoped = ctx.sessions.scope(currentId)
    if (scoped === undefined) return
    conversation.input.for(scoped)[verb]()
  }

  const injectProps = (): TitlebarInjected => ({
    toggleSidebar: () => { ctx.layout.toggleSidebar() },
    newChat: () => { ctx.workspaces.startSession() },
    createWorkspace: input => ctx.workspaces.create(input),
    startSession: (workspaceId) => { ctx.workspaces.startSession(workspaceId) },
    undo: () => { inputHop('undo') },
    redo: () => { inputHop('redo') },
    hooks: { directoryFlow: flowSource() },
  })

  ctx.slots.inject('shell.titlebar', () => ctx.slots.register(
    {
      name: 'shell.titlebar',
      children: { 'shell.titlebar.directoryFlow': { kind: 'single', scope: 'root' } },
      inject: injectProps,
      locale: NS,
    },
    TitleBar,
  ))
}
