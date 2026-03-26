import { useEffect, useRef, useState } from "react";
import frames from "../data/frames.json";

const FPS = 12;
const INTERVAL = 1000 / FPS;

export function AnvilAnimation() {
  const [frameIndex, setFrameIndex] = useState(0);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    function animate(timestamp: number) {
      if (timestamp - lastTimeRef.current >= INTERVAL) {
        setFrameIndex((prev) => (prev + 1) % frames.length);
        lastTimeRef.current = timestamp;
      }
      rafRef.current = requestAnimationFrame(animate);
    }
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <pre
      className="text-surface-300 leading-none select-none overflow-hidden"
      style={{
        fontSize: "clamp(2px, 0.55vw, 6px)",
        lineHeight: "clamp(2.5px, 0.65vw, 7px)",
        letterSpacing: "0.5px",
      }}
    >
      {frames[frameIndex]}
    </pre>
  );
}
