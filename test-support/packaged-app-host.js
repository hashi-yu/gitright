import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright-core";

import { createMcpClient } from "./mcp-client.js";
import { pluginRoot } from "./plugin-process.js";

const launcher = path.join(pluginRoot, "dist/launch");
const defaultChromePaths = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

function chromeExecutable() {
  const executable = process.env.GITRIGHT_CHROMIUM_PATH ??
    defaultChromePaths.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error(
      "Chrome or Chromium is required; set GITRIGHT_CHROMIUM_PATH to its executable",
    );
  }
  return executable;
}

function createPackagedClient(serverEnvironment = {}) {
  let stderr = "";
  const temporaryRootPromise = mkdtemp(path.join(tmpdir(), "gitright-packaged-host-"));
  let child;
  let client;
  let completion;

  async function start() {
    const temporaryRoot = await temporaryRootPromise;
    child = spawn(launcher, [], {
      cwd: pluginRoot,
      env: {
        HOME: path.join(temporaryRoot, "home"),
        PATH: process.env.PATH,
        ...serverEnvironment,
      },
    });
    client = createMcpClient({
      input: child.stdout,
      output: child.stdin,
      closedError: ({ code, signal }) => new Error(
        `packaged MCP process closed before responding (code=${code}, signal=${signal})`,
      ),
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    completion = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => {
        client.processClosed({ code, signal });
        resolve({ code, signal });
      });
    });
  }

  async function request(method, params = {}) {
    if (!child) await start();
    const response = await client.request(method, params);
    if (response.error) {
      const error = new Error(response.error.message ?? "packaged MCP request failed");
      error.cause = response.error;
      throw error;
    }
    return response.result;
  }

  async function notify(method, params = {}) {
    if (!child) await start();
    client.notify(method, params);
  }

  async function close() {
    if (!child) return;
    child.stdin.end();
    const result = await completion;
    if (result.code !== 0 || result.signal !== null || stderr !== "") {
      throw new Error(
        `packaged MCP process did not close cleanly: ${JSON.stringify({ ...result, stderr })}`,
      );
    }
  }

  return { request, notify, close };
}

function safeAreaInsets(context, fallback = { top: 0, right: 0, bottom: 0, left: 0 }) {
  const candidate = context?.safeAreaInsets ?? context?.safeArea?.insets ?? context?.safeArea ?? {};
  return {
    top: candidate.top ?? fallback.top,
    right: candidate.right ?? fallback.right,
    bottom: candidate.bottom ?? fallback.bottom,
    left: candidate.left ?? fallback.left,
  };
}

function normalizeHostContext(context, previous) {
  return {
    locale: context?.locale ?? previous?.locale ?? "en-US",
    theme: context?.theme ?? previous?.theme ?? "light",
    displayMode: context?.displayMode ?? previous?.displayMode ?? "inline",
    containerDimensions: {
      maxHeight: context?.containerDimensions?.maxHeight ?? context?.maxHeight ??
        previous?.containerDimensions?.maxHeight ?? 900,
    },
    safeAreaInsets: safeAreaInsets(context, previous?.safeAreaInsets),
    // Standard host global, published outside the host context: hosts
    // that expose their own surface color let the widget paint against
    // it instead of against its own.
    surfaceBackgroundColor: context?.surfaceBackgroundColor ??
      previous?.surfaceBackgroundColor ?? null,
  };
}

function hostContextPatch(context) {
  const patch = {};
  if (context && Object.hasOwn(context, "locale")) patch.locale = context.locale;
  if (context && Object.hasOwn(context, "theme")) patch.theme = context.theme;
  if (context && Object.hasOwn(context, "displayMode")) patch.displayMode = context.displayMode;
  if (context?.containerDimensions || Object.hasOwn(context ?? {}, "maxHeight")) {
    patch.containerDimensions = {
      maxHeight: context?.containerDimensions?.maxHeight ?? context?.maxHeight,
    };
  }
  if (context?.safeAreaInsets || context?.safeArea) {
    const candidate = context.safeAreaInsets ?? context.safeArea?.insets ?? context.safeArea;
    patch.safeAreaInsets = {};
    for (const edge of ["top", "right", "bottom", "left"]) {
      if (candidate && Object.hasOwn(candidate, edge)) patch.safeAreaInsets[edge] = candidate[edge];
    }
  }
  return patch;
}

function openAiGlobals(context) {
  return {
    locale: context.locale,
    theme: context.theme,
    displayMode: context.displayMode,
    maxHeight: context.containerDimensions.maxHeight,
    safeArea: { insets: context.safeAreaInsets },
    surfaceBackgroundColor: context.surfaceBackgroundColor,
  };
}

function normalizeDisplayModeScript(request) {
  if (!request) return [{ outcome: "resolve", mode: "fullscreen" }];
  return Array.isArray(request) ? request : [request];
}

async function discoverResource(client) {
  await client.request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "gitright-packaged-browser-host", version: "1" },
  });
  await client.notify("notifications/initialized");
  const listed = await client.request("resources/list");
  const candidates = listed.resources.filter(
    (resource) => resource.mimeType === "text/html;profile=mcp-app",
  );
  if (candidates.length !== 1) {
    throw new Error(`expected one packaged MCP app resource, received ${candidates.length}`);
  }
  const read = await client.request("resources/read", { uri: candidates[0].uri });
  const resource = read.contents.find((content) => content.uri === candidates[0].uri);
  if (!resource || typeof resource.text !== "string") {
    throw new Error("packaged MCP app resource did not include HTML text");
  }
  return resource;
}

export async function startPackagedAppHost({
  trustedRepositoryContext,
  viewport = { width: 380, height: 900 },
  hostContext: initialHostContext,
  hostCapabilities = { updateModelContext: { text: {} } },
  widgetState = null,
  displayModeRequest,
  toolCallScript = {},
  historySnapshotTime,
  serverEnvironment = {},
  reducedMotion = "reduce",
} = {}) {
  if (!path.isAbsolute(trustedRepositoryContext ?? "")) {
    throw new TypeError("trustedRepositoryContext must be one absolute repository path");
  }

  const client = createPackagedClient(serverEnvironment);
  let browser;
  let context;
  let page;
  let closed = false;
  const messages = [];
  const networkRequests = [];
  let hostContext = normalizeHostContext(initialHostContext);
  let persistedWidgetState = widgetState;
  const scriptedToolCalls = new Map(
    Object.entries(toolCallScript).map(([name, steps]) => [name, [...steps]]),
  );

  try {
    const resource = await discoverResource(client);
    const initialToolResult = await client.request("tools/call", {
      name: "open_gitright",
      arguments: {},
      _meta: {
        "x-codex-turn-metadata": { workspaces: { [trustedRepositoryContext]: {} } },
      },
    });

    const browserExecutablePath = chromeExecutable();
    browser = await chromium.launch({
      executablePath: browserExecutablePath,
      headless: true,
      args: [
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-sync",
        "--metrics-recording-only",
        "--no-first-run",
        // Pixel-deterministic rasterization for the pinned visual baseline
        // without these, antialiased corners and blurred
        // shadows flip a few pixels between otherwise identical captures.
        "--deterministic-mode",
        "--disable-lcd-text",
        "--disable-partial-raster",
        "--disable-skia-runtime-opts",
        "--force-color-profile=srgb",
      ],
    });
    context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      reducedMotion,
      // The widget formats absolute commit times in the viewer's timezone, so
      // the fixture pins one instead of inheriting the runner's.
      timezoneId: "UTC",
    });
    await context.route(/^https?:/, (route) => {
      networkRequests.push(route.request().url());
      return route.abort("blockedbyclient");
    });
    await context.addInitScript(
      ({ openaiContext, initialWidgetState, requestAvailable }) => {
        if (window === window.parent) return;
        const openai = {
          locale: openaiContext.locale,
          theme: openaiContext.theme,
          displayMode: openaiContext.displayMode,
          maxHeight: openaiContext.containerDimensions.maxHeight,
          safeArea: { insets: openaiContext.safeAreaInsets },
          surfaceBackgroundColor: openaiContext.surfaceBackgroundColor ?? undefined,
          widgetState: structuredClone(
            Object.hasOwn(window.parent, "__gitrightPersistedWidgetState")
              ? window.parent.__gitrightPersistedWidgetState
              : initialWidgetState,
          ),
        };
        openai.setWidgetState = (state) => {
          openai.widgetState = structuredClone(state);
          window.parent.postMessage({
            jsonrpc: "2.0",
            method: "host/set-widget-state",
            params: { widgetState: state },
          }, "*");
        };
        if (requestAvailable) {
          openai.requestDisplayMode = (request) => {
            window.parent.postMessage({
              jsonrpc: "2.0",
              method: "host/request-display-mode",
              params: request,
            }, "*");
            const behavior = window.parent.__gitrightDisplayModeScript.shift() ?? {
              outcome: "resolve",
              mode: "fullscreen",
            };
            if (behavior.outcome === "throw") throw new Error("scripted display-mode failure");
            const settle = () => {
              if (behavior.outcome === "reject") {
                return Promise.reject(new Error("scripted display-mode rejection"));
              }
              if (behavior.outcome === "undefined") return Promise.resolve(undefined);
              return Promise.resolve({ mode: behavior.mode });
            };
            if (!behavior.delayMs) return settle();
            return new Promise((resolve, reject) => {
              setTimeout(() => settle().then(resolve, reject), behavior.delayMs);
            });
          };
        }
        Object.defineProperty(window, "openai", {
          configurable: true,
          value: openai,
        });
      },
      {
        openaiContext: hostContext,
        initialWidgetState: persistedWidgetState,
        requestAvailable: displayModeRequest?.outcome !== "missing",
      },
    );

    page = await context.newPage();
    let resolveInitialized = () => undefined;
    let rejectInitialized = () => undefined;
    let initialized;
    const prepareInitialization = () => {
      initialized = new Promise((resolve, reject) => {
        resolveInitialized = resolve;
        rejectInitialized = reject;
      });
    };
    const record = (direction, message) => {
      messages.push({ direction, message: structuredClone(message) });
    };
    const respond = (message) => {
      record("host-to-widget", message);
      return message;
    };
    await page.exposeFunction("__gitrightHandleMessage", async (message) => {
      record("widget-to-host", message);
      if (!message || message.jsonrpc !== "2.0") return null;
      if (message.method === "ui/notifications/initialized") resolveInitialized();
      if (message.method === "ui/initialize" && typeof message.id === "number") {
        return respond({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2026-01-26",
            hostInfo: { name: "gitright-packaged-browser-host", version: "1" },
            hostCapabilities,
            hostContext,
            widgetState: persistedWidgetState,
          },
        });
      }
      if (message.method === "tools/call" && typeof message.id === "number") {
        try {
          const steps = scriptedToolCalls.get(message.params?.name);
          const step = steps?.shift();
          if (step?.delayMs) {
            await new Promise((resolve) => setTimeout(resolve, step.delayMs));
          }
          let result = step && Object.hasOwn(step, "result")
            ? structuredClone(step.result)
            : await client.request("tools/call", message.params);
          if (
            message.params?.name === "get_history" &&
            Number.isSafeInteger(historySnapshotTime) &&
            result?.structuredContent?.status === "ready"
          ) {
            result = structuredClone(result);
            result.structuredContent.snapshotTime = historySnapshotTime;
          }
          return respond({ jsonrpc: "2.0", id: message.id, result });
        } catch (error) {
          return respond({
            jsonrpc: "2.0",
            id: message.id,
            error: error.cause ?? { code: -32603, message: error.message },
          });
        }
      }
      if (message.method === "host/set-widget-state") {
        persistedWidgetState = message.params?.widgetState ?? null;
      }
      return typeof message.id === "number"
        ? respond({ jsonrpc: "2.0", id: message.id, result: {} })
        : null;
    });
    await page.setContent(`<!doctype html>
      <meta charset="utf-8">
      <style>
        html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
        iframe { display: block; border: 0; width: 100%; height: 100%; }
      </style>
      <iframe id="gitright-widget" title="GitRight packaged app"></iframe>
      <script>
        window.__gitrightDisplayModeScript = ${JSON.stringify(
          normalizeDisplayModeScript(displayModeRequest),
        )};
        const widget = document.getElementById("gitright-widget");
        window.addEventListener("message", async (event) => {
          if (event.source !== widget.contentWindow) return;
          const response = await window.__gitrightHandleMessage(event.data);
          if (response) event.source.postMessage(response, "*");
        });
      </script>`);
    await page.evaluate((state) => {
      window.__gitrightPersistedWidgetState = structuredClone(state);
    }, persistedWidgetState);

    async function sendToWidget(message) {
      record("host-to-widget", message);
      await page.locator("#gitright-widget").evaluate((iframe, value) => {
        iframe.contentWindow.postMessage(value, "*");
      }, message);
    }

    const widget = page.frameLocator("#gitright-widget");
    async function mountWidget({ clearExisting = false } = {}) {
      if (clearExisting) {
        await page.locator("#gitright-widget").evaluate((iframe) => {
          iframe.srcdoc = "<!doctype html><title>Remounting GitRight</title>";
        });
        await widget.locator("#gitright-root").waitFor({ state: "detached" });
      }
      await page.evaluate((state) => {
        window.__gitrightPersistedWidgetState = structuredClone(state);
      }, persistedWidgetState);
      prepareInitialization();
      await page.locator("#gitright-widget").evaluate((iframe, html) => {
        iframe.srcdoc = html;
      }, resource.text);
      await widget.locator("#gitright-root").waitFor({ state: "attached" });
      const initializationTimeout = setTimeout(
        () => rejectInitialized(new Error("widget bridge initialization timed out")),
        10_000,
      );
      try {
        await initialized;
      } finally {
        clearTimeout(initializationTimeout);
      }
      await sendToWidget({
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: initialToolResult,
      });
    }

    await mountWidget();

    async function updateOpenAiGlobals(update) {
      await page.locator("#gitright-widget").evaluate((iframe, next) => {
        const frameWindow = iframe.contentWindow;
        if (!frameWindow.openai) return;
        Object.assign(frameWindow.openai, structuredClone(next));
        frameWindow.dispatchEvent(new frameWindow.CustomEvent("openai:set_globals", {
          detail: { globals: frameWindow.openai },
        }));
      }, update);
    }

    return {
      resource,
      initialToolResult,
      page,
      browserInfo: {
        engine: "chromium",
        version: browser.version(),
        executablePath: browserExecutablePath,
      },
      messages,
      networkRequests,
      widget,
      async setHostContext(nextContext) {
        const patch = hostContextPatch(nextContext);
        // The surface color is a host global rather than part of the
        // context notification, so it travels beside the patch.
        hostContext = normalizeHostContext(
          { ...patch, surfaceBackgroundColor: nextContext?.surfaceBackgroundColor },
          hostContext,
        );
        await updateOpenAiGlobals(openAiGlobals(hostContext));
        await sendToWidget({
          jsonrpc: "2.0",
          method: "ui/notifications/host-context-changed",
          params: patch,
        });
      },
      async setWidgetState(nextWidgetState) {
        persistedWidgetState = nextWidgetState;
        await updateOpenAiGlobals({ widgetState: persistedWidgetState });
      },
      async remount() {
        await mountWidget({ clearExisting: true });
      },
      async scriptDisplayMode(...requests) {
        await page.evaluate((script) => {
          window.__gitrightDisplayModeScript = script;
        }, requests.flat());
      },
      async setViewport(nextViewport) {
        await page.setViewportSize(nextViewport);
      },
      async focusWidget() {
        await page.locator("#gitright-widget").focus();
      },
      async pressKey(key) {
        await page.keyboard.press(key);
      },
      async typeText(value) {
        await page.keyboard.type(value);
      },
      async typographyFingerprint(text) {
        return await widget.locator("html").evaluate(async (root, probeText) => {
          const probe = document.createElement("span");
          probe.textContent = probeText;
          Object.assign(probe.style, {
            position: "fixed",
            left: "-10000px",
            top: "0",
            fontFamily: "var(--gr-font)",
            fontSize: "16px",
            fontWeight: "600",
            lineHeight: "normal",
            whiteSpace: "nowrap",
          });
          root.append(probe);
          const requestedStyle = getComputedStyle(probe);
          await document.fonts.load(
            `${requestedStyle.fontWeight} ${requestedStyle.fontSize} ${requestedStyle.fontFamily}`,
            probeText,
          );
          await document.fonts.ready;
          await new Promise((resolve) => requestAnimationFrame(() =>
            requestAnimationFrame(resolve)
          ));
          const style = getComputedStyle(probe);
          const fingerprint = {
            fontFamily: style.fontFamily,
            text: probeText,
            widthPx: probe.getBoundingClientRect().width,
          };
          probe.remove();
          return fingerprint;
        }, text);
      },
      async capture(options = {}) {
        await widget.locator("html").evaluate(async () => {
          const fontRuns = new Map();
          for (const element of document.querySelectorAll("#gitright-widget *")) {
            if (element.getClientRects().length === 0) continue;
            const style = getComputedStyle(element);
            if (style.display === "none" || style.visibility === "hidden") continue;
            const text = [
              ...[...element.childNodes]
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent ?? ""),
              element instanceof HTMLInputElement ? element.placeholder : "",
              element instanceof HTMLTextAreaElement ? element.placeholder : "",
            ].join("").trim();
            if (text === "") continue;
            const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            const characters = fontRuns.get(font) ?? new Set();
            for (const character of text) characters.add(character);
            fontRuns.set(font, characters);
          }
          await Promise.all([...fontRuns].map(([font, characters]) =>
            document.fonts.load(font, [...characters].join(""))
          ));
          await document.fonts.ready;
          await new Promise((resolve) => requestAnimationFrame(() =>
            requestAnimationFrame(resolve)
          ));
        });
        return await page.locator("#gitright-widget").screenshot({
          animations: "disabled",
          caret: "hide",
          ...options,
        });
      },
      async close() {
        if (closed) return;
        closed = true;
        await browser.close();
        await client.close();
      },
    };
  } catch (error) {
    await browser?.close();
    await client.close().catch(() => undefined);
    throw error;
  }
}
