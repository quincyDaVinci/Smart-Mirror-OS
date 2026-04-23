type CalendarWidgetProps = {
  time: string;
  title: string;
  variant?: "edge" | "focus";
};

function CalendarIcon() {
  return (
    <span className="widget-icon" aria-hidden>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
        <rect
          x="3"
          y="5"
          width="18"
          height="16"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <path
          d="M8 3v4M16 3v4M3 10h18"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function CalendarWidget({
  time,
  title,
  variant = "edge",
}: CalendarWidgetProps) {
  return (
    <section className={`widget agenda agenda--${variant}`}>
      <div>
        <p className="widget-label widget-label--with-icon">
          <CalendarIcon />
          <span>Volgende afspraak</span>
        </p>
        <h2 className="widget-value">{time}</h2>
        <p className="widget-subtle">{title}</p>
      </div>
    </section>
  );
}