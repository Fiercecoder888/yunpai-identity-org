import { Card, Space } from 'antd';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeading } from '../components/PageHeading';
import { PermissionGate } from '../components/PermissionGate';
import { PageState } from '../components/PageState';
import { CollapsibleSearchArea } from '../components/table/CollapsibleSearchArea';
import { useTableSearch } from '../hooks/useTableSearch';
import { AuditLogTable } from '../features/audit/AuditLogTable';
import { getAuditLogs } from '../services/auditApi';

export function AuditLogPage() {
  return (
    <PermissionGate permission="audit:read" auditModule="Audit" targetId="audit-log">
      <AuditLogContent />
    </PermissionGate>
  );
}

function AuditLogContent() {
  const query = useQuery({ queryKey: ['audit-logs'], queryFn: getAuditLogs });
  const search = useTableSearch({ defaultFilters: { keyword: '' }, pageSize: 10 });

  const logs = useMemo(() => {
    const needle = search.filters.keyword?.trim().toLowerCase() ?? '';
    if (!needle) {
      return query.data;
    }
    return query.data?.filter((item) =>
      [item.time, item.actor, item.action, item.module, item.targetId, item.detail]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [query.data, search.filters.keyword]);

  return (
    <Space direction="vertical" size={16} className="page-stack">
      <PageHeading path="/audit" />
      <CollapsibleSearchArea
        fields={[{ key: 'keyword', label: '审计搜索', placeholder: '搜索操作人、动作或详情', width: 260 }]}
        values={search.filters}
        onSearch={(values) => search.applyFilters({ keyword: values.keyword ?? '' })}
        onReset={search.resetFilters}
      />
      <Card>
        <PageState loading={query.isLoading} error={query.error} empty={query.data?.length === 0} onRetry={() => void query.refetch()}>
          <AuditLogTable logs={logs} />
        </PageState>
      </Card>
    </Space>
  );
}
