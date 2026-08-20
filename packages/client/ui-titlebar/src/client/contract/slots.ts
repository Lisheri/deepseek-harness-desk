/**
 * Titlebar slot contract: the registrant-side props composition for the
 * layout-owned `shell.titlebar` slot, plus the add-workspace directory-flow
 * hole this package's entry declares (typed by ui-workspace's contract, which
 * owns the shared DirectoryFlowOwnerProps conversation — one composed picker
 * package fills all three flow holes).
 */
import type { PropsHooks, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-layout's SlotMap merge (the 'shell.titlebar' entry and
// its owner share) into every program that sees this contract.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls ui-workspace's SlotMap merge (the directory-flow holes).
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Registrant-private injected share (arrives via the register inject
 * factory): the Host verbs the titlebar chrome drives. The undo/redo pair
 * targets the current Session's input machine through the scope-addressed
 * conversation service, mirroring the composer's own Cmd/Ctrl-Z bindings.
 */
export type TitlebarInjected = {
  /** Fold/expand the sidebar column through the layout service. */
  toggleSidebar: () => void
  /** Start a New Session with the current Session Workspace, then the recent Workspace. */
  newChat: () => void
  /** Adopt a picked host directory as a real Workspace. */
  createWorkspace: (input: { path: string }) => Promise<WorkspaceView>
  /** Open (or reuse) a Workspace's blank session after creation. */
  startSession: (workspaceId: WorkspaceId) => void
  /** Undo the current Session's latest input-machine transaction. */
  undo: () => void
  /** Redo the current Session's latest undone input-machine transaction. */
  redo: () => void
  hooks: {
    /** True while the titlebar's directory-flow hole is occupied. */
    directoryFlow: HostObservable<boolean>
  }
}

/** Component-side view of the injected hooks compartment. */
export type TitlebarHooks = PropsHooks<TitlebarInjected['hooks']>

/** Full component props: owner fold state, the directory-flow render share, injected callbacks, and locale. */
export type TitleBarComponentProps =
  & PropsRuntime<'shell.titlebar'>
  & PropsRenderSlots<'shell.titlebar.directoryFlow'>
  & Omit<TitlebarInjected, 'hooks'>
  & TitlebarHooks
  & PropsLocale<'titlebar'>
