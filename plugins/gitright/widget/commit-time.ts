/**
 * Every commit time string the user sees is produced here.
 *
 * The seam carries machine-readable time only — epoch seconds for history rows
 * and the date Git recorded, canonicalized to a strict ISO string, for commit
 * detail. Relative time follows the viewer's locale; the compact absolute time
 * follows the viewer's timezone and is locale-independent.
 */

import type { GitRightLocale } from "./localization.ts";

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

export function formatRelativeTime(
  committerTime: number,
  snapshotTime: number,
  locale: GitRightLocale,
): string {
  const seconds = Math.max(0, snapshotTime - committerTime);
  const units: Array<[number, string, string]> = [
    [31_536_000, "year", "年"],
    [2_592_000, "month", "か月"],
    [86_400, "day", "日"],
    [3_600, "hour", "時間"],
    [60, "minute", "分"],
  ];
  for (const [size, english, japanese] of units) {
    if (seconds >= size) {
      const count = Math.floor(seconds / size);
      return locale === "ja"
        ? `${count}${japanese}前`
        : `${count} ${plural(count, english)} ago`;
    }
  }
  if (seconds < 5) return locale === "ja" ? "たった今" : "just now";
  return locale === "ja" ? `${seconds}秒前` : `${seconds} seconds ago`;
}

/**
 * The field order is fixed rather than delegated to `dateStyle` / `timeStyle`,
 * whose output shifts between ICU versions; only the timezone follows the
 * viewer's environment. `timeZone` is for tests that need a fixed zone — the
 * widget omits it so the viewer's own zone applies.
 */
export function formatCommitTimestamp(recorded: string, timeZone?: string): string {
  const instant = new Date(recorded);
  if (Number.isNaN(instant.getTime())) return fallbackTimestamp(recorded);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const field = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = field("year");
  const month = field("month");
  const day = field("day");
  const hour = field("hour");
  const minute = field("minute");
  if (!year || !month || !day || !hour || !minute) return fallbackTimestamp(recorded);
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/** A date the viewer's environment cannot interpret is shown as recorded. */
function fallbackTimestamp(recorded: string): string {
  const match = recorded.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}` : recorded;
}
