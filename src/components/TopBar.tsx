import { AccountButton } from "./AccountButton";

export function TopBar({
  title,
  subtitle,
  initials,
  children,
}: {
  title: string;
  subtitle?: string;
  initials: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="topbar">
      <div className="brand-row">
        <span className="brand-mark" />
        <span className="brand-name">
          Stride<b>Vote</b>
        </span>
      </div>
      <div className="topbar-main">
        <div>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <AccountButton initials={initials} />
      </div>
      {children}
    </div>
  );
}
