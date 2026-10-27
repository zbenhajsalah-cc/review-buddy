import { describe, expect, test } from "bun:test";
import { VIEWER_CSP } from "@review-buddy/core/viewer-csp";
import { appFilePath, isExternalWebUrl, isRendererUrl, rendererCsp } from "./security.ts";

describe("rendererCsp", () => {
  test("the built app uses the plugin viewer's CSP", () => {
    expect(rendererCsp(false)).toBe(VIEWER_CSP);
  });

  test("dev adds only what the Vite dev server needs", () => {
    const dev = rendererCsp(true);
    expect(dev).toContain("connect-src 'self' ws://localhost:*;");
    expect(dev).toEndWith("; script-src 'self' 'unsafe-inline'");
    // Each directive appears once: browsers ignore a repeated directive.
    const names = dev.split(";").map((d) => d.trim().split(" ")[0]);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("isRendererUrl", () => {
  const dev = "http://localhost:5173";
  test("accepts the app:// renderer and the dev server", () => {
    expect(isRendererUrl("app://renderer/index.html", undefined)).toBe(true);
    expect(isRendererUrl("http://localhost:5173/", dev)).toBe(true);
  });

  test("refuses everything else", () => {
    expect(isRendererUrl("app://other/index.html", undefined)).toBe(false);
    expect(isRendererUrl("http://localhost:5173/", undefined)).toBe(false);
    expect(isRendererUrl("http://localhost:5174/", dev)).toBe(false);
    expect(isRendererUrl("https://localhost:5173/", dev)).toBe(false);
    expect(isRendererUrl("file:///index.html", dev)).toBe(false);
    expect(isRendererUrl("", dev)).toBe(false);
  });
});

test("isExternalWebUrl allows only web pages", () => {
  expect(isExternalWebUrl("https://github.com/a/b/pull/1")).toBe(true);
  expect(isExternalWebUrl("http://example.com")).toBe(true);
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "smb://host/share",
    "app://renderer/",
    "nope",
  ]) {
    expect(isExternalWebUrl(url)).toBe(false);
  }
});

describe("appFilePath", () => {
  const root = "/app/out/renderer";
  test("maps request paths under the root", () => {
    expect(appFilePath(root, "/")).toBe(`${root}/index.html`);
    expect(appFilePath(root, "/index.html")).toBe(`${root}/index.html`);
    expect(appFilePath(root, "/assets/index-abc.js")).toBe(`${root}/assets/index-abc.js`);
  });

  test("refuses paths that leave the root", () => {
    for (const p of [
      "/../main/index.js",
      "/assets/%2e%2e/%2e%2e/main/index.js",
      "/a%5c..%5cb",
      "/%00",
      "/%E0%A4%A",
    ]) {
      expect(appFilePath(root, p)).toBeNull();
    }
  });
});
