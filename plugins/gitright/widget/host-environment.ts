import { resolveLocale, type GitRightLocale } from "./localization.ts";
import type { DisplayMode } from "./launcher-state.ts";

export type HostSafeArea = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type HostEnvironment = {
  locale: GitRightLocale;
  theme: "light" | "dark";
  displayMode: DisplayMode;
  maxHeight: number | null;
  safeArea: HostSafeArea;
};

type HostGlobals = {
  locale?: unknown;
  theme?: unknown;
  displayMode?: unknown;
  maxHeight?: unknown;
  safeArea?: unknown;
};

type HostFallbacks = {
  globals?: HostGlobals;
  navigatorLanguage?: string;
  prefersDark?: boolean;
};

const zeroSafeArea: HostSafeArea = { top: 0, right: 0, bottom: 0, left: 0 };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function displayMode(value: unknown): DisplayMode | undefined {
  return value === "inline" || value === "pip" || value === "fullscreen" ? value : undefined;
}

function boundedPixels(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100_000
    ? value
    : undefined;
}

function safeArea(value: unknown, fallback: HostSafeArea): HostSafeArea {
  const outer = record(value);
  const candidate = outer.insets === undefined ? outer : record(outer.insets);
  return {
    top: boundedPixels(candidate.top) ?? fallback.top,
    right: boundedPixels(candidate.right) ?? fallback.right,
    bottom: boundedPixels(candidate.bottom) ?? fallback.bottom,
    left: boundedPixels(candidate.left) ?? fallback.left,
  };
}

export function resolveHostEnvironment(
  value: unknown,
  fallbacks: HostFallbacks = {},
  previous?: HostEnvironment,
): HostEnvironment {
  const candidate = record(value);
  const context = candidate.hostContext === undefined ? candidate : record(candidate.hostContext);
  const globals = record(fallbacks.globals);
  const globalSafeArea = safeArea(globals.safeArea, previous?.safeArea ?? zeroSafeArea);
  const contextDimensions = record(context.containerDimensions);
  const fallbackLocale = previous?.locale ??
    (typeof globals.locale === "string" ? globals.locale : fallbacks.navigatorLanguage);
  const locale = typeof context.locale === "string"
    ? context.locale
    : fallbackLocale;
  const fallbackTheme = previous?.theme ??
    (globals.theme === "light" || globals.theme === "dark"
      ? globals.theme
      : fallbacks.prefersDark ? "dark" : "light");
  const theme = context.theme === "light" || context.theme === "dark"
    ? context.theme
    : fallbackTheme;
  const contextMaxHeight = boundedPixels(contextDimensions.maxHeight) ??
    boundedPixels(context.maxHeight);
  const contextSafeArea = context.safeAreaInsets ?? context.safeArea;

  return {
    locale: resolveLocale(locale),
    theme,
    displayMode: displayMode(context.displayMode) ?? previous?.displayMode ??
      displayMode(globals.displayMode) ?? "inline",
    maxHeight: contextMaxHeight ?? previous?.maxHeight ?? boundedPixels(globals.maxHeight) ?? null,
    safeArea: contextSafeArea === undefined
      ? previous?.safeArea ?? globalSafeArea
      : safeArea(contextSafeArea, previous?.safeArea ?? globalSafeArea),
  };
}

export function hostEnvironmentPresentation(environment: HostEnvironment) {
  return {
    lang: environment.locale,
    theme: environment.theme,
    displayMode: environment.displayMode,
    properties: {
      "--host-max-height": environment.maxHeight === null ? "none" : `${environment.maxHeight}px`,
      "--host-safe-area-top": `${environment.safeArea.top}px`,
      "--host-safe-area-right": `${environment.safeArea.right}px`,
      "--host-safe-area-bottom": `${environment.safeArea.bottom}px`,
      "--host-safe-area-left": `${environment.safeArea.left}px`,
    },
  } as const;
}
