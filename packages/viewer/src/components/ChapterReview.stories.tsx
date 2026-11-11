import type { Meta, StoryObj } from "@storybook/react-vite";
import { fakeResolvedReview, fakeReviewWithFindings } from "../stories/fixtures.ts";
import { ChapterReview } from "./ChapterReview.tsx";

const meta = {
  title: "Components/ChapterReview",
  component: ChapterReview,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="h-screen">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChapterReview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FirstChapter: Story = {
  args: {
    review: fakeResolvedReview,
    position: 0,
    onNavigate: () => {},
    onExit: () => {},
  },
};

export const LastChapter: Story = {
  args: {
    review: fakeResolvedReview,
    position: fakeResolvedReview.chapters.length - 1,
    onNavigate: () => {},
    onExit: () => {},
  },
};

/** Chapter 2 with findings: on lines, outside the diff, and in the sidebar. */
export const WithFindings: Story = {
  args: {
    review: fakeReviewWithFindings,
    position: 1,
    onNavigate: () => {},
    onExit: () => {},
  },
};
