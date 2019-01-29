import * as React from 'react';
import * as Git from 'nodegit';
import { ReferenceBadge } from './reference-badge';
import { RepoState } from "../repo-state";

export interface CommitItemProps { 
  repo: RepoState;
  references: string[];
  commit: Git.Commit;
  selected: boolean;
  color: string;
  onCommitSelect: (commit: Git.Commit) => void;
}

export class CommitItem extends React.PureComponent<CommitItemProps, {}> {
  constructor(props: CommitItemProps) {
    super(props);
    this.handleClick = this.handleClick.bind(this);
  }

  handleClick(event: React.MouseEvent<HTMLLIElement>) {
    this.props.onCommitSelect(this.props.commit);
  }

  render() {
    const badges = this.props.references.map((name) => (
      <ReferenceBadge name={name} color={this.props.color} key={name} />
    ));
      return (
        <span key={reference} className='reference' style={style}>
          {removeBranchPrefix(reference)}
        {badges}{this.props.commit.message()}
      );
    });
    return (
      <li className={this.props.selected ? 'selected-commit' : ''} onClick={this.handleClick}>
        {spans}{this.props.commit.message()}
      </li>
    );
  }
}