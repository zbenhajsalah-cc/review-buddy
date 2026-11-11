import type { Meta, StoryObj } from "@storybook/react-vite";
import { fakeReviewWithFindings } from "../stories/fixtures.ts";
import { FindingCard } from "./Finding.tsx";

const [important, nit, , preExisting] = fakeReviewWithFindings.findings ?? [];

const meta = {
  title: "Components/Finding",
  component: FindingCard,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="max-w-2xl p-6 text-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FindingCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Important: Story = { args: { finding: important! } };
/** Folded: the body opens on a click. */
export const Nit: Story = { args: { finding: nit! } };
export const PreExisting: Story = { args: { finding: preExisting!, showPath: true } };

/** With round-trip on, each finding is answered: Fix, or Dismiss with a reason. */
export const Answerable: Story = {
  args: { finding: important!, onAnswer: () => {}, onClearAnswer: () => {} },
};
export const AnsweredToFix: Story = {
  args: {
    finding: important!,
    answer: { id: important!.id, decision: "fix" },
    onAnswer: () => {},
    onClearAnswer: () => {},
  },
};
export const AnsweredDismissed: Story = {
  args: {
    finding: nit!,
    answer: { id: nit!.id, decision: "dismiss", reason: "intentional, used by the codegen" },
    onAnswer: () => {},
    onClearAnswer: () => {},
  },
};
