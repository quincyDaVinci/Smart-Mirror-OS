import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useMirrorSocket } from "./hooks/useMirrorSocket";
import { MirrorPage } from "./pages/MirrorPage";
import { AdminPage } from "./pages/AdminPage";

function App() {
  const {
    layout,
    isConnected,
    toggleWidget,
    reorderLayout,
  } = useMirrorSocket();

  if (!layout.length) {
    return (
      <main style={{ minHeight: "100vh", padding: 24, background: "black", color: "white" }}>
        Verbinden...
      </main>
    );
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
              onReorderWidgets={reorderLayout}
              isConnected={isConnected}
            />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;