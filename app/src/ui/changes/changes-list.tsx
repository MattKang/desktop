import * as React from 'react'
import * as Path from 'path'

import { IGitHubUser } from '../../lib/databases'
import { Dispatcher } from '../dispatcher'
import { IMenuItem } from '../../lib/menu-item'
import { revealInFileManager } from '../../lib/app-shell'
import {
  WorkingDirectoryStatus,
  WorkingDirectoryFileChange,
  AppFileStatusKind,
} from '../../models/status'
import { DiffSelectionType } from '../../models/diff'
import { CommitIdentity } from '../../models/commit-identity'
import { ICommitMessage } from '../../models/commit-message'
import { Repository } from '../../models/repository'
import { IAuthor } from '../../models/author'
import { List, ClickSource } from '../lib/list'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import {
  isSafeFileExtension,
  DefaultEditorLabel,
  CopyFilePathLabel,
  RevealInFileManagerLabel,
  OpenWithDefaultProgramLabel,
} from '../lib/context-menu'
import { CommitMessage } from './commit-message'
import { ChangedFile } from './changed-file'
import { IAutocompletionProvider } from '../autocompletion'
import { showContextualMenu } from '../main-process-proxy'
import { arrayEquals } from '../../lib/equality'
import { clipboard } from 'electron'
import { basename } from 'path'
import { ICommitContext } from '../../models/commit'
import { RebaseConflictState } from '../../lib/app-state'
import { ContinueRebase } from './continue-rebase'
import { enableStashing } from '../../lib/feature-flag'
import { Octicon, OcticonSymbol } from '../octicons'
import { IStashEntry } from '../../models/stash-entry'
import * as classNames from 'classnames'
import { hasWritePermission } from '../../models/github-repository'

const RowHeight = 29
const StashIcon = new OcticonSymbol(
  16,
  16,
  'M3.002 15H15V4c.51 0 1 .525 1 .996V15c0 .471-.49 1-1 1H4.002c-.51 ' +
    '0-1-.529-1-1zm-2-2H13V2c.51 0 1 .525 1 .996V13c0 .471-.49 1-1 ' +
    '1H2.002c-.51 0-1-.529-1-1zm10.14-13A.86.86 0 0 1 12 .857v10.286a.86.86 ' +
    '0 0 1-.857.857H.857A.86.86 0 0 1 0 11.143V.857A.86.86 0 0 1 .857 0h10.286zM11 ' +
    '11V1H1v10h10zM3 6c0-1.66 1.34-3 3-3s3 1.34 3 3-1.34 3-3 3-3-1.34-3-3z'
)

const GitIgnoreFileName = '.gitignore'

/** Compute the 'Include All' checkbox value from the repository state */
function getIncludeAllValue(
  workingDirectory: WorkingDirectoryStatus,
  rebaseConflictState: RebaseConflictState | null
) {
  if (rebaseConflictState !== null) {
    if (workingDirectory.files.length === 0) {
      // the current commit will be skipped in the rebase
      return CheckboxValue.Off
    }

    // untracked files will be skipped by the rebase, so we need to ensure that
    // the "Include All" checkbox matches this state
    const onlyUntrackedFilesFound = workingDirectory.files.every(
      f => f.status.kind === AppFileStatusKind.Untracked
    )

    if (onlyUntrackedFilesFound) {
      return CheckboxValue.Off
    }

    const onlyTrackedFilesFound = workingDirectory.files.every(
      f => f.status.kind !== AppFileStatusKind.Untracked
    )

    // show "Mixed" if we have a mixture of tracked and untracked changes
    return onlyTrackedFilesFound ? CheckboxValue.On : CheckboxValue.Mixed
  }

  const { includeAll } = workingDirectory
  if (includeAll === true) {
    return CheckboxValue.On
  } else if (includeAll === false) {
    return CheckboxValue.Off
  } else {
    return CheckboxValue.Mixed
  }
}

interface IChangesListProps {
  readonly repository: Repository
  readonly workingDirectory: WorkingDirectoryStatus
  readonly rebaseConflictState: RebaseConflictState | null
  readonly selectedFileIDs: string[]
  readonly onFileSelectionChanged: (rows: ReadonlyArray<number>) => void
  readonly onIncludeChanged: (path: string, include: boolean) => void
  readonly onSelectAll: (selectAll: boolean) => void
  readonly onCreateCommit: (context: ICommitContext) => Promise<boolean>
  readonly onDiscardChanges: (file: WorkingDirectoryFileChange) => void
  readonly askForConfirmationOnDiscardChanges: boolean
  readonly focusCommitMessage: boolean
  readonly onDiscardChangesFromFiles: (
    files: ReadonlyArray<WorkingDirectoryFileChange>,
    isDiscardingAllChanges: boolean
  ) => void

  /** Callback that fires on page scroll to pass the new scrollTop location */
  readonly onChangesListScrolled: (scrollTop: number) => void

  /* The scrollTop of the compareList. It is stored to allow for scroll position persistence */
  readonly changesListScrollTop?: number

  /**
   * Called to open a file it its default application
   * @param path The path of the file relative to the root of the repository
   */
  readonly onOpenItem: (path: string) => void
  readonly branch: string | null
  readonly commitAuthor: CommitIdentity | null
  readonly gitHubUser: IGitHubUser | null
  readonly dispatcher: Dispatcher
  readonly availableWidth: number
  readonly isCommitting: boolean
  readonly currentBranchProtected: boolean

  /**
   * Click event handler passed directly to the onRowClick prop of List, see
   * List Props for documentation.
   */
  readonly onRowClick?: (row: number, source: ClickSource) => void
  readonly commitMessage: ICommitMessage

  /** The autocompletion providers available to the repository. */
  readonly autocompletionProviders: ReadonlyArray<IAutocompletionProvider<any>>

  /** Called when the given pattern should be ignored. */
  readonly onIgnore: (pattern: string | string[]) => void

  /**
   * Whether or not to show a field for adding co-authors to
   * a commit (currently only supported for GH/GHE repositories)
   */
  readonly showCoAuthoredBy: boolean

  /**
   * A list of authors (name, email pairs) which have been
   * entered into the co-authors input box in the commit form
   * and which _may_ be used in the subsequent commit to add
   * Co-Authored-By commit message trailers depending on whether
   * the user has chosen to do so.
   */
  readonly coAuthors: ReadonlyArray<IAuthor>

  /** The name of the currently selected external editor */
  readonly externalEditorLabel?: string

  /**
   * Callback to open a selected file using the configured external editor
   *
   * @param fullPath The full path to the file on disk
   */
  readonly onOpenInExternalEditor: (fullPath: string) => void

  readonly stashEntry: IStashEntry | null

  readonly isShowingStashEntry: boolean

  /**
   * Whether we should show the onboarding tutorial nudge
   * arrow pointing at the commit summary box
   */
  readonly shouldNudgeToCommit: boolean

  readonly isLFSUpdateInProgress: boolean
  readonly isUsingLFS: boolean
  readonly locks: ReadonlyMap<string, string> | null
  readonly lockUser: string | null
}

interface IChangesState {
  readonly selectedRows: ReadonlyArray<number>
}

function getSelectedRowsFromProps(
  props: IChangesListProps
): ReadonlyArray<number> {
  const selectedFileIDs = props.selectedFileIDs
  const selectedRows = []

  for (const id of selectedFileIDs) {
    const ix = props.workingDirectory.findFileIndexByID(id)
    if (ix !== -1) {
      selectedRows.push(ix)
    }
  }

  return selectedRows
}

export class ChangesList extends React.Component<
  IChangesListProps,
  IChangesState
> {
  public constructor(props: IChangesListProps) {
    super(props)
    this.state = {
      selectedRows: getSelectedRowsFromProps(props),
    }
  }

  public componentWillReceiveProps(nextProps: IChangesListProps) {
    // No need to update state unless we haven't done it yet or the
    // selected file id list has changed.
    if (
      !arrayEquals(nextProps.selectedFileIDs, this.props.selectedFileIDs) ||
      !arrayEquals(
        nextProps.workingDirectory.files,
        this.props.workingDirectory.files
      )
    ) {
      this.setState({ selectedRows: getSelectedRowsFromProps(nextProps) })
    }
  }

  private onIncludeAllChanged = (event: React.FormEvent<HTMLInputElement>) => {
    const include = event.currentTarget.checked
    this.props.onSelectAll(include)
  }

  private renderRow = (row: number): JSX.Element => {
    const {
      workingDirectory,
      rebaseConflictState,
      isCommitting,
      onIncludeChanged,
      availableWidth,
    } = this.props

    const file = workingDirectory.files[row]
    const selection = file.selection.getSelectionType()

    const includeAll =
      selection === DiffSelectionType.All
        ? true
        : selection === DiffSelectionType.None
        ? false
        : null

    const include =
      rebaseConflictState !== null
        ? file.status.kind !== AppFileStatusKind.Untracked
        : includeAll

    const disableSelection = isCommitting || rebaseConflictState !== null

    return (
      <ChangedFile
        file={file}
        include={include}
        key={file.id}
        onContextMenu={this.onItemContextMenu}
        onIncludeChanged={onIncludeChanged}
        availableWidth={availableWidth}
        disableSelection={disableSelection}
      />
    )
  }

  private onDiscardAllChanges = () => {
    this.props.onDiscardChangesFromFiles(
      this.props.workingDirectory.files,
      true
    )
  }

  private onDiscardChanges = (files: ReadonlyArray<string>) => {
    const workingDirectory = this.props.workingDirectory

    if (files.length === 1) {
      const modifiedFile = workingDirectory.files.find(f => f.path === files[0])

      if (modifiedFile != null) {
        this.props.onDiscardChanges(modifiedFile)
      }
    } else {
      const modifiedFiles = new Array<WorkingDirectoryFileChange>()

      files.forEach(file => {
        const modifiedFile = workingDirectory.files.find(f => f.path === file)

        if (modifiedFile != null) {
          modifiedFiles.push(modifiedFile)
        }
      })

      if (modifiedFiles.length > 0) {
        // DiscardAllChanges can also be used for discarding several selected changes.
        // Therefore, we update the pop up to reflect whether or not it is "all" changes.
        const discardingAllChanges =
          modifiedFiles.length === workingDirectory.files.length

        this.props.onDiscardChangesFromFiles(
          modifiedFiles,
          discardingAllChanges
        )
      }
    }
  }

  private getDiscardChangesMenuItemLabel = (files: ReadonlyArray<string>) => {
    const label =
      files.length === 1
        ? __DARWIN__
          ? `Discard Changes`
          : `Discard changes`
        : __DARWIN__
        ? `Discard ${files.length} Selected Changes`
        : `Discard ${files.length} selected changes`

    return this.props.askForConfirmationOnDiscardChanges ? `${label}…` : label
  }

  private onContextMenu = (event: React.MouseEvent<any>) => {
    event.preventDefault()

    // need to preserve the working directory state while dealing with conflicts
    if (this.props.rebaseConflictState !== null || this.props.isCommitting) {
      return
    }

    const items: IMenuItem[] = [
      {
        label: __DARWIN__ ? 'Discard All Changes…' : 'Discard all changes…',
        action: this.onDiscardAllChanges,
        enabled: this.props.workingDirectory.files.length > 0,
      },
    ]

    showContextualMenu(items)
  }

  private getDiscardChangesMenuItem = (
    paths: ReadonlyArray<string>
  ): IMenuItem => {
    return {
      label: this.getDiscardChangesMenuItemLabel(paths),
      action: () => this.onDiscardChanges(paths),
    }
  }

  private getIgnoreChangesMenuItem = (
    paths: ReadonlyArray<string>
  ): IMenuItem => {
    // Single file
    if (paths.length === 1) {
      return {
        label: __DARWIN__
          ? 'Ignore File (Add to .gitignore)'
          : 'Ignore file (add to .gitignore)',
        action: () => this.props.onIgnore(paths[0]),
        enabled: Path.basename(paths[0]) !== GitIgnoreFileName,
      }
    }

    // Multiple files
    return {
      label: __DARWIN__
        ? `Ignore ${paths.length} Selected Files (Add to .gitignore)`
        : `Ignore ${paths.length} selected files (add to .gitignore)`,
      action: () => {
        // Filter out any .gitignores that happens to be selected, ignoring
        // those doesn't make sense.
        this.props.onIgnore(
          paths.filter(path => Path.basename(path) !== GitIgnoreFileName)
        )
      },
      // Enable this action as long as there's something selected which isn't
      // a .gitignore file.
      enabled: paths.some(path => Path.basename(path) !== GitIgnoreFileName),
    }
  }

  private getIgnoreExtensionsMenuItems = (
    extensions: Set<string>
  ): ReadonlyArray<IMenuItem> => {
    const items: IMenuItem[] = []

    Array.from(extensions)
      .slice(0, 5)
      .forEach(extension => {
        items.push({
          label: __DARWIN__
            ? `Ignore All ${extension} Files (Add to .gitignore)`
            : `Ignore all ${extension} files (add to .gitignore)`,
          action: () => this.props.onIgnore(`*${extension}`),
        })
      })

    return items
  }

  private getFileLockMenuItems = (
    paths: ReadonlyArray<string>
  ): ReadonlyArray<IMenuItem> => {
    // Single
    if (paths.length === 1) {
      // Lockable
      const tempOwner = this.props.locks == null ? null : this.props.locks.get(paths[0])
      if (tempOwner == null) {
        return [
          {
            label: __DARWIN__ ? 'Lock File' : 'Lock file',
            action: () => this.props.dispatcher.toggleFileLocks(this.props.repository, paths, true),
            enabled: !this.props.isLFSUpdateInProgress
          }
        ]
      }

      // Unlockable (owned)
      if (tempOwner === this.props.lockUser ) {
        return [
          {
            label: __DARWIN__ ? 'Unlock File' : 'Unlock file',
            action: () => this.props.dispatcher.toggleFileLocks(this.props.repository, paths, false),
            enabled: !this.props.isLFSUpdateInProgress
          }
        ]
      }

      // Force unlockable (not owned)
      return [
        {
          label: __DARWIN__ ? 'Force Unlock File' : 'Force unlock file',
          action: () => this.props.dispatcher.toggleFileLocks(this.props.repository, paths, false, true),
          enabled: !this.props.isLFSUpdateInProgress
        }
      ]
    }

    // Multiple, calculate possible states of all files
    var tempLockables: Array<string> = []
    var tempUnlockables: Array<string> = []
    var tempForceUnlockables: Array<string> = []

    if (this.props.locks == null) {
      tempLockables = paths as Array<string>
    } else {
      for (let i = (paths.length - 1); i >= 0; --i) {
        let tempOwner = this.props.locks == null ? null : this.props.locks.get(paths[i])
        if (tempOwner == null) {
          tempLockables.push(paths[i])
        } else if (tempOwner === this.props.lockUser) {
          tempUnlockables.push(paths[i])
        } else {
          tempForceUnlockables.push(paths[i])
        }
      }
    }

    return [
      {
            label: __DARWIN__ ? `Lock ${tempLockables.length} Selected Files` : `Lock ${tempLockables.length} selected files`,
            action: () => this.props.dispatcher.toggleFileLocks(this.props.repository, tempLockables, true),
            enabled: !this.props.isLFSUpdateInProgress && tempLockables.length > 0
      },
      {
            label: __DARWIN__ ? `Unlock ${tempUnlockables.length} Selected Files` : `Unlock ${tempUnlockables.length} selected files`,
            action: () => this.props.dispatcher.toggleFileLocks(this.props.repository, tempUnlockables, false),
            enabled: !this.props.isLFSUpdateInProgress && tempUnlockables.length > 0
      },
      {
            label: __DARWIN__ ? `Force Unlock ${tempForceUnlockables.length} Selected Files` : `Force unlock ${tempForceUnlockables.length} selected files`,
            action: () => this.props.dispatcher.toggleFileLocks(this.props.repository, tempForceUnlockables, false, true),
            enabled: !this.props.isLFSUpdateInProgress && tempForceUnlockables.length > 0
      }
    ]
  }

  private getCopyPathMenuItem = (
    file: WorkingDirectoryFileChange
  ): IMenuItem => {
    return {
      label: CopyFilePathLabel,
      action: () => {
        const fullPath = Path.join(this.props.repository.path, file.path)
        clipboard.writeText(fullPath)
      },
    }
  }

  private getRevealInFileManagerMenuItem = (
    file: WorkingDirectoryFileChange
  ): IMenuItem => {
    return {
      label: RevealInFileManagerLabel,
      action: () => revealInFileManager(this.props.repository, file.path),
      enabled: file.status.kind !== AppFileStatusKind.Deleted,
    }
  }

  private getOpenInExternalEditorMenuItem = (
    file: WorkingDirectoryFileChange,
    enabled: boolean
  ): IMenuItem => {
    const { externalEditorLabel, repository } = this.props

    const openInExternalEditor = externalEditorLabel
      ? `Open in ${externalEditorLabel}`
      : DefaultEditorLabel

    return {
      label: openInExternalEditor,
      action: () => {
        const fullPath = Path.join(repository.path, file.path)
        this.props.onOpenInExternalEditor(fullPath)
      },
      enabled,
    }
  }

  private getDefaultContextMenu(
    file: WorkingDirectoryFileChange
  ): ReadonlyArray<IMenuItem> {
    const { id, path, status } = file

    const extension = Path.extname(path)
    const enabled = isSafeFileExtension(extension) && status.kind !== AppFileStatusKind.Deleted
    
    const { workingDirectory, selectedFileIDs, isUsingLFS } = this.props

    const selectedFiles = new Array<WorkingDirectoryFileChange>()
    const paths = new Array<string>()
    const extensions = new Set<string>()

    const addItemToArray = (fileID: string) => {
      const newFile = workingDirectory.findFileWithID(fileID)
      if (newFile) {
        selectedFiles.push(newFile)
        paths.push(newFile.path)

        const extension = Path.extname(newFile.path)
        if (extension.length) {
          extensions.add(extension)
        }
      }
    }

    if (selectedFileIDs.includes(id)) {
      // user has selected a file inside an existing selection
      // -> context menu entries should be applied to all selected files
      selectedFileIDs.forEach(addItemToArray)
    } else {
      // this is outside their previous selection
      // -> context menu entries should be applied to just this file
      addItemToArray(id)
    }

    let items: IMenuItem[] = [
      this.getDiscardChangesMenuItem(paths),
      { type: 'separator' },
      this.getIgnoreChangesMenuItem(paths)
    ]

    items = items.concat(this.getIgnoreExtensionsMenuItems(extensions))
    
    // Git LFS file locks
    if (isUsingLFS) {
      items.push({ type: 'separator' })
      items = items.concat(this.getFileLockMenuItems(paths))
    }

    items.push(
      { type: 'separator' },
      this.getCopyPathMenuItem(file),
      this.getRevealInFileManagerMenuItem(file),
      this.getOpenInExternalEditorMenuItem(file, enabled),
      {
        label: OpenWithDefaultProgramLabel,
        action: () => this.props.onOpenItem(path),
        enabled
      }
    )

    return items
  }

  private getRebaseContextMenu(
    file: WorkingDirectoryFileChange
  ): ReadonlyArray<IMenuItem> {
    const { path, status } = file

    const extension = Path.extname(path)
    const isSafeExtension = isSafeFileExtension(extension)

    const items = new Array<IMenuItem>()

    if (file.status.kind === AppFileStatusKind.Untracked) {
      items.push(this.getDiscardChangesMenuItem([file.path]), {
        type: 'separator',
      })
    }

    const enabled = isSafeExtension && status.kind !== AppFileStatusKind.Deleted

    items.push(
      this.getCopyPathMenuItem(file),
      this.getRevealInFileManagerMenuItem(file),
      this.getOpenInExternalEditorMenuItem(file, enabled),
      {
        label: OpenWithDefaultProgramLabel,
        action: () => this.props.onOpenItem(path),
        enabled,
      }
    )

    return items
  }

  private onItemContextMenu = (
    file: WorkingDirectoryFileChange,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    if (this.props.isCommitting) {
      return
    }

    event.preventDefault()

    const items =
      this.props.rebaseConflictState === null
        ? this.getDefaultContextMenu(file)
        : this.getRebaseContextMenu(file)

    showContextualMenu(items)
  }

  private getPlaceholderMessage(
    files: ReadonlyArray<WorkingDirectoryFileChange>,
    prepopulateCommitSummary: boolean
  ) {
    if (!prepopulateCommitSummary) {
      return 'Summary (required)'
    }

    const firstFile = files[0]
    const fileName = basename(firstFile.path)

    switch (firstFile.status.kind) {
      case AppFileStatusKind.New:
      case AppFileStatusKind.Untracked:
        return `Create ${fileName}`
      case AppFileStatusKind.Deleted:
        return `Delete ${fileName}`
      default:
        // TODO:
        // this doesn't feel like a great message for AppFileStatus.Copied or
        // AppFileStatus.Renamed but without more insight (and whether this
        // affects other parts of the flow) we can just default to this for now
        return `Update ${fileName}`
    }
  }

  private onScroll = (scrollTop: number, clientHeight: number) => {
    this.props.onChangesListScrolled(scrollTop)
  }

  private renderCommitMessageForm = (): JSX.Element => {
    const {
      rebaseConflictState,
      workingDirectory,
      repository,
      dispatcher,
      isCommitting,
      currentBranchProtected,
    } = this.props

    if (rebaseConflictState !== null) {
      const hasUntrackedChanges = workingDirectory.files.some(
        f => f.status.kind === AppFileStatusKind.Untracked
      )

      return (
        <ContinueRebase
          dispatcher={dispatcher}
          repository={repository}
          rebaseConflictState={rebaseConflictState}
          workingDirectory={workingDirectory}
          isCommitting={isCommitting}
          hasUntrackedChanges={hasUntrackedChanges}
        />
      )
    }

    const fileCount = workingDirectory.files.length

    const includeAllValue = getIncludeAllValue(
      workingDirectory,
      rebaseConflictState
    )

    const anyFilesSelected =
      fileCount > 0 && includeAllValue !== CheckboxValue.Off

    const filesSelected = workingDirectory.files.filter(
      f => f.selection.getSelectionType() !== DiffSelectionType.None
    )

    // When a single file is selected, we use a default commit summary
    // based on the file name and change status.
    // However, for onboarding tutorial repositories, we don't want to do this.
    // See https://github.com/desktop/desktop/issues/8354
    const prepopulateCommitSummary =
      filesSelected.length === 1 && !repository.isTutorialRepository

    // if this is not a github repo, we don't want to
    // restrict what the user can do at all
    const hasWritePermissionForRepository =
      this.props.repository.gitHubRepository === null ||
      hasWritePermission(this.props.repository.gitHubRepository)

    return (
      <CommitMessage
        onCreateCommit={this.props.onCreateCommit}
        branch={this.props.branch}
        gitHubUser={this.props.gitHubUser}
        commitAuthor={this.props.commitAuthor}
        anyFilesSelected={anyFilesSelected}
        repository={repository}
        dispatcher={dispatcher}
        commitMessage={this.props.commitMessage}
        focusCommitMessage={this.props.focusCommitMessage}
        autocompletionProviders={this.props.autocompletionProviders}
        isCommitting={isCommitting}
        showCoAuthoredBy={this.props.showCoAuthoredBy}
        coAuthors={this.props.coAuthors}
        placeholder={this.getPlaceholderMessage(
          filesSelected,
          prepopulateCommitSummary
        )}
        prepopulateCommitSummary={prepopulateCommitSummary}
        key={repository.id}
        currentBranchProtected={currentBranchProtected}
        hasWritePermissionForRepository={hasWritePermissionForRepository}
        shouldNudge={this.props.shouldNudgeToCommit}
      />
    )
  }

  private onStashEntryClicked = () => {
    const { isShowingStashEntry, dispatcher, repository } = this.props

    if (isShowingStashEntry) {
      dispatcher.selectWorkingDirectoryFiles(repository)

      // If the button is clicked, that implies the stash was not restored or discarded
      dispatcher.recordNoActionTakenOnStash()
    } else {
      dispatcher.selectStashedFile(repository)
      dispatcher.recordStashView()
    }
  }

  private renderStashedChanges() {
    if (!enableStashing()) {
      return null
    }
    if (this.props.stashEntry === null) {
      return null
    }

    const className = classNames(
      'stashed-changes-button',
      this.props.isShowingStashEntry ? 'selected' : null
    )

    return (
      <button
        className={className}
        onClick={this.onStashEntryClicked}
        tabIndex={0}
        aria-selected={this.props.isShowingStashEntry}
      >
        <Octicon className="stack-icon" symbol={StashIcon} />
        <div className="text">Stashed Changes</div>
        <Octicon symbol={OcticonSymbol.chevronRight} />
      </button>
    )
  }

  private onRowKeyDown = (
    _row: number,
    event: React.KeyboardEvent<HTMLDivElement>
  ) => {
    // The commit is already in-flight but this check prevents the
    // user from changing selection.
    if (
      this.props.isCommitting &&
      (event.key === 'Enter' || event.key === ' ')
    ) {
      event.preventDefault()
    }

    return
  }

  public render() {
    const fileCount = this.props.workingDirectory.files.length
    const filesPlural = fileCount === 1 ? 'file' : 'files'
    const filesDescription = `${fileCount} changed ${filesPlural}`
    const includeAllValue = getIncludeAllValue(
      this.props.workingDirectory,
      this.props.rebaseConflictState
    )

    const disableAllCheckbox =
      fileCount === 0 ||
      this.props.isCommitting ||
      this.props.rebaseConflictState !== null

    return (
      <div className="changes-list-container file-list">
        <div className="header" onContextMenu={this.onContextMenu}>
          <Checkbox
            label={filesDescription}
            value={includeAllValue}
            onChange={this.onIncludeAllChanged}
            disabled={disableAllCheckbox}
          />
        </div>
        <List
          id="changes-list"
          rowCount={this.props.workingDirectory.files.length}
          rowHeight={RowHeight}
          rowRenderer={this.renderRow}
          selectedRows={this.state.selectedRows}
          selectionMode="multi"
          onSelectionChanged={this.props.onFileSelectionChanged}
          invalidationProps={this.props.workingDirectory}
          onRowClick={this.props.onRowClick}
          onScroll={this.onScroll}
          setScrollTop={this.props.changesListScrollTop}
          onRowKeyDown={this.onRowKeyDown}
        />
        {this.renderStashedChanges()}
        {this.renderCommitMessageForm()}
      </div>
    )
  }
}
