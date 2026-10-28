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
    onAddComment: () => {},
    onEditComment: () => {},
    onDeleteComment: () => {},
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

export const WithComments: Story = {
  args: {
    comments: [
      {
        id: "c1",
        chapterIndex: 1,
        path: fakeResolvedFile.path,
        side: "new",
        line: 11,
        body: "Is the comma on purpose? The **tests** still expect `hello`.",
      },
      {
        id: "c2",
        chapterIndex: 1,
        path: fakeResolvedFile.path,
        side: "new",
        line: 13,
        startSide: "new",
        startLine: 10,
        body: "This function could take the name as a parameter.",
      },
    ],
  },
};
