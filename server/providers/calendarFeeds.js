const IcalExpander = require("ical-expander");
const { getCalendarConfig } = require("../secretsStore");

function toJsDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value.toJSDate === "function") {
    return value.toJSDate();
  }

  return new Date(value);
}

function formatTimeLabel(date) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function normalizeCalendarItem(summary, startDate) {
  if (!summary || !startDate) {
    return null;
  }

  return {
    id: `${summary}-${startDate.toISOString()}`,
    title: summary,
    time: formatTimeLabel(startDate),
    startsAt: startDate.getTime(),
  };
}

async function fetchSingleFeed(url, windowStart, windowEnd) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`ICS feed gaf status ${response.status}`);
  }

  const ics = await response.text();

  const expander = new IcalExpander({
    ics,
    maxIterations: 1000,
  });

  const results = expander.between(windowStart, windowEnd);

  const directEvents = results.events
    .map((event) =>
      normalizeCalendarItem(
        event.summary,
        toJsDate(event.startDate),
      ),
    )
    .filter(Boolean);

  const recurringEvents = results.occurrences
    .map((occurrence) =>
      normalizeCalendarItem(
        occurrence.item?.summary,
        toJsDate(occurrence.startDate),
      ),
    )
    .filter(Boolean);

  return [...directEvents, ...recurringEvents];
}

async function fetchMirrorAgenda() {
  const { feedUrls } = getCalendarConfig();

  if (feedUrls.length === 0) {
    return {
      calendar: {
        items: [],
      },
    };
  }

  const now = new Date();
  const sevenDaysAhead = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const settledResults = await Promise.allSettled(
    feedUrls.map((url) => fetchSingleFeed(url, now, sevenDaysAhead)),
  );

  const items = settledResults
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((item) => item.startsAt >= Date.now())
    .sort((a, b) => a.startsAt - b.startsAt);

  const dedupedItems = Array.from(
    new Map(items.map((item) => [`${item.title}-${item.startsAt}`, item])).values(),
  );

  return {
    calendar: {
      items: dedupedItems.slice(0, 4).map((item) => ({
        time: item.time,
        title: item.title,
      })),
    },
  };
}

module.exports = {
  fetchMirrorAgenda,
};