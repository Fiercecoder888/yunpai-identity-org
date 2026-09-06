import { Alert, Button, Card, Drawer, Form, Input, Space, Table, Typography, message } from 'antd';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageState } from '../components/PageState';
import { StatusTag } from '../components/StatusTag';
import { getLegalRisks, submitLegalFinalReview } from '../services/legalApi';
import { AUDIT_LOG_SYNC_FAILURE_MESSAGE, createAuditLog, writeAuditLogSafely } from '../services/auditLogger';
import { isMswDemoMode } from '../app/runtimeMode';
import type { LegalRisk } from '../types/api';

type LegalOpinionFormValues = {
  opinion: string;
};

const DEMO_LEGAL_QUERY_KEY = ['demo', 'legal-risks'] as const;

function DemoLegalFinalReviewPage() {
  const [selectedRisk, setSelectedRisk] = useState<LegalRisk | null>(null);
  const [auditWarning, setAuditWarning] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [form] = Form.useForm<LegalOpinionFormValues>();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: DEMO_LEGAL_QUERY_KEY, queryFn: getLegalRisks });
  const mutation = useMutation({
    mutationFn: async ({ id, status, opinion }: { id: string; status: 'approved' | 'rejected' | 'escalated'; opinion: string }) => {
      const risk = await submitLegalFinalReview(id, status, opinion);
      const auditResult = await writeAuditLogSafely(
        createAuditLog({
          actor: 'demo-legal-reviewer',
          action: 'DEMO_LEGAL_FINAL_REVIEW_RECORDED',
          module: 'LegalDemo',
          targetId: id,
          result: 'success',
          detail: `[DEMO] ${status}：${opinion}`,
        }),
      );
      return { risk, auditLogged: auditResult.ok };
    },
    onSuccess: async ({ auditLogged }) => {
      await queryClient.invalidateQueries({ queryKey: DEMO_LEGAL_QUERY_KEY, exact: true });
      setSelectedRisk(null);
      form.resetFields();
      setAuditWarning(!auditLogged);
      setSuccessMessage('演示终审意见已记录');
      void message.success('演示终审意见已记录');
      if (!auditLogged) {
        void message.warning(AUDIT_LOG_SYNC_FAILURE_MESSAGE);
      }
    },
    onError: () => {
      void message.error('演示终审意见记录失败');
    },
  });

  const openRisk = (risk: LegalRisk) => {
    setSuccessMessage(null);
    setSelectedRisk(risk);
    form.setFieldsValue({ opinion: '风险条款已复核，建议进入人工终审结论。' });
  };

  const submitWithStatus = async (status: 'approved' | 'rejected' | 'escalated') => {
    if (!selectedRisk) {
      return;
    }
    try {
      const values = await form.validateFields();
      mutation.mutate({ id: selectedRisk.id, status, opinion: values.opinion });
    } catch {
      // Ant Design Form renders field-level validation messages for expected validation failures.
    }
  };

  return (
    <>
      <Card title="法务高风险终审演示">
        <Alert
          type="warning"
          showIcon
          message="仅供 Demo 演示"
          description="以下均为隔离的样例数据，不代表 M7 已交付，不构成真实法务结论，也不会改变 M5 订单或排程。"
        />
        {successMessage ? <Alert className="inline-alert" type="success" showIcon message={successMessage} /> : null}
        {auditWarning ? <Alert className="inline-alert" type="warning" showIcon message={AUDIT_LOG_SYNC_FAILURE_MESSAGE} description="主终审操作已完成，日志稍后补偿同步。" /> : null}
        <PageState loading={query.isLoading} error={query.error} empty={query.data?.length === 0}>
          <Table
            className="legal-demo-table"
            rowKey="id"
            pagination={false}
            scroll={{ x: 760 }}
            dataSource={query.data}
            columns={[
              { title: '合同编号', dataIndex: 'id', width: 150 },
              { title: '合同名称', dataIndex: 'title' },
              { title: '阶段', dataIndex: 'reviewRound', width: 150 },
              { title: '风险', dataIndex: 'riskLevel', width: 120, render: (value: string) => <StatusTag value={value} /> },
              { title: '状态', dataIndex: 'status', width: 120, render: (value: string) => <StatusTag value={value === 'pending' ? 'pending' : 'completed'} /> },
              { title: '操作', width: 120, render: (_, item) => <Button onClick={() => openRisk(item)}>查看终审</Button> },
            ]}
          />
        </PageState>
      </Card>
      <Drawer title="合同风险终审演示" open={selectedRisk !== null} onClose={() => setSelectedRisk(null)} width={480}>
        {selectedRisk ? (
          <Space direction="vertical" size={16} className="page-stack">
            <Typography.Title level={4}>{selectedRisk.title}</Typography.Title>
            <StatusTag value={selectedRisk.riskLevel} />
            <Typography.Paragraph>{selectedRisk.summary}</Typography.Paragraph>
            <Form form={form} layout="vertical">
              <Form.Item label="终审意见" name="opinion" rules={[{ required: true, message: '请输入终审意见' }]}>
                <Input.TextArea rows={4} />
              </Form.Item>
            </Form>
            <Space wrap>
              <Button type="primary" loading={mutation.isPending} onClick={() => void submitWithStatus('approved')}>
                终审通过
              </Button>
              <Button danger loading={mutation.isPending} onClick={() => void submitWithStatus('rejected')}>
                驳回
              </Button>
              <Button loading={mutation.isPending} onClick={() => void submitWithStatus('escalated')}>
                升级
              </Button>
            </Space>
          </Space>
        ) : null}
      </Drawer>
    </>
  );
}

function RealLegalBoundary() {
  return (
    <Card title="法务终审">
      <Alert
        type="warning"
        showIcon
        message="M7 法务终审未交付"
        description="当前 M5→M7 与 M7→M5 均为 current_none，没有真实 API、事件或数据消费契约。本页面不会请求 Legal 数据，也不会产生法务结论或影响 M5 订单与排程。"
      />
    </Card>
  );
}

export function LegalFinalReviewPage() {
  return isMswDemoMode() ? <DemoLegalFinalReviewPage /> : <RealLegalBoundary />;
}
