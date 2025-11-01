import VideoCard from "./VideoCard.jsx";
import AdPlacard from "./AdPlacard.jsx";

export default function Grid({ items }) {
  const blocks = [];
  let i = 0;
  while (i < items.length) {
    // two videos
    for (let k = 0; k < 2 && i < items.length; k++, i++) {
      blocks.push(<VideoCard v={items[i]} key={`v-${items[i].id}`} />);
    }
    // two ads
    blocks.push(<AdPlacard slot={`banner-${i}-a`} key={`a-${i}-1`} />);
    blocks.push(<AdPlacard slot={`banner-${i}-b`} key={`a-${i}-2`} />);
  }
  return <div className="grid">{blocks}</div>;
}
