import { useNavigate } from "react-router-dom";

export default function VideoCard({ v }) {
  const nav = useNavigate();
  return (
    <div className="card" onClick={() => nav(`/watch/${v.id}`)} role="button">
      <img className="thumb" src={v.thumb} alt={v.title} loading="lazy" />
      <div className="title">{v.title}</div>
      <div className="meta">{v.channel}</div>
    </div>
  );
}
