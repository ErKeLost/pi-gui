import { createRoot } from "react-dom/client";
import { EffortSlider } from "./components/chat/EffortSlider";
import "./index.css";

const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const withoutMax = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

function Preview() {
  return <>
    {(["low", "high", "max"] as const).map(value => <div className="preview" key={value}><small>{value}</small><EffortSlider levels={[...levels]} value={value} onChange={() => undefined} /></div>)}
    <div className="preview"><small>xhigh（最高可用）</small><EffortSlider levels={[...withoutMax]} value="xhigh" onChange={() => undefined} /></div>
  </>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
