import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { layoutConfig } from "./config/layoutConfig";
import { MirrorPage } from "./pages/MirrorPage";
import { AdminPage } from "./pages/AdminPage";
import type { LayoutItem, WidgetId } from "./types/layout";

const STORAGE_KEY = "smart-mirror-layout";

function App() {
  const [layout, setLayout] = useState<LayoutItem[]>(() => {
    const savedLayout = localStorage.getItem(STORAGE_KEY);

    if (savedLayout) {
      return JSON.parse(savedLayout);
    }

    return layoutConfig;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

  function toggleWidget(widgetId: WidgetId) {
    setLayout((currentLayout) =>
      currentLayout.map((item) =>
        item.id === widgetId
          ? { ...item, enabled: !item.enabled }
          : item,
      ),
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MirrorPage layout={layout} />} />
        <Route
          path="/admin"
          element={
            <AdminPage layout={layout} onToggleWidget={toggleWidget} />
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;