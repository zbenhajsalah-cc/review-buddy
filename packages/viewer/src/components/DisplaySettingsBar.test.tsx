/// <reference types="bun-types" />
import { afterEach, expect, mock, test } from "bun:test";
import type { DisplaySettings } from "@review-buddy/core/types";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { DEFAULT_SETTINGS } from "../settings.ts";
import { DisplaySettingsBar } from "./DisplaySettingsBar.tsx";

afterEach(() => {
  cleanup();
});

function Harness({
  initial = DEFAULT_SETTINGS,
  onUpdate,
}: {
  initial?: DisplaySettings;
  onUpdate?: (patch: Partial<DisplaySettings>) => void;
}) {
  const [settings, setSettings] = useState(initial);
  return (
    <DisplaySettingsBar
      settings={settings}
      update={(patch) => {
        onUpdate?.(patch);
        setSettings((s) => ({ ...s, ...patch }));
      }}
    />
  );
}

// Async act: Radix positions the popover (floating-ui) after a microtask.
async function openAppearance() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Theme & font" }));
  });
}

test("theme & font popover updates themes, font, size and ligatures", async () => {
  const onUpdate = mock((_: Partial<DisplaySettings>) => {});
  render(<Harness onUpdate={onUpdate} />);
  await openAppearance();

  fireEvent.change(screen.getByLabelText("Light theme"), { target: { value: "github-light" } });
  fireEvent.change(screen.getByLabelText("Dark theme"), { target: { value: "dracula" } });
  fireEvent.change(screen.getByLabelText("Font"), { target: { value: "fira-code" } });
  fireEvent.click(screen.getByRole("radio", { name: "15" }));
  fireEvent.click(screen.getByLabelText("Ligatures"));

  expect(onUpdate).toHaveBeenCalledWith({ lightTheme: "github-light" });
  expect(onUpdate).toHaveBeenCalledWith({ darkTheme: "dracula" });
  expect(onUpdate).toHaveBeenCalledWith({ font: "fira-code" });
  expect(onUpdate).toHaveBeenCalledWith({ fontSize: 15 });
  expect(onUpdate).toHaveBeenCalledWith({ ligatures: true });

  // The preview renders in the chosen font.
  const preview = screen.getByTestId("font-preview");
  expect(preview.style.getPropertyValue("--diffs-font-family")).toStartWith('"Fira Code"');
  expect(preview.style.getPropertyValue("--diffs-font-size")).toBe("15px");
});

test("only the theme the current mode uses is offered (Auto shows both)", async () => {
  render(<Harness initial={{ ...DEFAULT_SETTINGS, theme: "light" }} />);
  await openAppearance();
  expect(screen.queryByLabelText("Light theme")).not.toBeNull();
  expect(screen.queryByLabelText("Dark theme")).toBeNull();

  fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
  expect(screen.queryByLabelText("Light theme")).toBeNull();
  expect(screen.queryByLabelText("Dark theme")).not.toBeNull();

  fireEvent.click(screen.getByRole("radio", { name: "Auto" }));
  expect(screen.queryByLabelText("Light theme")).not.toBeNull();
  expect(screen.queryByLabelText("Dark theme")).not.toBeNull();
});

test("reports the popover open state so the parent can pause shortcuts", async () => {
  const onOpenChange = mock((_: boolean) => {});
  render(
    <DisplaySettingsBar
      settings={DEFAULT_SETTINGS}
      update={() => {}}
      appearanceOpen={false}
      onAppearanceOpenChange={onOpenChange}
    />,
  );
  await openAppearance();
  expect(onOpenChange).toHaveBeenCalledWith(true);
});
