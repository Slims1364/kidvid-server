import { useState } from "react";

export default function SearchBar({ onSearch }) {
  const [q, setQ] = useState("");

  const go = () => onSearch(q.trim());

  return (
    <div className="searchWrap" style={{ marginTop: "30px" }}>
      <input
        className="searchBox"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
        placeholder="Search videos..."
      />
      <button className="searchClick" onClick={go}>Search</button>
    </div>
  );
}
