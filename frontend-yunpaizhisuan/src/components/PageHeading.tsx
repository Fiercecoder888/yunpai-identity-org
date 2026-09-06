import { Typography } from 'antd';
import type { ReactNode } from 'react';
import { usePageHeading } from '../app/usePageHeading';

type PageHeadingProps = {
  path?: string;
  description?: string;
  extra?: ReactNode;
};

export function PageHeading({ path, description, extra }: PageHeadingProps) {
  const { title, description: metaDescription } = usePageHeading(path);
  const resolvedDescription = description ?? metaDescription;

  return (
    <div className="page-heading">
      <div>
        <Typography.Title level={2} data-testid="page-heading-title">
          {title}
        </Typography.Title>
        {resolvedDescription ? <Typography.Text type="secondary">{resolvedDescription}</Typography.Text> : null}
      </div>
      {extra ? <div className="page-heading-actions">{extra}</div> : null}
    </div>
  );
}
