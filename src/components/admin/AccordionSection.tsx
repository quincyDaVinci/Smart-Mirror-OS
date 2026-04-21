import { useState, type ReactNode } from "react";

type AccordionSectionProps = {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  subtitle?: string;
};

export function AccordionSection({
  title,
  children,
  defaultOpen = false,
  subtitle,
}: AccordionSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section
      className={`admin-card admin-accordion ${
        isOpen ? "admin-accordion--open" : ""
      }`}
    >
      <button
        type="button"
        className="admin-accordion__trigger"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
      >
        <div className="admin-accordion__trigger-text">
          <h2 className="admin-accordion__title">{title}</h2>
          {subtitle ? (
            <p className="admin-accordion__subtitle">{subtitle}</p>
          ) : null}
        </div>

        <span className="admin-accordion__chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      <div className="admin-accordion__content">
        <div className="admin-accordion__content-inner">{children}</div>
      </div>
    </section>
  );
}