import { useParams } from "react-router-dom";
import PlayerBanner from "./PlayerBanner.jsx";

export default function Player() {
  const { id } = useParams();
  const src = `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1&enablejsapi=1`;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: 12 }}>
      {/* === Player area with back button overlay === */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16 / 9",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 6px 18px rgba(0,0,0,.15)",
        }}
      >
        {/* Back button inside the player */}
        <button
          onClick={() => (window.location.href = "/")}
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            zIndex: 2,
            background: "rgba(255, 218, 33, 1)",
            border: "2px solid #000000",
            borderRadius: "999px",
            padding: "4px 4px",
            fontWeight: "700",
            fontSize: "12px",
            color: "#111",
            cursor: "pointer",
            boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
          }}
        >
          ← Back
        </button>
        
        
        {/* Embedded YouTube player */}
        <iframe
          title="KIDVID Player"
          src={src}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="origin-when-cross-origin"
          allowFullScreen
          style={{
            width: "100%",
            height: "100%",
            border: 0,
            display: "block",
          }}
        />
      </div>

      {/* === AdMob banner below player (unchanged) === */}
      {typeof PlayerBanner === "function" ? (
        <PlayerBanner slot="banner-player-bottom" />
      ) : (
        <div
          className="ad"
          data-admob-slot="banner-player-bottom"
          style={{
            height: 120,
            marginTop: 10,
            borderRadius: 12,
            background: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 3px 10px rgba(0,0,0,.08)",
          }}
        >
          <span style={{ fontFamily: "monospace", color: "#555" }}>
            AdMob Banner • banner-player-bottom
          </span>
        </div>
      )}
    </div>
  );
}
