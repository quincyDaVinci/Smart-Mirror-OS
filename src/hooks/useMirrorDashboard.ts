import { useEffect, useState } from "react";
import { dashboardData } from "../data/mockDashboard";
import type { DashboardData } from "../types/dashboard";
import { getWebSocketUrl } from "../utils/getWebSocketUrl";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function getApiBaseUrl() {
  const url = new URL(getWebSocketUrl());
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return url.origin;
}

export function useMirrorDashboard() {
  const [data, setData] = useState<DashboardData>(dashboardData);

  useEffect(() => {
    let isCancelled = false;

    async function fetchDashboard() {
      try {
        const response = await fetch(`${getApiBaseUrl()}/dashboard`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();

        if (
          !payload ||
          typeof payload !== "object" ||
          !payload.weather ||
          !payload.calendar
        ) {
          throw new Error("Dashboard antwoord heeft ongeldig formaat.");
        }

        if (!isCancelled) {
          setData({
            weather: payload.weather,
            calendar: payload.calendar,
          });
        }
      } catch (error) {
        console.error("failed to fetch dashboard", error);
      }
    }

    void fetchDashboard();

    const intervalId = window.setInterval(() => {
      void fetchDashboard();
    }, REFRESH_INTERVAL_MS);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  return data;
}