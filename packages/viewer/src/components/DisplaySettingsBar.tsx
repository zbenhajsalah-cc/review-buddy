import type { DisplaySettings } from "@review-buddy/core/types";
import { useId } from "react";
import { Label } from "./ui/label.tsx";
import { Switch } from "./ui/switch.tsx";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group.tsx";

/** Compact toolbar of the diff display controls (source D). */
export function DisplaySettingsBar({
  settings,
  update,
}: {
  settings: DisplaySettings;
  update: (patch: Partial<DisplaySettings>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-secondary px-4 py-2 text-xs">
      <Segmented
        label="Layout"
        value={settings.layout}
        options={[
          ["unified", "Unified"],
          ["split", "Split"],
        ]}
        onChange={(v) => update({ layout: v })}
      />
      <Segmented
        label="Granularity"
        value={settings.granularity}
        options={[
          ["line", "Line"],
          ["word", "Word"],
          ["char", "Char"],
        ]}
        onChange={(v) => update({ granularity: v })}
      />
      <Segmented
        label="Indicator"
        value={settings.changeIndicator}
        options={[
          ["classic", "Classic"],
          ["bars", "Bars"],
          ["none", "None"],
        ]}
        onChange={(v) => update({ changeIndicator: v })}
      />
      <Segmented
        label="Theme"
        value={settings.theme}
        options={[
          ["auto", "Auto"],
          ["light", "Light"],
          ["dark", "Dark"],
        ]}
        onChange={(v) => update({ theme: v })}
      />
      <SettingSwitch label="Wrap" checked={settings.wrap} onChange={(v) => update({ wrap: v })} />
      <SettingSwitch
        label="Line numbers"
        checked={settings.lineNumbers}
        onChange={(v) => update({ lineNumbers: v })}
      />
      <SettingSwitch
        label="Backgrounds"
        checked={settings.backgrounds}
        onChange={(v) => update({ backgrounds: v })}
      />
    </div>
  );
}

function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: [V, string][];
  onChange: (v: V) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-[0.62rem] uppercase tracking-[0.07em] text-muted-foreground">
        {label}
      </span>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => {
          if (v) onChange(v as V);
        }}
        variant="outline"
        size="sm"
        spacing={0}
        className="overflow-hidden rounded-md"
      >
        {options.map(([val, text]) => (
          <ToggleGroupItem
            key={val}
            value={val}
            className="rounded-none px-2 py-1 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            {text}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

function SettingSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-1.5">
      <Switch id={id} size="sm" checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="cursor-pointer text-xs font-normal text-muted-foreground">
        {label}
      </Label>
    </div>
  );
}
