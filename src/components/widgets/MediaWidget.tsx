type MediaWidgetProps = {
  title: string;
  artist: string;
};

export function MediaWidget({ title, artist }: MediaWidgetProps) {
  return (
    <section className="widget media">
      <div>
        <p className="widget-label">Now Playing</p>
        <h2 className="widget-value">{title}</h2>
        <p className="widget-subtle">{artist}</p>
      </div>
    </section>
  );
}