/**
 * The seam contract: what crosses between the GitRight server and its widget.
 *
 * The shapes live in `payloads.ts` and are written once. This module exposes
 * the three things derived from them:
 *
 * - `outputSchemas` — the JSON Schema the server advertises to the host.
 * - `validate` — whether a payload received by the widget satisfies the shape.
 * - `restoreOmittedNulls` — explicit nulls for nullable fields a host omitted.
 */

import * as payloads from "./payloads.ts";

export const outputSchemas = {
  launch: payloads.launch.toJsonSchema(),
  repositoryState: payloads.repositoryState.toJsonSchema(),
  history: payloads.history.toJsonSchema(),
  historyPage: payloads.historyPage.toJsonSchema(),
  commitDetail: payloads.commitDetail.toJsonSchema(),
  changedFilePage: payloads.changedFilePageOutput.toJsonSchema(),
  fileDiff: payloads.fileDiff.toJsonSchema(),
};

export const validate = {
  repositoryState: (value: unknown): boolean => payloads.repositoryState.check(value),
  historySnapshot: (value: unknown): boolean => payloads.readyHistory.check(value),
  historyPage: (value: unknown): boolean => payloads.readyHistoryPage.check(value),
  historyChanged: (value: unknown): boolean => payloads.historyChanged.check(value),
  // The widget reports history and page failures through one notice, so this
  // accepts either tool's bounded error.
  historyError: (value: unknown): boolean =>
    payloads.getHistoryError.check(value) || payloads.historyPageError.check(value),
  commitDetail: (value: unknown): boolean => payloads.readyCommitDetail.check(value),
  // Likewise for commit detail and its changed-file pages.
  commitDetailError: (value: unknown): boolean =>
    payloads.getCommitDetailError.check(value) || payloads.changedFilePageError.check(value),
  changedFilePage: (value: unknown): boolean => payloads.changedFilePage.check(value),
  fileDiff: (value: unknown): boolean => payloads.readyFileDiff.check(value),
  fileDiffError: (value: unknown): boolean => payloads.fileDiffError.check(value),
};

export const restoreOmittedNulls = {
  repositoryState: (value: unknown): unknown => payloads.repositoryState.restore(value),
  history: (value: unknown): unknown => payloads.history.restore(value),
  historyPage: (value: unknown): unknown => payloads.historyPage.restore(value),
  commitDetail: (value: unknown): unknown => payloads.commitDetail.restore(value),
  changedFilePage: (value: unknown): unknown =>
    payloads.changedFilePageOutput.restore(value),
  fileDiff: (value: unknown): unknown => payloads.fileDiff.restore(value),
};
