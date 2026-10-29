import type { DisplaySettings } from "@review-buddy/core/types";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { DEFAULT_SETTINGS } from "../stories/fixtures.ts";
import { DisplaySettingsBar } from "./DisplaySettingsBar.tsx";

const meta = {
  title: "Components/DisplaySettingsBar",
  component: DisplaySettingsBar,
  tags: ["autodocs"],
} satisfies Meta<typeof DisplaySettingsBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    settings: DEFAULT_SETTINGS,
    update: () => {},
  },
  render: function Interactive() {
    const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_SETTINGS);
    const update = (patch: Partial<DisplaySettings>) => setSettings((s) => ({ ...s, ...patch }));
    return <DisplaySettingsBar settings={settings} update={update} />;
  },
};

/** The theme & font popover, open: mode, syntax themes, code font, size, ligatures. */
export const ThemeAndFontOpen: Story = {
  args: {
    settings: DEFAULT_SETTINGS,
    update: () => {},
  },
  render: function Interactive() {
    const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_SETTINGS);
    const [open, setOpen] = useState(true);
    const update = (patch: Partial<DisplaySettings>) => setSettings((s) => ({ ...s, ...patch }));
    return (
      <DisplaySettingsBar
        settings={settings}
        update={update}
        appearanceOpen={open}
        onAppearanceOpenChange={setOpen}
      />
    );
  },
};
