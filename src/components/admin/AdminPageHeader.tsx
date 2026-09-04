export function AdminPageHeader({
  title,
  subtitle,
  icon,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="admin-page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {icon || actions ? (
        <div className="admin-page-actions">
          {icon}
          {actions}
        </div>
      ) : null}
    </header>
  );
}
