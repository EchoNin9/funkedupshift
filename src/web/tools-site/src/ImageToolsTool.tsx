import React, { useState } from "react";
import ImageTool from "./ImageTool";
import CropTool from "./CropTool";
import RemoveBgTool from "./RemoveBgTool";

interface Props {
  onBack: () => void;
}

type Tab = "resize" | "crop" | "removebg";
const TABS: { id: Tab; label: string }[] = [
  { id: "resize", label: "Resize" },
  { id: "crop", label: "Crop" },
  { id: "removebg", label: "Remove Background" },
];

// Combined card for the three image tools, mirroring ConvertersTool's
// tab-switcher pattern. Each tab renders one of the existing tool components
// as-is (own heading + back link included) — switching tabs unmounts the
// previous one, so per-tool state (loaded image, canvas, etc.) doesn't leak
// across tabs. RemoveBgTool's @imgly import stays inside its own click
// handler, so it's still only fetched when that tab is opened and "Remove
// Background" is pressed — never on tab switch alone.
const ImageToolsTool: React.FC<Props> = ({ onBack }) => {
  const [tab, setTab] = useState<Tab>("resize");

  return (
    <section className="tool-view">
      <div className="conv-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`conv-tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "resize" && <ImageTool onBack={onBack} />}
      {tab === "crop" && <CropTool onBack={onBack} />}
      {tab === "removebg" && <RemoveBgTool onBack={onBack} />}
    </section>
  );
};

export default ImageToolsTool;
