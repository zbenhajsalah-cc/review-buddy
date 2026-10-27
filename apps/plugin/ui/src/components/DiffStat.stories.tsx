import type { Meta, StoryObj } from "@storybook/react-vite";
import { DiffStat } from "./DiffStat.tsx";

const meta = {
  title: "Components/DiffStat",
  component: DiffStat,
  tags: ["autodocs"],
} satisfies Meta<typeof DiffStat>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { additions: 42, deletions: 7 },
};

export const Zero: Story = {
  args: { additions: 0, deletions: 0 },
};

export const AdditionsOnly: Story = {
  args: { additions: 15, deletions: 0 },
};

export const DeletionsOnly: Story = {
  args: { additions: 0, deletions: 9 },
};
