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

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDateLabel(date) {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  const eventDateKey = formatDateKey(date);

  if (eventDateKey === formatDateKey(now)) {
    return "Vandaag";
  }

  if (eventDateKey === formatDateKey(tomorrow)) {
    return "Morgen";
  }

  return new Intl.DateTimeFormat("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

function isValidDate(date) {
  return date instanceof Date && !Number.isNaN(date.getTime());
}

function normalizeCalendarItem(summary, startDate, endDate) {
  if (!summary || !isValidDate(startDate)) {
    return null;
  }

  const normalizedEndDate = isValidDate(endDate) && endDate > startDate
    ? endDate
    : null;

  return {
    id: `${summary}-${startDate.toISOString()}`,
    title: summary,
    date: formatDateLabel(startDate),
    time: formatTimeLabel(startDate),
    endTime: normalizedEndDate ? formatTimeLabel(normalizedEndDate) : undefined,
    startsAt: startDate.getTime(),
    endsAt: normalizedEndDate ? normalizedEndDate.getTime() : undefined,
  };
}

function compareCalendarItemsByStart(a, b) {
  if (a.startsAt !== b.startsAt) {
    return a.startsAt - b.startsAt;
  }

  return a.title.localeCompare(b.title, "nl-NL");
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
        toJsDate(event.endDate),
      ),
    )
    .filter(Boolean);

  const recurringEvents = results.occurrences
    .map((occurrence) =>
      normalizeCalendarItem(
        occurrence.item?.summary,
        toJsDate(occurrence.startDate),
        toJsDate(occurrence.endDate),
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
  ).sort(compareCalendarItemsByStart);

  return {
    calendar: {
      items: dedupedItems.slice(0, 4).map((item) => ({
        date: item.date,
        time: item.time,
        endTime: item.endTime,
        title: item.title,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
      })),
    },
  };
}

module.exports = {
  fetchMirrorAgenda,
};
