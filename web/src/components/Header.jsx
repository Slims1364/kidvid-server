export default function Header() {
  const text = "KID VID";
  return (
    <div className="h1" aria-label="KID VID">
      {text.split("").map((ch, i) =>
        ch === " " ? (
          <span key={i} style={{ width: 14 }} />
        ) : (
          <span className="balloon" key={i}>{ch}</span>
        )
      )}
    </div>
  );
}
