import type { Meta, StoryObj } from "@storybook/react-vite";
import { fakeResolvedReview } from "../stories/fixtures.ts";
import { Overview } from "./Overview.tsx";

const meta = {
  title: "Components/Overview",
  component: Overview,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof Overview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    review: fakeResolvedReview,
    onBeginReview: () => {},
  },
};

export const WithWarnings: Story = {
  args: {
    review: {
      ...fakeResolvedReview,
      warnings: [
        "Chapter 2 references src/auth.ts but no matching hunk was found.",
        "Agent stats differ from git diff totals for chapter 1.",
      ],
    },
    onBeginReview: () => {},
  },
};
