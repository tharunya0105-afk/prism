import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from "react";
import {
  Prism,
  type Match,
  type PrismConfig,
  type ProtectResult,
  type SendResult,
} from "./core";

export interface PrismContextValue {
  prism: Prism;
  protect: (input: string) => ProtectResult;
  restore: (text: string) => string;
  send: (
    input: string,
    transport: (protectedText: string) => Promise<string> | string,
    options?: { restore?: boolean }
  ) => Promise<SendResult>;
  /** Convenience: full match list for the latest protect() call. */
  reportOf: (input: string) => Match[];
}

const PrismContext = createContext<PrismContextValue | null>(null);

export function PrismProvider({
  config,
  children,
}: PropsWithChildren<{ config?: PrismConfig }>) {
  const prism = useMemo(() => new Prism(config), [config]);
  const value = useMemo<PrismContextValue>(
    () => ({
      prism,
      protect: (input) => prism.protect(input),
      restore: (text) => prism.restore(text),
      send: (input, transport, options) => prism.send(input, transport, options),
      reportOf: (input) => prism.protect(input).report,
    }),
    [prism]
  );
  return <PrismContext.Provider value={value}>{children}</PrismContext.Provider>;
}

export function usePrism(): PrismContextValue {
  const ctx = useContext(PrismContext);
  if (!ctx) throw new Error("usePrism must be used inside <PrismProvider>");
  return ctx;
}

/**
 * Drop-in textarea with a live "what the model would see" preview.
 * Styling is left to the consumer via className.
 */
export function PrismTextArea({
  value,
  onChange,
  rows = 5,
  placeholder,
  className,
  previewClassName,
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
  previewClassName?: string;
}) {
  const { protect } = usePrism();
  const { text, count } = useMemo(() => protect(value), [value, protect]);

  return (
    <div className="prism-textarea-root">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className={className}
      />
      {value.trim() !== "" && (
        <div className={previewClassName} aria-live="polite">
          <span className="prism-textarea-count">
            {count} secret{count === 1 ? "" : "s"} redacted — the AI would see:
          </span>
          <pre>{text}</pre>
        </div>
      )}
    </div>
  );
}