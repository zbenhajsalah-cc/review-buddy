import type { Meta, StoryObj } from "@storybook/react-vite";
import { RiskBadge } from "./RiskBadge.tsx";

const meta = {
  title: "Components/RiskBadge",
  component: RiskBadge,
  tags: ["autodocs"],
} satisfies Meta<typeof RiskBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const High: Story = {
  args: { risk: "High" },
};

export const Medium: Story = {
  args: { risk: "Medium" },
};

export const Low: Story = {
  args: { risk: "Low" },
};

export const AllRisks: Story = {
  args: { risk: "Low" },
  render: () => (
    <div className="flex items-center gap-2">
      <RiskBadge risk="High" />
      <RiskBadge risk="Medium" />
      <RiskBadge risk="Low" />
    </div>
  ),
};
