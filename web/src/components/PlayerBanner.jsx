// src/components/PlayerBanner.jsx
export default function PlayerBanner({ slot = "banner-player-bottom" }) {
  return (
    <div
      className="player-banner"
      data-admob-slot={slot}
      style={{
        width: "100%",             // fills width evenly under video
        height: "69px",          // adjust size as needed
        margin: "0px auto",
        borderRadius: "14px",
        backgroundColor: "rgba(255, 255, 255, 0.05)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 3px 8px rgba(0,0,0,0.25)",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          color: "#000000ff",
          fontWeight: "bold",
          fontSize: "1rem",
          letterSpacing: "0.5px",
        }}
      >
        AdMob Placard — {slot}
      </span>
    </div>
  );
}
