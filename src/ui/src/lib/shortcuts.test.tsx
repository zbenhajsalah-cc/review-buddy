/// <reference types="bun-types" />
import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { type ShortcutHandler, type ShortcutId, useShortcuts } from "./shortcuts.ts";

afterEach(() => {
  cleanup();
});

function Probe({
  bindings,
  enabled,
}: {
  bindings: Partial<Record<ShortcutId, ShortcutHandler>>;
  enabled?: boolean;
}) {
  useShortcuts(bindings, enabled);
  return <div>probe</div>;
}

test("fires the handler on a matching keydown on document", () => {
  const onFire = mock(() => {});
  render(<Probe bindings={{ NEXT_FILE: { handler: onFire } }} />);

  act(() => {
    fireEvent.keyDown(document, { key: "j" });
  });
  expect(onFire).toHaveBeenCalledTimes(1);
});

test("does not fire when metaKey, ctrlKey, or altKey is held", () => {
  const onFire = mock(() => {});
  render(<Probe bindings={{ NEXT_FILE: { handler: onFire } }} />);

  act(() => {
    fireEvent.keyDown(document, { key: "j", metaKey: true });
    fireEvent.keyDown(document, { key: "j", ctrlKey: true });
    fireEvent.keyDown(document, { key: "j", altKey: true });
  });
  expect(onFire).toHaveBeenCalledTimes(0);
});

test("does not fire when the event target is an input or textarea", () => {
  const onFire = mock(() => {});
  render(
    <>
      <Probe bindings={{ NEXT_FILE: { handler: onFire } }} />
      <input data-testid="input" />
      <textarea data-testid="textarea" />
    </>,
  );

  act(() => {
    fireEvent.keyDown(document.querySelector("input")!, { key: "j" });
    fireEvent.keyDown(document.querySelector("textarea")!, { key: "j" });
  });
  expect(onFire).toHaveBeenCalledTimes(0);
});

test("does not fire when enabled is false", () => {
  const onFire = mock(() => {});
  render(<Probe bindings={{ NEXT_FILE: { handler: onFire } }} enabled={false} />);

  act(() => {
    fireEvent.keyDown(document, { key: "j" });
  });
  expect(onFire).toHaveBeenCalledTimes(0);
});

test("Enter on a button does not fire (activation key belongs to the control)", () => {
  const onFire = mock(() => {});
  render(
    <>
      <Probe bindings={{ BEGIN_REVIEW: { handler: onFire } }} />
      <button type="button">Go</button>
    </>,
  );

  act(() => {
    fireEvent.keyDown(document.querySelector("button")!, { key: "Enter" });
  });
  expect(onFire).toHaveBeenCalledTimes(0);
});

test("Enter on a plain div / document.body does fire", () => {
  const onFire = mock(() => {});
  render(
    <>
      <Probe bindings={{ BEGIN_REVIEW: { handler: onFire } }} />
      <div data-testid="plain">plain</div>
    </>,
  );

  act(() => {
    fireEvent.keyDown(document.querySelector("[data-testid=plain]")!, { key: "Enter" });
    fireEvent.keyDown(document.body, { key: "Enter" });
  });
  expect(onFire).toHaveBeenCalledTimes(2);
});

test("j on a button still fires (guard is activation-key only)", () => {
  const onFire = mock(() => {});
  render(
    <>
      <Probe bindings={{ NEXT_FILE: { handler: onFire } }} />
      <button type="button">Go</button>
    </>,
  );

  act(() => {
    fireEvent.keyDown(document.querySelector("button")!, { key: "j" });
  });
  expect(onFire).toHaveBeenCalledTimes(1);
});

test("keys match with enabled: false falls through to a later matching binding", () => {
  // Catalog ids own disjoint keys, so same-key fallthrough can't happen via two
  // catalog entries. Simulate the skip path: a disabled binding must not fire,
  // while a distinct enabled binding for its own key still does.
  const first = mock(() => {});
  const second = mock(() => {});
  render(
    <Probe
      bindings={{
        NEXT_FILE: { handler: first, enabled: false },
        PREV_FILE: { handler: second },
      }}
    />,
  );

  act(() => {
    fireEvent.keyDown(document, { key: "j" });
    fireEvent.keyDown(document, { key: "k" });
  });
  expect(first).toHaveBeenCalledTimes(0);
  expect(second).toHaveBeenCalledTimes(1);
});
