"use client";

import { useEffect, useRef, useState } from "react";

export function Neural() {
  const [paused, setPaused] = useState(false);
  const reference = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = reference.current;
    const pointerArea = root?.closest<HTMLElement>(".engine");
    if (!root || !pointerArea || paused || !("IntersectionObserver" in window) || !("ResizeObserver" in window)) return;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    let dispose: (() => void) | undefined;
    let visible = false;
    let requested = false;
    let mounted = true;

    async function activate() {
      if (!visible || preference.matches || requested || dispose) return;
      requested = true;
      try {
        const { startNeuralScene } = await import("./neural-scene");
        if (mounted && !preference.matches && visible) dispose = startNeuralScene(root!, pointerArea!);
      } catch {
        if (mounted) root!.dataset.renderState = "static";
      }
      requested = false;
    }
    function motionChanged() {
      if (preference.matches) {
        dispose?.();
        dispose = undefined;
      } else void activate();
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting;
      if (visible) void activate();
    });
    observer.observe(root);
    preference.addEventListener("change", motionChanged);
    return () => {
      mounted = false;
      observer.disconnect();
      preference.removeEventListener("change", motionChanged);
      dispose?.();
    };
  }, [paused]);
  return <><div ref={reference} className="neural-art" data-render-state="static" aria-hidden="true">
    <div className="neural-fallback"><i /><i /><i /><i /></div>
  </div><button type="button" className="scene-control" aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? "Resume visual" : "Pause visual"}</button></>;
}
