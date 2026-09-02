import type { Variants, Transition } from "motion/react";

export const EASE = [0.16, 1, 0.3, 1] as const;
export const EASE_IO = [0.65, 0, 0.35, 1] as const;

export const springSoft: Transition = { type: "spring", stiffness: 140, damping: 22, mass: 0.9 };
export const springSnappy: Transition = { type: "spring", stiffness: 320, damping: 30 };

export const revealTransition: Transition = { duration: 0.62, ease: EASE };

/**
 * The single reveal primitive used across the whole site.
 *
 * Deliberately transform and opacity only: animating a blur filter forces a new
 * compositing layer on every revealed element, which is the difference between
 * smooth and janky on a mid range phone.
 */
export const revealVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: revealTransition },
};

export const revealReduced: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.2 } },
};

/** Container that staggers its direct children. */
export const staggerParent = (stagger = 0.06, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren: delay } },
});

/** Word by word mask reveal for headlines. */
export const wordVariants: Variants = {
  hidden: { y: "110%" },
  show: { y: "0%", transition: { duration: 0.78, ease: EASE } },
};

export const fadeUp = (delay = 0): Variants => ({
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE, delay } },
});

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: EASE } },
};

export const VIEWPORT = { once: true, amount: 0.15 } as const;
