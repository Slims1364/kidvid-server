import { createBrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import Player from "./components/Player.jsx";

export const router = createBrowserRouter([
  { path: "/", element: <App /> },
  { path: "/watch/:id", element: <Player /> }
]);
