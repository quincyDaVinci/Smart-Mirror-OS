import { useEffect, useState } from "react";

export function ClockWidget() {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timerId = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => {
      clearInterval(timerId);
    };
  }, []);

  return (
  <section className="widget clock">
    <div className="clock-content">
      <p className="clock-time">
        {currentTime.toLocaleTimeString("nl-NL", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>

      <p className="clock-date">
        {currentTime.toLocaleDateString("nl-NL", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
      </p>
    </div>
  </section>
);
}