import * as Path from 'path';
import * as fs from 'fs';
import * as chokidar from 'chokidar';
import * as React from 'react';
import * as Git from 'nodegit';
import { GraphViewer } from './graph-viewer';
import { CommitViewer } from './commit-viewer';
import { IndexViewer } from './index-viewer';
import { PatchViewer, PatchViewerOptions } from './patch-viewer';
import { Splitter } from './splitter';
import { Toolbar } from './toolbar';
import { RepoState, PatchType } from '../helpers/repo-state';
import { ReferenceExplorer } from './reference-explorer';

export interface RepoDashboardProps { 
  repo: RepoState;
  editorTheme: string;
  patchViewerOptions: PatchViewerOptions;
  onRepoClose: () => void;
  onCreateBranch: (commit: Git.Commit) => void;
}

export interface RepoDashboardState { 
  selectedCommit: Git.Commit | null;
  selectedPatch: Git.ConvenientPatch | null;
  patchType: PatchType;
}

export class RepoDashboard extends React.PureComponent<RepoDashboardProps, RepoDashboardState> {
  graphViewer: React.RefObject<GraphViewer>;
  leftViewer: React.RefObject<ReferenceExplorer>;
  rightViewer: React.RefObject<CommitViewer | IndexViewer>;
  repositoryWatcher: fs.FSWatcher;
  dirtyWorkingDirectory: boolean;
  workingDirectoryWatcher: chokidar.FSWatcher;
  workingDirectoryTimer: NodeJS.Timer;
  referencesWatcher: chokidar.FSWatcher;

  constructor(props: RepoDashboardProps) {
    super(props);
    this.graphViewer = React.createRef();
    this.leftViewer = React.createRef();
    this.rightViewer = React.createRef();
    this.dirtyWorkingDirectory = false;
    this.handleCommitSelect = this.handleCommitSelect.bind(this);
    this.handleIndexSelect = this.handleIndexSelect.bind(this);
    this.handlePatchSelect = this.handlePatchSelect.bind(this);
    this.exitPatchViewer = this.exitPatchViewer.bind(this);
    this.handleLeftPanelResize = this.handleLeftPanelResize.bind(this);
    this.handleRightPanelResize = this.handleRightPanelResize.bind(this);
    this.state = {
      selectedCommit: null,
      selectedPatch: null,
      patchType: PatchType.Committed
    };
  }

  async componentDidMount() {
    await this.props.repo.init();
    if (!this.state.selectedCommit && this.rightViewer.current) {
      const indexViewer = this.rightViewer.current as IndexViewer;
      await indexViewer.refresh();
    }
    if (this.graphViewer.current) {
      this.graphViewer.current.updateGraph();
    }
    this.setWatchers();
  }

  componentWillUnmount() {
    if (this.repositoryWatcher) {
      this.repositoryWatcher.close();
    }
    if (this.workingDirectoryWatcher) {
      this.workingDirectoryWatcher.close();
    }
    if (this.workingDirectoryTimer) {
      clearInterval(this.workingDirectoryTimer);
    }
    if (this.referencesWatcher) {
      this.referencesWatcher.close();
    }
  }

  handleCommitSelect(commit: Git.Commit) {
    this.setState({
      selectedCommit: commit
    });
  }

  handleIndexSelect() {
    this.setState({
      selectedCommit: null
    });
  }

  handlePatchSelect(patch: Git.ConvenientPatch | null, type: PatchType) {
    this.setState({
      selectedPatch: patch,
      patchType: type
    });
  }

  exitPatchViewer() {
    this.setState({
      selectedPatch: null
    });
  }

  handleLeftPanelResize(offset: number) {
    if (this.leftViewer.current) {
      this.leftViewer.current.resize(offset);
    }
  }

  handleRightPanelResize(offset: number) {
    if (this.rightViewer.current) {
      this.rightViewer.current.resize(offset);
    }
  }
  
  setWatchers() {
    const path = this.props.repo.path;
    // Watch index and head 
    // fs.watch seems sufficient for that, I should try with chokidar
    this.repositoryWatcher = fs.watch(path, async (error: string, filename: string) => {
      if (filename === 'index') {
        this.refreshIndex();
      } else if (filename === 'HEAD') {
        await this.refreshHead();
        this.refreshIndex();
      }
    });

    // Watch working directory
    // It seems to work much better on big repo with polling
    const wdPath = this.props.repo.repo.workdir();
    this.workingDirectoryWatcher = chokidar.watch(wdPath, {
      ignoreInitial: true,
      ignored: [/(.*\.git(\/.*|$))/, (path: string) => this.props.repo.isIgnored(Path.relative(wdPath, path))],
      followSymlinks: false,
      usePolling: true,
      interval: 200,
      binaryInterval: 500
    });
    this.workingDirectoryWatcher.on('all', async (event: string, path: string) => {
      if (path.endsWith('.gitignore')) {
        this.props.repo.updateIgnore();
      }
      this.dirtyWorkingDirectory = true;
    });
    // To prevent from updating too often
    this.workingDirectoryTimer = setInterval(async () => {
      if (this.dirtyWorkingDirectory) {
        this.refreshIndex();
        this.dirtyWorkingDirectory = false;
      }
    }, 200);

    // Watch references
    this.referencesWatcher = chokidar.watch(Path.join(path, 'refs'), {
      ignoreInitial: true,
      ignored: /.*\.lock$/,
      followSymlinks: false
    });
    this.referencesWatcher.on('all', async (event: string, path: string) => {
      await this.refreshReferences();
      this.refreshIndex();
    });
  }

  async refreshIndex() {
    if (!this.state.selectedCommit && this.rightViewer.current) {
      const indexViewer = this.rightViewer.current as IndexViewer;
      await indexViewer.refresh();
      if (this.state.selectedPatch && this.state.patchType !== PatchType.Committed) {
        indexViewer.refreshSelectedPatch(this.state.patchType === PatchType.Unstaged);
      }
    }
  }

  async refreshHead() {
    await this.props.repo.updateHead();
    await this.props.repo.updateGraph();
    if (this.graphViewer.current) {
      this.graphViewer.current.updateGraph();
    }
  }

  async refreshReferences() {
    // TODO: update only references that changed
    await this.props.repo.requestUpdateCommits();
    await this.props.repo.updateHead();
    await this.props.repo.updateGraph();
    if (this.graphViewer.current) {
      this.graphViewer.current.updateGraph();
    }
    // If the selected commit is removed, switch to index
    if (this.state.selectedCommit && 
      !this.props.repo.shaToCommit.has(this.state.selectedCommit.sha())) {
        this.handleIndexSelect();
    }
  }

  render() {
    let middleViewer; 
    if (this.state.selectedPatch) {
      middleViewer = <PatchViewer repo={this.props.repo} 
        patch={this.state.selectedPatch!} 
        type={this.state.patchType}
        editorTheme={this.props.editorTheme}
        options={this.props.patchViewerOptions}
        onClose={this.exitPatchViewer} /> 
    } else {
      middleViewer = <GraphViewer repo={this.props.repo} 
        selectedCommit={this.state.selectedCommit} 
        onCommitSelect={this.handleCommitSelect}
        onIndexSelect={this.handleIndexSelect} 
        onCreateBranch={this.props.onCreateBranch}
        ref={this.graphViewer} />
    }
    let rightViewer;
    if (this.state.selectedCommit) {
      rightViewer = <CommitViewer repo={this.props.repo}
        commit={this.state.selectedCommit} 
        selectedPatch={this.state.selectedPatch} 
        onCommitSelect={this.handleCommitSelect}
        onPatchSelect={this.handlePatchSelect} 
        ref={this.rightViewer as React.RefObject<CommitViewer>} />
    } else {
      rightViewer = <IndexViewer repo={this.props.repo} 
        selectedPatch={this.state.selectedPatch} 
        onPatchSelect={this.handlePatchSelect} 
        ref={this.rightViewer as React.RefObject<IndexViewer>} />
    }
    return (
      <div className='repo-dashboard'>
        <Toolbar repo={this.props.repo} 
          selectedCommit={this.state.selectedCommit} 
          onRepoClose={this.props.onRepoClose} 
          onCreateBranch={this.props.onCreateBranch} />
        <div className='repo-content'>
          <ReferenceExplorer repo={this.props.repo} ref={this.leftViewer} />
          <Splitter onDrag={this.handleLeftPanelResize} />
          {middleViewer}
          <Splitter onDrag={this.handleRightPanelResize} />
          {rightViewer}
        </div>
      </div>
    );
  }
}