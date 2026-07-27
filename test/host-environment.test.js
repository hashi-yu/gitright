import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hostEnvironmentPresentation,
  resolveHostEnvironment,
} from "../plugins/gitright/widget/host-environment.ts";

test("resolves complete initial host context with bounded layout values", () => {
  assert.deepEqual(
    resolveHostEnvironment(
      {
        hostContext: {
          locale: "ja-JP",
          theme: "dark",
          displayMode: "fullscreen",
          containerDimensions: { maxHeight: 840 },
          safeAreaInsets: { top: 8, right: 7, bottom: 6, left: 5 },
        },
      },
      {
        globals: {},
        navigatorLanguage: "en-US",
        prefersDark: false,
      },
    ),
    {
      locale: "ja",
      theme: "dark",
      displayMode: "fullscreen",
      maxHeight: 840,
      safeArea: { top: 8, right: 7, bottom: 6, left: 5 },
    },
  );
});

test("falls back predictably and rejects invalid host layout values", () => {
  assert.deepEqual(
    resolveHostEnvironment(
      {
        hostContext: {
          locale: "fr-FR",
          theme: "unknown",
          displayMode: "floating",
          maxHeight: -1,
          safeArea: { top: Number.POSITIVE_INFINITY, right: -2, bottom: "3", left: 4 },
        },
      },
      {
        globals: {
          locale: "en-GB",
          theme: "light",
          displayMode: "inline",
          maxHeight: 900,
          safeArea: { insets: { top: 1, right: 2, bottom: 3, left: 4 } },
        },
        navigatorLanguage: "ja-JP",
        prefersDark: true,
      },
    ),
    {
      locale: "en",
      theme: "light",
      displayMode: "inline",
      maxHeight: 900,
      safeArea: { top: 1, right: 2, bottom: 3, left: 4 },
    },
  );
});

test("merges partial standard notifications without resetting prior geometry", () => {
  const previous = {
    locale: "ja",
    theme: "light",
    displayMode: "fullscreen",
    maxHeight: 840,
    safeArea: { top: 8, right: 7, bottom: 6, left: 5 },
  };
  assert.deepEqual(
    resolveHostEnvironment(
      { theme: "dark", safeAreaInsets: { top: 10 } },
      { globals: {}, navigatorLanguage: "en-US", prefersDark: false },
      previous,
    ),
    {
      ...previous,
      theme: "dark",
      safeArea: { ...previous.safeArea, top: 10 },
    },
  );
});

test("maps host layout to stable DOM attributes and CSS custom properties", () => {
  assert.deepEqual(
    hostEnvironmentPresentation({
      locale: "ja",
      theme: "dark",
      displayMode: "fullscreen",
      maxHeight: 840,
      safeArea: { top: 8, right: 7, bottom: 6, left: 5 },
    }),
    {
      lang: "ja",
      theme: "dark",
      displayMode: "fullscreen",
      properties: {
        "--host-max-height": "840px",
        "--host-safe-area-top": "8px",
        "--host-safe-area-right": "7px",
        "--host-safe-area-bottom": "6px",
        "--host-safe-area-left": "5px",
      },
    },
  );
});
