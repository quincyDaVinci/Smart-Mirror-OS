import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useMirrorSocket } from "./hooks/useMirrorSocket";
import { MirrorPage } from "./pages/MirrorPage";
import { AdminPage } from "./pages/AdminPage";

function App() {
  const {
    layout,
    settings,
    presence,
    display,
    isConnected,
    toggleWidget,
    reorderLayout,
    updateSettings,
    simulateMotion,
  } = useMirrorSocket();

  if (!layout.length) {
    return (
      <main
        style={{
          minHeight: "100vh",
          padding: 24,
          background: "black",
          color: "white",
        }}
      >
        Verbinden...
      </main>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <MirrorPage
              layout={layout}
              settings={settings}
              presence={presence}
              display={display}
            />
          }
        />
        <Route
          path="/admin"
          element={
            <AdminPage
              layout={layout}
              settings={settings}
              presence={presence}
              display={display}
              onToggleWidget={toggleWidget}
              onReorderWidgets={reorderLayout}
              onUpdateSettings={updateSettings}
              onSimulateMotion={simulateMotion}
              isConnected={isConnected}
            />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
