import { Button, Form, Input, Space } from 'antd';
import { useEffect } from 'react';
import type { M1ReviewSubmit } from '../../schemas/m1';
import type { M1ReviewItem } from '../../types/api';

type ReviewConfirmationFormProps = {
  item: M1ReviewItem | null;
  submitting: boolean;
  onSubmit: (payload: M1ReviewSubmit, approve: boolean) => void;
};

export function ReviewConfirmationForm({ item, submitting, onSubmit }: ReviewConfirmationFormProps) {
  const [form] = Form.useForm<M1ReviewSubmit>();

  useEffect(() => {
    form.setFieldsValue({
      correctedValue: item?.recognizedValue ?? '',
      reason: '',
    });
  }, [form, item]);

  return (
    <Form form={form} layout="vertical" disabled={!item} onFinish={(payload) => onSubmit(payload, true)}>
      <Form.Item label="修正值" name="correctedValue">
        <Input placeholder="保持原值即可直接通过，也可填写人工修正值" />
      </Form.Item>
      <Form.Item label="审核说明" name="reason" rules={[{ required: true, message: '请输入审核说明' }]}>
        <Input.TextArea rows={3} placeholder="说明修正或驳回原因" />
      </Form.Item>
      <Space>
        <Button type="primary" htmlType="submit" loading={submitting} disabled={!item}>
          通过并完成任务
        </Button>
        <Button
          danger
          loading={submitting}
          disabled={!item}
          onClick={() => {
            void form.validateFields(['reason']).then(() => onSubmit(form.getFieldsValue(), false));
          }}
        >
          驳回任务
        </Button>
        <Button onClick={() => form.resetFields()} disabled={!item || submitting}>
          重置
        </Button>
      </Space>
    </Form>
  );
}
