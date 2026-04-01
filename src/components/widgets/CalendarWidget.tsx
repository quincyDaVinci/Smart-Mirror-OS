type CalendarWidgetProps = {
  time: string;
  title: string;
};

export function CalendarWidget({ time, title }: CalendarWidgetProps) {
  return (
    <section className="widget agenda">
      <div>
        <p className="widget-label">Volgende afspraak</p>
        <h2 className="widget-value">{time}</h2>
        <p className="widget-subtle">{title}</p>
      </div>
    </section>
  );
}