interface SettingsSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <section className="bg-surface-800/30 rounded-lg p-4">
      <h3 className="text-base font-medium text-surface-100 mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-surface-500 mb-4">{description}</p>
      )}
      <div>{children}</div>
    </section>
  );
}
