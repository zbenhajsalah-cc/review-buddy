import type { Meta, StoryObj } from "@storybook/react-vite";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const meta = {
  title: "UI/ToggleGroup",
  component: ToggleGroup,
  tags: ["autodocs"],
} satisfies Meta<typeof ToggleGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Single: Story = {
  args: { type: "single" },
  render: () => (
    <ToggleGroup type="single" defaultValue="unified" variant="outline" spacing={0}>
      <ToggleGroupItem
        value="unified"
        className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
      >
        Unified
      </ToggleGroupItem>
      <ToggleGroupItem
        value="split"
        className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
      >
        Split
      </ToggleGroupItem>
    </ToggleGroup>
  ),
};

export const Multiple: Story = {
  args: { type: "multiple" },
  render: () => (
    <ToggleGroup type="multiple" variant="outline">
      <ToggleGroupItem value="bold">Bold</ToggleGroupItem>
      <ToggleGroupItem value="italic">Italic</ToggleGroupItem>
      <ToggleGroupItem value="underline">Underline</ToggleGroupItem>
    </ToggleGroup>
  ),
};
