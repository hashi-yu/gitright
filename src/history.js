export function summarizeCommit(commit) {
  return `${commit.hash.slice(0, 7)} ${commit.subject}`;
}

export function formatGraphRow(commit) {
  const labels = commit.refs.length > 0 ? ` (${commit.refs.join(", ")})` : "";
  return `${commit.graph} ${summarizeCommit(commit)}${labels}`;
}

export function summarizeChanges(files) {
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  return `${files.length} files, +${additions} -${deletions}`;
}
