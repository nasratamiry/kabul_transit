import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps): JSX.Element {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400">{description}</p>
        )}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
