import React from "react";

/** Fixed neon-blob + halftone ambiance behind app content (z-0). (FUNK-3) */
export function PopBackground() {
  return (
    <>
      <div className="pop-bg" aria-hidden="true">
        <div className="pop-blob pop-blob--1" />
        <div className="pop-blob pop-blob--2" />
        <div className="pop-blob pop-blob--3" />
      </div>
      <div className="pop-halftone" aria-hidden="true" />
    </>
  );
}

export default PopBackground;
