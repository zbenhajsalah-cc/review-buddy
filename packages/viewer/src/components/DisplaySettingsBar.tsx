import type { DisplaySettings } from "@review-buddy/core/types";
import { type CSSProperties, useId } from "react";
import { CODE_FONTS, codeFontStyle, FONT_SIZES, THEMES } from "../appearance.ts";
import { cn } from "../lib/utils.ts";
import { Button } from "./ui/button.tsx";
import { Label } from "./ui/label.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";
import { Switch } from "./ui/switch.tsx";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group.tsx";

/** Compact toolbar of the diff display controls (source D). */
export function DisplaySettingsBar({
  settings,
  update,
  appearanceOpen,
  onAppearanceOpenChange,
}: {
  settings: DisplaySettings;
  update: (patch: Partial<DisplaySettings>) => void;
  /** Controlled open state of the theme & font popover (omit for uncontrolled). */
  appearanceOpen?: boolean;
  onAppearanceOpenChange?: (open: boolean) => void;
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
      <AppearancePopover
        settings={settings}
        update={update}
        open={appearanceOpen}
        onOpenChange={onAppearanceOpenChange}
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

/** The toolbar's small-caps control label. */
const CONTROL_LABEL = "font-mono text-[0.62rem] uppercase tracking-[0.07em] text-muted-foreground";

/** Popover labels share one width so the controls line up in a column. */
const POPOVER_LABEL = "w-24 shrink-0";

/** Color mode + syntax themes + code font, grouped so the toolbar stays one row. */
function AppearancePopover({
  settings,
  update,
  open,
  onOpenChange,
}: {
  settings: DisplaySettings;
  update: (patch: Partial<DisplaySettings>) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="xs">
          Theme &amp; font
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-80 flex-col gap-3 text-xs">
        <Segmented
          label="Mode"
          labelClassName={POPOVER_LABEL}
          value={settings.theme}
          options={[
            ["auto", "Auto"],
            ["light", "Light"],
            ["dark", "Dark"],
          ]}
          onChange={(v) => update({ theme: v })}
        />
        {/* Only the theme(s) the current mode can show; Auto uses both. */}
        {settings.theme !== "dark" && (
          <SettingSelect
            label="Light theme"
            value={settings.lightTheme}
            options={THEMES.light}
            onChange={(v) => update({ lightTheme: v })}
          />
        )}
        {settings.theme !== "light" && (
          <SettingSelect
            label="Dark theme"
            value={settings.darkTheme}
            options={THEMES.dark}
            onChange={(v) => update({ darkTheme: v })}
          />
        )}
        <hr className="border-border" />
        <SettingSelect
          label="Font"
          value={settings.font}
          options={CODE_FONTS}
          onChange={(v) => update({ font: v })}
        />
        <Segmented
          label="Size"
          labelClassName={POPOVER_LABEL}
          value={String(settings.fontSize)}
          options={FONT_SIZES.map((n): [string, string] => [String(n), String(n)])}
          onChange={(v) => update({ fontSize: Number(v) })}
        />
        <SettingSwitch
          label="Ligatures"
          column
          checked={settings.ligatures}
          onChange={(v) => update({ ligatures: v })}
        />
        <FontPreview settings={settings} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Sample code in the chosen font. The popover renders in a portal outside the
 * diff pane, so it applies the font variables itself.
 */
function FontPreview({ settings }: { settings: DisplaySettings }) {
  const style: CSSProperties = {
    ...codeFontStyle(settings),
    fontFamily: "var(--diffs-font-family)",
    fontSize: "var(--diffs-font-size)",
    lineHeight: "var(--diffs-line-height)",
    fontFeatureSettings: "var(--diffs-font-features)",
  };
  return (
    <pre
      data-testid="font-preview"
      style={style}
      className="overflow-x-auto rounded-md border border-border bg-background px-3 py-2"
    >
      {"const ok = a !== b && c >= 0;\n"}
      <span className="text-muted-foreground italic">{"// 0O 1lI {} [] — italic"}</span>
    </pre>
  );
}

function Segmented<V extends string>({
  label,
  labelClassName,
  value,
  options,
  onChange,
}: {
  label: string;
  labelClassName?: string;
  value: V;
  options: [V, string][];
  onChange: (v: V) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn(CONTROL_LABEL, labelClassName)}>{label}</span>
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

function SettingSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { id: string; name: string }[];
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={id} className={cn(CONTROL_LABEL, "font-normal", POPOVER_LABEL)}>
        {label}
      </Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function SettingSwitch({
  label,
  column = false,
  checked,
  onChange,
}: {
  label: string;
  /** Put the label first, in the popover's aligned label column. */
  column?: boolean;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  const text = (
    <Label
      htmlFor={id}
      className={cn(
        "cursor-pointer text-xs font-normal text-muted-foreground",
        column && [CONTROL_LABEL, POPOVER_LABEL],
      )}
    >
      {label}
    </Label>
  );
  return (
    <div className="flex items-center gap-1.5">
      {column && text}
      <Switch id={id} size="sm" checked={checked} onCheckedChange={onChange} />
      {!column && text}
    </div>
  );
}
