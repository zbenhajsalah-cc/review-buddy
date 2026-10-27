import type { Meta, StoryObj } from "@storybook/react-vite";
import { DEFAULT_SETTINGS, fakeResolvedFile } from "../stories/fixtures.ts";
import { FileDiffCard } from "./FileDiffCard.tsx";

const meta = {
  title: "Components/FileDiffCard",
  component: FileDiffCard,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    file: fakeResolvedFile,
    settings: DEFAULT_SETTINGS,
    viewed: false,
    collapsed: false,
    onViewedChange: () => {},
    onSetCollapsed: () => {},
  },
} satisfies Meta<typeof FileDiffCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Viewed: Story = {
  args: {
    viewed: true,
    collapsed: true,
  },
};

export const Binary: Story = {
  args: {
    file: { ...fakeResolvedFile, binary: true, hunks: [] },
  },
};
