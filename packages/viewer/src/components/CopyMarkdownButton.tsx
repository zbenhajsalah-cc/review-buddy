import {
  type ComponentProps,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { cn } from "../lib/utils.ts";
import { Button } from "./ui/button.tsx";

export type CopyMarkdownHandle = {
  copy: () => void;
};

/**
 * Copies Markdown to the clipboard and flashes a brief "copied!" confirmation.
 * Exposes `copy()` via ref so keyboard shortcuts reuse the same path (and UI).
 */
export function CopyMarkdownButton({
  ref,
  text,
  label = "copy",
  "aria-label": ariaLabel,
  title,
  variant = "ghost",
  size = "xs",
  className,
}: {
  ref?: Ref<CopyMarkdownHandle>;
  /** Static string or lazy producer — built only when copying. */
  text: string | (() => string);
  label?: string;
  "aria-label": string;
  title?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const confirmation = "copied!";
  const widthReserve = label.length >= confirmation.length ? label : confirmation;

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const copy = () => {
    const value = typeof textRef.current === "function" ? textRef.current() : textRef.current;
    void (async () => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
        resetTimerRef.current = setTimeout(() => setCopied(false), 1200);
      } catch {
        /* clipboard blocked — ignore */
      }
    })();
  };

  useImperativeHandle(ref, () => ({ copy }));

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={copy}
      title={title ?? ariaLabel}
      aria-label={ariaLabel}
      className={cn("shrink-0 text-muted-foreground", className)}
    >
      <span className="inline-grid place-items-center">
        <span className="invisible col-start-1 row-start-1 whitespace-nowrap" aria-hidden>
          {widthReserve}
        </span>
        <span className="col-start-1 row-start-1 whitespace-nowrap">
          {copied ? confirmation : label}
        </span>
      </span>
    </Button>
  );
}
