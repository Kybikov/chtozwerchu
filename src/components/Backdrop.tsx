import {
  Component,
  lazy,
  memo,
  Suspense,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useReducedMotion } from "motion/react";
const GrainWave = lazy(() => import("./react-bits/grain-wave"));
class GPUFallback extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
export default memo(function Backdrop({ effects }: { effects: boolean }) {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="ambient ambient-pink" />
      <div className="ambient ambient-blue" />
      {effects && !reduced && visible && (
        <GPUFallback>
          <Suspense fallback={null}>
            <GrainWave
              startColor="#da538d"
              endColor="#6b75ec"
              darkBackground="#0c0c12"
              waveCount={14}
              waveAmplitude={0.4}
              lineThickness={0.08}
              brightness={0.6}
              grainIntensity={35}
              speed={0.18}
              scale={0.75}
            />
          </Suspense>
        </GPUFallback>
      )}
      <div className="backdrop-fade" />
    </div>
  );
});
