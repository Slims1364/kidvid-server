const OPTIONS = [
  { k: "1-2", label: "1 - 2" },
  { k: "3-5", label: "3 - 5" },
  { k: "6-8", label: "6 - 8" }
];

export default function AgeButtons({ value, onChange }) {
  return (
    <div className="row" style={{ marginTop: "-5px", marginBottom: "1px" }}>
      {OPTIONS.map((o) => (
        <button
          key={o.k}
          className={`btn ${value === o.k ? "active" : ""}`}
          onClick={() => onChange(o.k)}
          style={{
  backgroundColor:
    o.k === "1-2" ? "#dfd21bff" :
    o.k === "3-5" ? "#a5f0ff" :
    "#ffb3ba",
  border: "2px solid #ffd700",
  borderRadius: "15px",
  padding: "8px 1px",
  width: "90px",
  height: "40px",
  fontWeight: "600",
  fontSize: "16px",
  textAlign: "center",
  cursor: "pointer"
}}

        >
          Ages {o.label}
        </button>
      ))}
    </div>
  );
}
