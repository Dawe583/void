import { useCallback, useEffect, useRef, useState } from "react";

/** Media query hook that is SSR safe and updates on change. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    if (list.addEventListener) {
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    }
    list.addListener(onChange);
    return () => list.removeListener(onChange);
  }, [query]);

  return matches;
}

/** True when the device has a precise pointer that can hover. */
export function useFinePointer(): boolean {
  return useMediaQuery("(hover: hover) and (pointer: fine)");
}

/** Reads and persists the theme, defaulting to light. */
export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    // Light is the site's look, so it is what a first time visitor gets,
    // whatever their system preference. A stored choice always wins, and the
    // toggle in the nav still reaches the dark CRT theme.
    if (typeof window === "undefined") return "light";
    const stored = window.localStorage.getItem("void-theme");
    return stored === "light" || stored === "dark" ? stored : "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.style.colorScheme = theme;
    try {
      window.localStorage.setItem("void-theme", theme);
    } catch {
      /* storage can be blocked, the attribute is what matters */
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#05070d" : "#f6f7fb");
  }, [theme]);

  const toggle = useCallback(() => setTheme((value) => (value === "dark" ? "light" : "dark")), []);
  return { theme, setTheme, toggle };
}

/** Interval that pauses itself when the tab is hidden, so nothing burns battery. */
export function useVisibleInterval(callback: () => void, ms: number, enabled = true) {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (!enabled || ms <= 0) return;
    let id: number | undefined;

    const start = () => {
      if (id !== undefined) return;
      id = window.setInterval(() => saved.current(), ms);
    };
    const stop = () => {
      if (id === undefined) return;
      window.clearInterval(id);
      id = undefined;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms, enabled]);
}

/** Tracks which section id is currently in view. */
export function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: "-25% 0px -55% 0px", threshold: [0, 0.25, 0.6] },
    );
    const nodes = ids.map((id) => document.getElementById(id)).filter(Boolean) as Element[];
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [ids.join("|")]);

  return active;
}

/** Sets the document title and meta description for a route. */
export function usePageMeta(title: string, description: string, path?: string) {
  useEffect(() => {
    document.title = title;
    const set = (selector: string, attr: string, value: string) => {
      const node = document.querySelector(selector);
      if (node) node.setAttribute(attr, value);
    };
    set('meta[name="description"]', "content", description);
    set('meta[property="og:title"]', "content", title);
    set('meta[property="og:description"]', "content", description);
    set('meta[name="twitter:title"]', "content", title);
    set('meta[name="twitter:description"]', "content", description);
    if (path) {
      let canonical = document.querySelector('link[rel="canonical"]');
      if (!canonical) {
        canonical = document.createElement("link");
        canonical.setAttribute("rel", "canonical");
        document.head.appendChild(canonical);
      }
      canonical.setAttribute("href", `${window.location.origin}${path}`);
      set('meta[property="og:url"]', "content", `${window.location.origin}${path}`);
    }
  }, [title, description, path]);
}

/** Copy helper with a clipboard fallback for browsers without the async API. */
export function useCopy(resetMs = 1600) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(
    async (text: string) => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const area = document.createElement("textarea");
          area.value = text;
          area.setAttribute("readonly", "");
          area.style.position = "fixed";
          area.style.opacity = "0";
          document.body.appendChild(area);
          area.select();
          document.execCommand("copy");
          document.body.removeChild(area);
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), resetMs);
      } catch {
        setCopied(false);
      }
    },
    [resetMs],
  );

  return { copied, copy };
}
