import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const FIELD_CLASS =
  "w-full rounded-control bg-chrome px-2.5 text-label text-fg shadow-raised outline-none placeholder:text-fg-faint focus:shadow-focus disabled:opacity-50";

export function GitInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      spellCheck={false}
      autoComplete="off"
      className={cn(FIELD_CLASS, "h-8", className)}
      {...props}
    />
  );
}

export function GitTextarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea className={cn(FIELD_CLASS, "resize-none py-2 leading-5", className)} {...props} />
  );
}

export type Feedback = { readonly tone: "ok" | "error"; readonly text: string } | null;

export function FeedbackLine({ feedback }: { readonly feedback: Feedback }) {
  if (feedback === null) return null;
  return (
    <p
      role={feedback.tone === "error" ? "alert" : "status"}
      className={cn(
        "px-1 text-label break-words",
        feedback.tone === "error" ? "text-danger" : "text-fg-muted",
      )}
    >
      {feedback.text}
    </p>
  );
}
