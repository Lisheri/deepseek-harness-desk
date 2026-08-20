/**
 * Window-top chrome occupying the frame's titlebar row: the file-operations
 * dropdown (New Chat / Add Workspace), the sidebar fold button, the input
 * undo/redo history arrows, and — in the Tauri desktop shell — the window
 * drag region, the macOS traffic-light inset, and the native menu bridge
 * (the Rust shell's 文件 menu forwards desktop-menu events here).
 *
 * The add-workspace action runs the composed directory-flow occupant of
 * this package's own hole (`shell.titlebar.directoryFlow`) with the same
 * owner conversation ui-workspace defines for its two picker holes, so one
 * picker package serves all three surfaces.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button, IconChevronDownOutline14, IconPanelLeftOutline16, IconRedoOutline16,
  IconUndoOutline16, Menu, Modal, Tooltip, type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
// Inert until `listen` runs: the module reads the Tauri IPC facade only at
// call time, and the effect below gates every call behind the webview check.
import { listen } from '@tauri-apps/api/event'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { TitleBarComponentProps } from './contract/slots.ts'
import css from './TitleBar.module.css'

declare global {
  interface Window {
    /** Tauri's injected IPC facade; present only inside the desktop webview. */
    __TAURI_INTERNALS__?: unknown
  }
}

/** Desktop-menu actions the Rust shell forwards from the native 文件 menu. */
type DesktopMenuAction = 'new-chat' | 'add-workspace'

/** File-dropdown row ids (kept distinct from wire action ids for test clarity). */
const FILE_NEW_CHAT = 'file.new-chat'
const FILE_ADD_WORKSPACE = 'file.add-workspace'

/** True when the page runs inside the Tauri desktop webview. */
function isTauri(): boolean {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined
}

/** True on macOS, where the overlay titlebar keeps the native traffic lights at the top-left. */
function isMac(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')
}

/**
 * Render the titlebar chrome.
 * @param props - composed slot props (owner fold state + injected Host callbacks + locale).
 * @returns the titlebar element tree.
 */
export function TitleBar({
  sidebarCollapsed,
  toggleSidebar,
  newChat,
  createWorkspace,
  startSession,
  undo,
  redo,
  useDirectoryFlow,
  renderSlot,
  t,
}: TitleBarComponentProps) {
  // The webview environment is decided once per page: navigation replaces it.
  const tauri = useRef(isTauri()).current
  const mac = useRef(isMac()).current

  const [fileOpen, setFileOpen] = useState(false)
  const fileAnchor = useRef<HTMLButtonElement>(null)

  // Live occupancy of this surface's directory-flow hole: a composition
  // without a picking affordance hides the add entry (the browser's rule).
  const flowAvailable = useDirectoryFlow(occupied => occupied)
  const [flowOpen, setFlowOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [errorOpen, setErrorOpen] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  // An occupant that unloads mid-interaction leaves nobody to cancel: an open
  // flow over an empty hole withdraws so the actions come back.
  useEffect(() => {
    if (flowOpen && !flowAvailable) setFlowOpen(false)
  }, [flowOpen, flowAvailable])

  const closeModal = useCallback((): void => {
    setErrorOpen(false)
    setModalError(null)
  }, [])

  /** Adopt a picked directory; failures land in the error dialog (retry reopens the flow). */
  const adoptDirectory = useCallback((path: string): Promise<void> =>
    createWorkspace({ path }).then((workspace) => {
      setFlowOpen(false)
      startSession(workspace.workspaceId)
    }).catch((reason: unknown) => {
      setModalError(reason instanceof Error ? reason.message : String(reason))
      setFlowOpen(false)
      setErrorOpen(true)
    }), [createWorkspace, startSession])

  const openDirectoryFlow = useCallback((): void => {
    setErrorOpen(false)
    setModalError(null)
    setFlowOpen(true)
  }, [])

  const handleFileSelect = useCallback((id: string): void => {
    setFileOpen(false)
    // Two independent dispatches: the menu lists exactly these ids, and the
    // guards keep an unknown id a no-op instead of misrouting it.
    if (id === FILE_NEW_CHAT) newChat()
    if (id === FILE_ADD_WORKSPACE) openDirectoryFlow()
  }, [newChat, openDirectoryFlow])

  // The Rust shell's 文件 menu drives the same two actions over events; the
  // dropdown above remains the in-page route (plain browsers, other hosts).
  useEffect(() => {
    if (!tauri) return
    let disposed = false
    let unlisten: (() => void) | undefined
    listen<DesktopMenuAction>('desktop-menu', (event) => {
      if (disposed) return
      if (event.payload === 'new-chat') newChat()
      else if (event.payload === 'add-workspace') openDirectoryFlow()
    }).then((stop) => {
      // An unmount while the listen is still pending retires the late stop.
      if (disposed) stop()
      else unlisten = stop
    }).catch(() => {
      // No shell = no menu events; the in-page dropdown stays the only route.
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [tauri, newChat, openDirectoryFlow])

  const fileItems: readonly MenuEntry[] = [
    { id: FILE_NEW_CHAT, label: t('menu.newChat') },
    // Same availability rule as the sidebar's add button: without a composed
    // picker there is no route to a directory, so the entry disappears.
    ...(flowAvailable ? [{ id: FILE_ADD_WORKSPACE, label: t('menu.addWorkspace') }] : []),
  ]

  // Owner side of the flow conversation (mirrors WorkspacePickFlow's contract).
  const flowOwner: DirectoryFlowOwnerProps = {
    open: flowOpen,
    busy: picking,
    onPicked: (path) => {
      setPicking(true)
      void adoptDirectory(path).finally(() => { setPicking(false) })
    },
    onCancel: () => { setFlowOpen(false) },
    onError: (message) => {
      setFlowOpen(false)
      setModalError(message)
      setErrorOpen(true)
    },
  }

  return (
    <div className={css.bar} data-tauri={tauri || undefined} data-mac={mac || undefined}>
      <div className={css.cluster}>
        <Menu
          open={fileOpen}
          onClose={() => { setFileOpen(false) }}
          items={fileItems}
          onSelect={handleFileSelect}
          align="start"
          dense
          portal
          anchor={(
            <button
              ref={fileAnchor}
              type="button"
              className={css.fileButton}
              aria-haspopup="menu"
              aria-expanded={fileOpen}
              onClick={() => { setFileOpen(open => !open) }}
            >
              <span>{t('menu.file')}</span>
              <IconChevronDownOutline14 />
            </button>
          )}
        />
        <span className={css.sep} aria-hidden="true" />
        <Tooltip label={sidebarCollapsed ? t('toggle.open') : t('toggle.collapse')} delayMs={500}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={sidebarCollapsed ? t('toggle.open') : t('toggle.collapse')}
            onClick={() => { toggleSidebar() }}
          >
            <IconPanelLeftOutline16 />
          </button>
        </Tooltip>
        <span className={css.sep} aria-hidden="true" />
        <Tooltip label={t('undo')} delayMs={500}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('undo')}
            onClick={() => { undo() }}
          >
            <IconUndoOutline16 />
          </button>
        </Tooltip>
        <Tooltip label={t('redo')} delayMs={500}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('redo')}
            onClick={() => { redo() }}
          >
            <IconRedoOutline16 />
          </button>
        </Tooltip>
      </div>
      {/* The draggable region is the bar's empty middle; buttons never ride it. */}
      <div className={css.dragRegion} data-tauri-drag-region={tauri || undefined} />
      {renderSlot('shell.titlebar.directoryFlow', flowOwner)}
      <Modal
        open={errorOpen}
        onClose={closeModal}
        closeLabel={t('close')}
        title={t('folderError.title')}
        footer={(
          <>
            <Button variant="outline" onClick={closeModal}>{t('cancel')}</Button>
            {/* Retrying needs an occupant to serve the flow; without one the
                button would open a flow nobody can answer or cancel. */}
            <Button variant="primary" disabled={!flowAvailable} onClick={openDirectoryFlow}>{t('folderError.retry')}</Button>
          </>
        )}
      >
        <div className={css.modalError} role="alert">{modalError}</div>
      </Modal>
    </div>
  )
}
