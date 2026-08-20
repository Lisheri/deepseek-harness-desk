// @vitest-environment jsdom
/**
 * TitleBar interaction spec under the four-share props form: injected Host
 * callbacks as vi.fn()s, a recording renderSlot stub for the directory-flow
 * hole, and a plain selector stub for the occupancy hook. Asserts the
 * user-visible behavior: file-operations entries, fold labeling, undo/redo
 * routing, the add-workspace flow conversation (open/adopt/error/withdraw),
 * and the Tauri-only chrome (drag region, menu-event bridge).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TitleBar } from '../src/client/TitleBar.tsx'
// From the plugin entry: pulls the LocaleNamespaceMap merge so
// TitleBarComponentProps['t'] resolves.
import type { TitleBarComponentProps } from '../src/client/index.ts'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { en } from '../src/client/locales.ts'

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}))

const { listen } = await import('@tauri-apps/api/event')
const listenMock = vi.mocked(listen)

// jsdom's default user agent reports "darwin", not "Mac"; the mac test
// redefines it, so the original is restored after every test.
const originalUserAgent = navigator.userAgent

// English-dictionary translate stub: the chrome renders the same copy the
// assertions below query by accessible name.
const t: TitleBarComponentProps['t'] = key => (en as Record<string, string>)[key] ?? key

const neverHook = (() => { throw new Error('titlebar must not read global hooks') }) as never

function mount(props: {
  sidebarCollapsed?: boolean
  tauri?: boolean
  mac?: boolean
} = {}) {
  const current = { sidebarCollapsed: false, tauri: false, mac: false, ...props }
  // The environment must read as Tauri BEFORE the first render: the component
  // freezes the webview-kind decision per mount.
  if (current.tauri) window.__TAURI_INTERNALS__ = {}
  if (current.mac) {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    })
  }
  const occupied = { current: true }
  let flowOwner: DirectoryFlowOwnerProps | undefined
  const undo = vi.fn()
  const redo = vi.fn()
  const newChat = vi.fn()
  const toggleSidebar = vi.fn()
  const createWorkspace = vi.fn()
  const startSession = vi.fn()
  // The framework binds the occupancy source into a selector hook; the stub
  // reads the bench-owned boolean on each render (remounts re-read it).
  const useDirectoryFlow = (<S,>(selector: (occupied: boolean) => S): S => selector(occupied.current)) as TitleBarComponentProps['useDirectoryFlow']
  const renderSlot = ((_key: string, owner: DirectoryFlowOwnerProps) => {
    flowOwner = owner
    return <div data-testid="directory-flow" />
  }) as TitleBarComponentProps['renderSlot']
  const element = () => (
    <TitleBar
      sidebarCollapsed={current.sidebarCollapsed}
      useSessions={neverHook} useWorkspaces={neverHook}
      useDirectoryFlow={useDirectoryFlow}
      renderSlot={renderSlot}
      toggleSidebar={toggleSidebar}
      newChat={newChat}
      createWorkspace={createWorkspace}
      startSession={startSession}
      undo={undo}
      redo={redo}
      t={t}
    />
  )
  const view = render(element())
  return {
    occupied, undo, redo, newChat, toggleSidebar, createWorkspace, startSession,
    useDirectoryFlow, renderSlot,
    flowOwner: () => {
      if (flowOwner === undefined) throw new Error('directory-flow owner not rendered')
      return flowOwner
    },
    rerender(next: Partial<typeof current>) {
      Object.assign(current, next)
      view.rerender(element())
    },
  }
}

beforeEach(() => {
  listenMock.mockReset()
  // Default: a successful listen handing back a no-op stop; individual tests
  // override with mockImplementationOnce / mockRejectedValueOnce.
  listenMock.mockResolvedValue(vi.fn())
})

afterEach(() => {
  cleanup()
  delete window.__TAURI_INTERNALS__
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: originalUserAgent,
  })
})

describe('TitleBar chrome', () => {
  it('labels the fold button after the live sidebar state and routes it', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(b.toggleSidebar).toHaveBeenCalledOnce()
    b.rerender({ sidebarCollapsed: true })
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(b.toggleSidebar).toHaveBeenCalledTimes(2)
  })

  it('routes undo and redo to the input-machine hops', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(b.undo).toHaveBeenCalledOnce()
    expect(b.redo).toHaveBeenCalledOnce()
  })

  it('opens the file menu with New Chat and Add Workspace, and routes both', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'File' }))
    fireEvent.click(screen.getByText('New Chat'))
    expect(b.newChat).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'File' }))
    fireEvent.click(screen.getByText('Add Workspace'))
    expect(b.flowOwner().open).toBe(true)
  })

  it('closes the file menu on an outside click', () => {
    mount()
    const trigger = screen.getByRole('button', { name: 'File' })
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.pointerDown(document.body)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('hides the Add Workspace entry when the directory-flow hole is unoccupied', () => {
    const b = mount()
    b.occupied.current = false
    b.rerender({})
    fireEvent.click(screen.getByRole('button', { name: 'File' }))
    expect(screen.getByText('New Chat')).toBeTruthy()
    expect(screen.queryByText('Add Workspace')).toBeNull()
  })

  it('withdraws an open flow whose occupant unloaded (no cancel route left)', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'File' }))
    fireEvent.click(screen.getByText('Add Workspace'))
    expect(b.flowOwner().open).toBe(true)
    b.occupied.current = false
    b.rerender({})
    expect(b.flowOwner().open).toBe(false)
  })

  it('adopts a picked directory as a workspace and opens its session', async () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'File' }))
    fireEvent.click(screen.getByText('Add Workspace'))
    b.createWorkspace.mockResolvedValueOnce({ workspaceId: 'ws-1' })
    b.flowOwner().onPicked('/tmp/demo')
    expect(b.createWorkspace).toHaveBeenCalledWith({ path: '/tmp/demo' })
    await waitFor(() => { expect(b.startSession).toHaveBeenCalledWith('ws-1') })
    expect(b.flowOwner().open).toBe(false)
  })

  it('surfaces an adoption failure in the error dialog and retries through the flow', async () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'File' }))
    fireEvent.click(screen.getByText('Add Workspace'))
    b.createWorkspace.mockRejectedValueOnce(new Error('boom'))
    b.flowOwner().onPicked('/tmp/demo')
    await waitFor(() => { expect(screen.getByText('boom')).toBeTruthy() })
    expect(screen.getByRole('heading', { name: 'Failed to Add Workspace' })).toBeTruthy()
    // Retry reopens the flow through the same occupant.
    fireEvent.click(screen.getByRole('button', { name: 'Choose Again' }))
    expect(b.flowOwner().open).toBe(true)
  })

  it('shows non-Error adoption rejections verbatim', async () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'File' }))
    fireEvent.click(screen.getByText('Add Workspace'))
    b.createWorkspace.mockRejectedValueOnce('raw failure')
    b.flowOwner().onPicked('/tmp/demo')
    await waitFor(() => { expect(screen.getByText('raw failure')).toBeTruthy() })
  })

  it('routes the flow occupant outcomes (cancel, error) to the owner surface', async () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'File' }))
    fireEvent.click(screen.getByText('Add Workspace'))
    act(() => { b.flowOwner().onCancel() })
    expect(b.flowOwner().open).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'File' }))
    fireEvent.click(screen.getByText('Add Workspace'))
    act(() => { b.flowOwner().onError('chooser missing') })
    await waitFor(() => { expect(screen.getByText('chooser missing')).toBeTruthy() })
    expect(b.flowOwner().open).toBe(false)
    // Without an occupant the retry arm is disabled.
    b.occupied.current = false
    b.rerender({})
    expect(screen.getByRole('button', { name: 'Choose Again' }).hasAttribute('disabled')).toBe(true)
  })

  it('closes the error dialog without reopening the flow (cancel + close)', async () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'File' }))
    fireEvent.click(screen.getByText('Add Workspace'))
    b.createWorkspace.mockRejectedValueOnce(new Error('boom'))
    b.flowOwner().onPicked('/tmp/demo')
    await waitFor(() => { expect(screen.getByText('boom')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('boom')).toBeNull()
    // Reopen for the Cancel arm: canceling keeps the flow closed too.
    fireEvent.click(screen.getByRole('button', { name: 'File' }))
    fireEvent.click(screen.getByText('Add Workspace'))
    b.createWorkspace.mockRejectedValueOnce(new Error('boom again'))
    b.flowOwner().onPicked('/tmp/demo')
    await waitFor(() => { expect(screen.getByText('boom again')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('boom again')).toBeNull()
    expect(b.flowOwner().open).toBe(false)
  })
})

describe('TitleBar desktop chrome (Tauri webview)', () => {
  it('shows the drag region and the macOS traffic-light inset only under Tauri', () => {
    mount({ tauri: true, mac: true })
    const bar = screen.getByTestId('directory-flow').parentElement!
    expect(bar.hasAttribute('data-tauri-drag-region')).toBe(false) // the bar itself is not the region
    expect(bar.querySelector('[data-tauri-drag-region]')).not.toBeNull()
    expect(bar.hasAttribute('data-mac')).toBe(true)
  })

  it('renders no drag region outside the Tauri webview', () => {
    mount()
    const bar = screen.getByTestId('directory-flow').parentElement!
    expect(bar.querySelector('[data-tauri-drag-region]')).toBeNull()
    expect(bar.hasAttribute('data-mac')).toBe(false)
  })

  it('bridges desktop-menu events to the same two actions and unlistens on unmount', async () => {
    window.__TAURI_INTERNALS__ = {}
    const unlisten = vi.fn()
    let handler: ((event: { payload: string }) => void) | undefined
    listenMock.mockImplementationOnce(((_event: string, fn: (event: { payload: string }) => void) => {
      handler = fn
      return Promise.resolve(unlisten)
    }) as never)
    const b = mount()
    await waitFor(() => { expect(handler).toBeDefined() })
    expect(listenMock).toHaveBeenCalledWith('desktop-menu', expect.any(Function))
    act(() => { handler!({ payload: 'new-chat' }) })
    expect(b.newChat).toHaveBeenCalledOnce()
    act(() => { handler!({ payload: 'add-workspace' }) })
    expect(b.flowOwner().open).toBe(true)
    act(() => { handler!({ payload: 'other' }) })
    expect(b.newChat).toHaveBeenCalledOnce()
    cleanup()
    expect(unlisten).toHaveBeenCalledOnce()
    // A post-unmount event is retired by the disposed guard.
    act(() => { handler!({ payload: 'new-chat' }) })
    expect(b.newChat).toHaveBeenCalledOnce()
  })

  it('retires a listen that resolves after unmount (immediate stop)', async () => {
    window.__TAURI_INTERNALS__ = {}
    const stop = vi.fn()
    let resolveListen: (stop: () => void) => void = () => {}
    listenMock.mockImplementationOnce(() => new Promise<() => void>((resolve) => { resolveListen = resolve }))
    mount()
    await waitFor(() => { expect(listenMock).toHaveBeenCalled() })
    cleanup() // unmount while the listen is still pending
    await act(async () => { resolveListen(stop) })
    expect(stop).toHaveBeenCalledOnce()
  })

  it('survives a failed listen (the dropdown stays the only route)', async () => {
    window.__TAURI_INTERNALS__ = {}
    listenMock.mockRejectedValueOnce(new Error('no ipc'))
    const b = mount()
    await waitFor(() => { expect(listenMock).toHaveBeenCalled() })
    fireEvent.click(screen.getByRole('button', { name: 'File' }))
    fireEvent.click(screen.getByText('New Chat'))
    expect(b.newChat).toHaveBeenCalledOnce()
  })
})
