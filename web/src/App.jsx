import TopBanner from "./components/TopBanner.jsx";
import { useEffect, useState } from "react";
import Header from "./components/Header.jsx";
import SearchBar from "./components/SearchBar.jsx";
import AgeButtons from "./components/AgeButtons.jsx";
import Grid from "./components/Grid.jsx";
import AdPlacard from "./components/AdPlacard.jsx";
import { api } from "./api.js";
import "./styles.css";

export default function App() {
  const [age, setAge] = useState("3-5");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async (a) => {
    setLoading(true);
    try {
      const r = await api.listByAge(a, 24);
      setItems(r.items || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(age); }, [age]);

  const onSearch = async (q) => {
    if (!q) return load(age);
    setLoading(true);
    try {
      const r = await api.search(q, 40);
      setItems(r.items || []);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <Header />
      <SearchBar onSearch={onSearch} />
      <AgeButtons value={age} onChange={setAge} />
      <TopBanner />
      {loading ? <div style={{ padding: 16 }}>loading…</div> : <Grid items={items} />}
    </div>
  );
}
