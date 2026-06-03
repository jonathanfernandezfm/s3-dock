export function filterNonEmptyWorkspaceGroups<W, G>(
  workspaceGroups: Array<{ workspace: W; groups: G[] }>
): Array<{ workspace: W; groups: G[] }> {
  return workspaceGroups.filter(({ groups }) => groups.length > 0);
}
