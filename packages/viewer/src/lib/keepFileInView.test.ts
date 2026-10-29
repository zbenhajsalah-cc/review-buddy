import { afterEach, expect, mock, test } from "bun:test";
import { keepFileInView, keepInView } from "./keepFileInView.ts";

// happy-dom has no layout, so the test drives the resize callback itself.
const RealResizeObserver = globalThis.ResizeObserver;
let onResize: () => void = () => {};
const disconnect = mock(() => {});
class FakeResizeObserver {
  constructor(callback: () => void) {
    onResize = callback;
  }
  observe() {}
  disconnect = disconnect;
}

afterEach(() => {
  globalThis.ResizeObserver = RealResizeObserver;
  document.body.innerHTML = "";
  disconnect.mockClear();
});

function pane() {
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  document.body.innerHTML =
    '<div id="scroller"><div><div data-file-path="a.ts"></div><div data-file-path="b.ts"></div></div></div>';
  const target = document.querySelector('[data-file-path="b.ts"]') as HTMLElement;
  const scrollIntoView = mock(() => {});
  target.scrollIntoView = scrollIntoView;
  return { scroller: document.getElementById("scroller")!, scrollIntoView };
}

test("scrolls to the file now and again each time the content resizes", () => {
  const { scroller, scrollIntoView } = pane();
  const stop = keepFileInView(scroller, "b.ts");
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
  onResize();
  expect(scrollIntoView).toHaveBeenCalledTimes(2);
  stop();
  expect(disconnect).toHaveBeenCalledTimes(1);
});

test("stops when the reviewer scrolls", () => {
  const { scroller, scrollIntoView } = pane();
  keepFileInView(scroller, "b.ts");
  window.dispatchEvent(new Event("wheel"));
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
});

test("stops by itself after maxMs", async () => {
  const { scroller } = pane();
  keepFileInView(scroller, "b.ts", 10);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(disconnect).toHaveBeenCalledTimes(1);
});

test("keepInView: any element, scrolled to where asked", () => {
  const { scroller, scrollIntoView } = pane();
  const stop = keepInView(scroller, '[data-file-path="b.ts"]', "center");
  expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  onResize();
  expect(scrollIntoView).toHaveBeenCalledTimes(2);
  stop();
});
