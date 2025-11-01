const API =
  (import.meta.env && import.meta.env.VITE_KIDVID_API) ||
  "https://kidvid-server.onrender.com";

console.log("KIDVID_API =", API); // verify .env read

const get = async (path) => {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
};

// unified, works for App.jsx and Grid.jsx
export const listByAge = (age, limit = 50) =>
  get(`/videos?age=${encodeURIComponent(age)}&limit=${limit}`);

export const search = (q, limit = 40) =>
  get(`/search?q=${encodeURIComponent(q)}&limit=${limit}`);

export const api = {
  listByAge, // <- now exists
  byAge: listByAge,
  search
};
