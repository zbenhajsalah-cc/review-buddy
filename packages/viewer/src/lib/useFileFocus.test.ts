import { expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useFileFocus } from "./useFileFocus.ts";

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

test("when the focused file leaves the list, j goes on from where it was", () => {
  const { result, rerender } = renderHook(({ paths }) => useFileFocus(paths), {
    initialProps: { paths: ["a", "b", "c"] },
  });
  act(() => {
    result.current.focus("b");
  });
  rerender({ paths: ["a", "c"] }); // b was viewed and is hidden now
  act(() => {
    expect(result.current.move(1)).toBe("c");
  });

  act(() => {
    result.current.focus("c");
  });
  rerender({ paths: ["a"] });
  act(() => {
    expect(result.current.move(-1)).toBe("a");
  });
});
