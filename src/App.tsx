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
    connectionStatus,
    connectionError,
    toggleWidget,
    reorderLayout,
    updateSettings,
    simulateMotion,
    deployment,
    checkDeploymentUpdate,
    deployLatestVersion,
    media,
    logs,
    clientLogs,
    lastHttpSuccessAt,
  } = useMirrorSocket();

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
              media={media}
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
              deployment={deployment}
              onCheckDeploymentUpdate={checkDeploymentUpdate}
              onDeployLatestVersion={deployLatestVersion}
              isConnected={isConnected}
              connectionStatus={connectionStatus}
              connectionError={connectionError}
              logs={logs}
              clientLogs={clientLogs}
              lastHttpSuccessAt={lastHttpSuccessAt}
            />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
