import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useMirrorSocket } from "./hooks/useMirrorSocket";
import { MirrorPage } from "./pages/MirrorPage";
import { AdminPage } from "./pages/AdminPage";
import { RemoteControlPage } from "./pages/RemoteControlPage";

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
    updateWidgetPosition,
    updateSettings,
    focusWidget,
    clearWidgetFocus,
    setMediaLyricsVisible,
    simulateMotion,
    resetIdleTimer,
    deployment,
    checkDeploymentUpdate,
    deployLatestVersion,
    media,
    logs,
    clientLogs,
    lastHttpSuccessAt,
    providerConfigStatus,
    refreshProviderConfigStatus,
    saveProviderSecrets,
    apiBaseUrl,
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
              onUpdateWidgetPosition={updateWidgetPosition}
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
              providerConfigStatus={providerConfigStatus}
              onRefreshProviderConfigStatus={refreshProviderConfigStatus}
              onSaveProviderSecrets={saveProviderSecrets}
              apiBaseUrl={apiBaseUrl}
            />
          }
        />
        <Route
          path="/remote"
          element={
            <RemoteControlPage
              layout={layout}
              display={display}
              presence={presence}
              media={media}
              isConnected={isConnected}
              connectionStatus={connectionStatus}
              connectionError={connectionError}
              onFocusWidget={focusWidget}
              onClearFocus={clearWidgetFocus}
              onSetMediaLyricsVisible={setMediaLyricsVisible}
              onResetIdleTimer={resetIdleTimer}
            />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
