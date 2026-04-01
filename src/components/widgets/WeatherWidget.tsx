type WeatherWidgetProps = {
  temperature: string;
  location: string;
};

export function WeatherWidget({
  temperature,
  location,
}: WeatherWidgetProps) {
  return (
    <section className="widget weather">
      <div>
        <p className="widget-label">Weer</p>
        <h2 className="widget-value">{temperature}</h2>
        <p className="widget-subtle">{location}</p>
      </div>
    </section>
  );
}