import type { Transition } from "motion/react";

export const easeOut = [0.23, 1, 0.32, 1] as const;

export const spring = {
  snappy: { type: "spring", visualDuration: 0.2, bounce: 0 },
  smooth: { type: "spring", visualDuration: 0.3, bounce: 0.1 },
  gentle: { type: "spring", visualDuration: 0.45, bounce: 0.15 },
  layout: { type: "spring", stiffness: 500, damping: 40 },
} as const satisfies Record<string, Transition>;

export const textSwap = {
  initial: { opacity: 0, y: 6, filter: "blur(2px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -6, filter: "blur(2px)" },
  transition: { duration: 0.2, ease: easeOut },
} as const;
