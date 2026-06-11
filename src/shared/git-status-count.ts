export interface GitChangeLike {
  uri?: { toString(): string };
  resourceUri?: { toString(): string };
}

export interface GitRepositoryStateLike {
  mergeChanges?: GitChangeLike[];
  indexChanges?: GitChangeLike[];
  workingTreeChanges?: GitChangeLike[];
  untrackedChanges?: GitChangeLike[];
}

export function countGitChanges(state: GitRepositoryStateLike): number {
  const changed = new Set<string>();
  for (const group of [
    state.mergeChanges,
    state.indexChanges,
    state.workingTreeChanges,
    state.untrackedChanges,
  ]) {
    for (const item of group ?? []) {
      const key = (item.uri ?? item.resourceUri)?.toString();
      if (key) changed.add(key);
    }
  }
  return changed.size;
}
