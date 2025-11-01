// src/components/AdPlacard.jsx
export default function AdPlacard({ slot = "banner-home" }) {
  return (
    <div
      className="ad-placard"
      data-admob-slot={slot}
      style={{
        width: "100%",
        aspectRatio: "1 / 1.1", // slightly taller ratio
        margin: "0px 0",
        borderRadius: "12px",
        background: "#ffffff4d",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 3px 8px rgba(0,0,0,0.1)",
      }}
    >
      <span className="label">AdMob Placard — {slot}</span>
    </div>
  );
}
