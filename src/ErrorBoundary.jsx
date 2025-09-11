import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(error) { return { err: error }; }
  componentDidCatch(error, info) { console.error("💥 ErrorBoundary:", error, info); }
  render() {
    if (this.state.err) {
      return (
        <div style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system", padding: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Oops, algo rompió la app 😬</h1>
          <p style={{ color: "#555", marginBottom: 16 }}>Corrige y recarga. Detalle abajo:</p>
          <pre style={{ background: "#111", color: "#0f0", padding: 12, borderRadius: 8, overflow: "auto", maxHeight: 360 }}>
            {String(this.state.err?.stack || this.state.err?.message || this.state.err)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
