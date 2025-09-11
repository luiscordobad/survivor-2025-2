import React from "react";
import ReactDOM from "react-dom/client";
import AppRoot from "./App.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import "./styles.css"; // si no la usas, quítala

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppRoot />
    </ErrorBoundary>
  </React.StrictMode>
);

