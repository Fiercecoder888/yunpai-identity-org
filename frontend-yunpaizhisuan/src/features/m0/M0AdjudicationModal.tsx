import { Form, Input, Modal } from 'antd';
import { useEffect } from 'react';

export type M0AdjudicationDecision = {
  kind: 'entity' | 'mapping';
  recordId: number;
  action: 'approve' | 'reject';
  currentTargetRef?: string;
};

export type M0AdjudicationValues = {
  targetRef: string;
  reason: string;
};

type Props = {
  decision: M0AdjudicationDecision | null;
  confirmLoading?: boolean;
  onCancel: () => void;
  onSubmit: (values: M0AdjudicationValues) => void;
};

export function M0AdjudicationModal({ decision, confirmLoading, onCancel, onSubmit }: Props) {
  const [form] = Form.useForm<M0AdjudicationValues>();
  const mappingApproval = decision?.kind === 'mapping' && decision.action === 'approve';

  useEffect(() => {
    if (!decision) return;
    form.setFieldsValue({
      targetRef: decision.currentTargetRef ?? '',
      reason: '',
    });
  }, [decision, form]);

  const submit = async () => {
    try {
      const values = await form.validateFields();
      onSubmit({ targetRef: values.targetRef?.trim() ?? '', reason: values.reason.trim() });
    } catch {
      // Ant Design renders field-level validation errors.
    }
  };

  return (
    <Modal
      open={Boolean(decision)}
      title={`${decision?.action === 'approve' ? '批准' : '拒绝'}${decision?.kind === 'mapping' ? '映射' : '实体'}`}
      okText="确认裁决"
      cancelText="取消"
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={() => void submit()}
      afterClose={() => form.resetFields()}
    >
      <Form form={form} layout="vertical" preserve={false}>
        {mappingApproval ? (
          <Form.Item
            name="targetRef"
            label="目标引用"
            rules={[
              { required: true, message: '请输入目标引用' },
              {
                pattern: /^(import_row:\d+|master:inventory:\d+)$/,
                message: '目标引用格式应为 import_row:ID 或 master:inventory:ID',
              },
            ]}
          >
            <Input autoComplete="off" />
          </Form.Item>
        ) : null}
        <Form.Item
          name="reason"
          label="裁决理由"
          rules={[
            { required: true, whitespace: true, message: '请输入裁决理由' },
            { max: 500, message: '裁决理由不能超过 500 字' },
          ]}
        >
          <Input.TextArea rows={3} maxLength={500} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}
