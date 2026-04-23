type WeatherWidgetProps = {
  temperature: string;
  location: string;
  variant?: "edge" | "focus";
};

function WeatherIcon() {
  return (
    <span className="widget-icon" aria-hidden>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
        <path
          d="M7 18h9.2a3.8 3.8 0 0 0 .7-7.53A5.6 5.6 0 0 0 6.24 9a3.6 3.6 0 0 0 .76 7"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M7.5 4.5v2.2M3.8 6.2 5.4 7.8M2.8 10h2.2"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function WeatherWidget({
  temperature,
  location,
  variant = "edge",
}: WeatherWidgetProps) {
  return (
    <section className={`widget weather weather--${variant}`}>
      <div>
        <p className="widget-label widget-label--with-icon">
          <WeatherIcon />
          <span>Weer</span>
        </p>
        <h2 className="widget-value">{temperature}</h2>
        <p className="widget-subtle">{location}</p>
      </div>
    </section>
  );
}