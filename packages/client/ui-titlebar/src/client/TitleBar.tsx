/**
 * Window-top chrome occupying the frame's titlebar row: the sidebar fold
 * button, the input undo/redo history arrows, and — in the Tauri desktop
 * shell — the window drag region, the macOS traffic-light inset, and the
 * native menu bridge (the Rust shell's 文件 menu forwards desktop-menu
 * events here; file operations live in the OS menu bar, not this row).
 *
 * The add-workspace action runs the composed directory-flow occupant of
 * this package's own hole (`shell.titlebar.directoryFlow`) with the same
 * owner conversation ui-workspace defines for its two picker holes, so one
 * picker package serves all three surfaces.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button, IconPanelLeftOutline16, IconRedoOutline16,
  IconUndoOutline16, Modal, Tooltip,
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

  // Live occupancy of this surface's directory-flow hole: a composition
  // without a picking affordance has no add route at all.
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

  // The Rust shell's 文件 menu drives its two actions over events; in a plain
  // browser there is no desktop menu, so the chrome carries no file surface.
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
      // No shell = no menu events; the GUI's own surfaces are the only routes.
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [tauri, newChat, openDirectoryFlow])

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
