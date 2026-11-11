import type { Meta, StoryObj } from "@storybook/react-vite";
import { fakeResolvedReview, fakeReviewWithEvidence } from "../stories/fixtures.ts";
import { Evidence } from "./Evidence.tsx";

const meta = {
  title: "Components/Evidence",
  component: Evidence,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="max-w-3xl p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Evidence>;

export default meta;
type Story = StoryObj<typeof meta>;

/** CI from GitHub and the agent's own checks. */
export const Both: Story = { args: { review: fakeReviewWithEvidence } };

export const CiOnly: Story = {
  args: { review: { ...fakeReviewWithEvidence, verification: undefined } },
};

export const AgentOnly: Story = {
  args: { review: { ...fakeReviewWithEvidence, pr: fakeResolvedReview.pr } },
};

/** Nothing was reported: one muted line. */
export const None: Story = { args: { review: fakeResolvedReview } };
