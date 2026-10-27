import type { Meta, StoryObj } from "@storybook/react-vite";
import { Label } from "@/components/ui/label";

const meta = {
  title: "UI/Label",
  component: Label,
  tags: ["autodocs"],
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: "Label text" },
};

export const WithInput: Story = {
  render: () => (
    <div className="grid w-full max-w-sm gap-1.5">
      <Label htmlFor="email">Email</Label>
      <input
        id="email"
        type="email"
        placeholder="you@example.com"
        className="rounded-md border border-border px-2 py-1 text-sm"
      />
    </div>
  ),
};
