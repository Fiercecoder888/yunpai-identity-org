import { PlayCircleOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Form, Input, Row, Space, Switch, Typography } from 'antd';
import { defaultM2WorkflowValues, type M2WorkflowFormValues } from './m2Workflow';

type M2WorkflowPanelProps = {
  mode: 'bom' | 'sop';
  loading: boolean;
  onRun: (values: M2WorkflowFormValues) => Promise<unknown>;
};

export function M2WorkflowPanel({ mode, loading, onRun }: M2WorkflowPanelProps) {
  const [form] = Form.useForm<M2WorkflowFormValues>();
  const isSop = mode === 'sop';

  return (
    <Card title={isSop ? 'SOP 生成参数' : 'BOM 生成参数'}>
      <Alert
        type="info"
        showIcon
        message={isSop ? '生成 SOP 工程草稿' : '生成 BOM 工程草稿'}
        description={
          isSop
            ? '当前模块只展示 SOP 工艺流程和 SOP 制品；BOM 明细请在 BOM 模块查看。'
            : '当前模块只展示 BOM 结构和 BOM 制品；SOP 工艺流程请在 SOP 模块查看。'
        }
      />
      <Form
        className="stacked-card"
        form={form}
        layout="vertical"
        initialValues={defaultM2WorkflowValues}
        onFinish={(values) => {
          void onRun({ ...defaultM2WorkflowValues, ...values }).catch(() => undefined);
        }}
      >
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item label="产品名称" name="productName" rules={[{ required: true, message: '请输入产品名称' }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item label="产品料号" name="productCode" rules={[{ required: true, message: '请输入产品料号' }]}>
              <Input />
            </Form.Item>
          </Col>
          {isSop ? (
            <Col xs={24} md={8}>
              <Form.Item label="工站" name="station">
                <Input />
              </Form.Item>
            </Col>
          ) : (
            <Col xs={24} md={8}>
              <Form.Item label="产品族" name="productFamily">
                <Input />
              </Form.Item>
            </Col>
          )}
        </Row>
        <Form.Item label="规格摘要" name="specificationSummary" rules={[{ required: true, message: '请输入规格摘要' }]}>
          <Input />
        </Form.Item>
        <Form.Item label="生成需求" name="requirementText" rules={[{ required: true, message: '请输入生成需求' }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
        {isSop ? (
          <>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item label="SOP 文件编号" name="documentNo">
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item label="模型增强" name="useModel" valuePropName="checked">
                  <Switch checkedChildren="启用" unCheckedChildren="快速规则模式" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} lg={12}>
                <Form.Item label="工艺路线（每行一步）" name="routingStepsText" rules={[{ required: true, message: '请输入工艺路线' }]}>
                  <Input.TextArea rows={6} />
                </Form.Item>
              </Col>
              <Col xs={24} lg={12}>
                <Form.Item label="设备/治具线索" name="machineHintsText">
                  <Input.TextArea rows={6} />
                </Form.Item>
              </Col>
            </Row>
          </>
        ) : (
          <Form.Item label="模型增强" name="useModel" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="快速规则模式" />
          </Form.Item>
        )}
        <Space>
          <Button type="primary" htmlType="submit" icon={<PlayCircleOutlined />} loading={loading}>
            {isSop ? '生成 SOP 工程草稿' : '生成 BOM 工程草稿'}
          </Button>
          <Typography.Text type="secondary">默认使用快速规则模式；模型增强会明显增加运行时间。</Typography.Text>
        </Space>
      </Form>
    </Card>
  );
}
