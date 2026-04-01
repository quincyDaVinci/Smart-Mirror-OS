import { BrowserRouter, Route, Routes } from "react-router-dom";
import { MirrorPage } from "./pages/MirrorPage";
import { AdminPage } from "./pages/AdminPage";
import { useMirrorSocket } from "./hooks/useMirrorSocket";

function App() {
  const {
    layout,
    isConnected,
    toggleWidget,
    moveWidget,
  } = useMirrorSocket();

  if (!layout.length) {
    return <main style={{ padding: 24, color: "white" }}>Verbinden...</main>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MirrorPage layout={layout} />} />
        <Route
          path="/admin"
          element={
            <AdminPage
              layout={layout}
              onToggleWidget={toggleWidget}
              onMoveUp={(widgetId) => moveWidget(widgetId, "up")}
              onMoveDown={(widgetId) => moveWidget(widgetId, "down")}
              isConnected={isConnected}
            />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;