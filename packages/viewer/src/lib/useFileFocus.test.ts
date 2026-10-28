import { expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useFileFocus } from "./useFileFocus.ts";

const ORDER = ["a", "b", "c", "d"];

test("j / k step through the files and stop at the ends", () => {
  const { result } = renderHook(() => useFileFocus(["a", "b"]));
  act(() => {
    expect(result.current.move(1)).toBe("a");
  });
  act(() => {
    expect(result.current.move(1)).toBe("b");
  });
  act(() => {
    expect(result.current.move(1)).toBeNull();
  });
  expect(result.current.focusedPath).toBe("b");
});

test("when the focused file leaves the list, j / k go on from where it was", () => {
  const { result, rerender } = renderHook(({ paths }) => useFileFocus(paths, ORDER), {
    initialProps: { paths: ORDER },
  });
  act(() => {
    result.current.focus("b");
  });
  rerender({ paths: ["a", "c", "d"] }); // b was viewed and is hidden now
  act(() => {
    expect(result.current.move(1)).toBe("c");
  });

  act(() => {
    result.current.focus("d");
  });
  rerender({ paths: ["a", "c"] });
  act(() => {
    expect(result.current.move(-1)).toBe("c");
  });
});

test("files hidden before the focused one do not throw j off", () => {
  const { result, rerender } = renderHook(({ paths }) => useFileFocus(paths, ORDER), {
    initialProps: { paths: ORDER },
  });
  act(() => {
    result.current.focus("c");
  });
  rerender({ paths: ["b", "c", "d"] }); // a marked viewed with the mouse
  rerender({ paths: ["b", "d"] }); // then c, with v
  act(() => {
    expect(result.current.move(1)).toBe("d");
  });
});
