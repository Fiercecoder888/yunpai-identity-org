import {
  DownloadOutlined,
  EyeOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
  type UploadFile,
} from 'antd';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { M3JsonlDetailDrawer } from '../features/m3/M3JsonlDetailDrawer';
import {
  downloadM3Jsonl,
  parseM3Jsonl,
  runM3JsonlBatch,
  type M3JsonlInputLine,
  type M3JsonlResult,
} from '../features/m3/jsonl';
import {
  createM3TrackingTaskId,
  runM3ProcurementRequirementsEnvelope,
} from '../services/m3Api';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const resultPlan = (result: M3JsonlResult) =>
  isRecord(result.envelope.data) ? result.envelope.data : null;

const resultLines = (result: M3JsonlResult) => {
  const lines = resultPlan(result)?.lines;
  return Array.isArray(lines) ? lines.filter(isRecord) : [];
};

const suggestedPurchaseTotal = (result: M3JsonlResult) =>
  resultLines(result).reduce((total, line) => {
    const quantity = Number(line.suggest_purchase_qty);
    return total + (Number.isFinite(quantity) ? quantity : 0);
  }, 0);

export function M3ProcurementPage() {
  const [jsonlEntries, setJsonlEntries] = useState<M3JsonlInputLine[]>([]);
  const [jsonlResults, setJsonlResults] = useState<M3JsonlResult[]>([]);
  const [jsonlFileList, setJsonlFileList] = useState<UploadFile[]>([]);
  const [selectedJsonlResult, setSelectedJsonlResult] = useState<M3JsonlResult | null>(null);
  const jsonlMutation = useMutation({
    mutationFn: () => {
      const trackingTaskId = createM3TrackingTaskId();
      return runM3JsonlBatch(jsonlEntries, async (payload) => {
        const response = await runM3ProcurementRequirementsEnvelope(payload, {
          trackingTaskId,
        });
        return {
          success: response.success,
          data: response.data,
          errors: response.errors ?? [],
          trace_id: response.trace_id ?? '',
        };
      });
    },
    onSuccess: (results) => {
      setJsonlResults(results);
      setSelectedJsonlResult(null);
      const successCount = results.filter((result) => result.envelope.success).length;
      void message.success(`M3 JSONL 执行完成：成功 ${successCount}，失败 ${results.length - successCount}`);
    },
    onError: () => void message.error('M3 JSONL 批处理失败'),
  });
  const jsonlSuccessCount = jsonlResults.filter((result) => result.envelope.success).length;
  const jsonlParseErrorCount = jsonlEntries.filter((entry) => entry.parseError).length;

  const selectJsonlFile = (file: File & { uid: string }) => {
    if (!file.name.toLowerCase().endsWith('.jsonl')) {
      void message.error('请选择 .jsonl 文件');
      return Upload.LIST_IGNORE;
    }
    setJsonlFileList([{ uid: file.uid, name: file.name, status: 'uploading' }]);
    void file
      .text()
      .then((content) => {
        const entries = parseM3Jsonl(content);
        setJsonlEntries(entries);
        setJsonlResults([]);
        setSelectedJsonlResult(null);
        setJsonlFileList([{ uid: file.uid, name: file.name, status: 'done' }]);
        if (entries.length === 0) {
          void message.warning('JSONL 文件没有非空数据行');
        }
      })
      .catch(() => {
        setJsonlEntries([]);
        setJsonlResults([]);
        setSelectedJsonlResult(null);
        setJsonlFileList([{ uid: file.uid, name: file.name, status: 'error' }]);
        void message.error('JSONL 文件读取失败');
      });
    return false;
  };

  const clearJsonlFile = () => {
    setJsonlFileList([]);
    setJsonlEntries([]);
    setJsonlResults([]);
    setSelectedJsonlResult(null);
    return true;
  };

  return (
    <Space direction="vertical" size={16} className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>M3 物料计划</Typography.Title>
          <Typography.Text type="secondary">
            上传完整订单 JSONL，计算并查看订单、BOM、库存、在途和采购需求。
          </Typography.Text>
        </div>
      </div>

      <Card title="真实订单 JSONL 测试">
        <Space direction="vertical" size={16} className="page-stack">
          <Alert
            type="info"
            showIcon
            message="正式 M3 采购需求接口"
            description="每个非空行是一份完整订单输入；执行结果按原顺序输出为标准响应 JSONL。"
          />
          <Space wrap>
            <Upload
              accept=".jsonl,application/x-ndjson"
              maxCount={1}
              beforeUpload={selectJsonlFile}
              fileList={jsonlFileList}
              onRemove={clearJsonlFile}
            >
              <Button icon={<UploadOutlined />}>选择 JSONL</Button>
            </Upload>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              disabled={jsonlEntries.length === 0}
              loading={jsonlMutation.isPending}
              onClick={() => jsonlMutation.mutate()}
            >
              执行全部
            </Button>
            <Button
              icon={<DownloadOutlined />}
              disabled={jsonlResults.length === 0}
              onClick={() =>
                downloadM3Jsonl(
                  `m3-output-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.jsonl`,
                  jsonlResults.map((result) => result.envelope),
                )
              }
            >
              下载输出 JSONL
            </Button>
            <Button
              icon={<FileTextOutlined />}
              href="/samples/ORD-DEMO-M3-0004.input.jsonl"
              download
            >
              真实输入样例
            </Button>
            <Button
              icon={<FileTextOutlined />}
              href="/samples/ORD-DEMO-M3-0004.output.jsonl"
              download
            >
              真实输出样例
            </Button>
          </Space>

          {jsonlEntries.length > 0 ? (
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
              <Descriptions.Item label="数据行">{jsonlEntries.length}</Descriptions.Item>
              <Descriptions.Item label="可执行">{jsonlEntries.length - jsonlParseErrorCount}</Descriptions.Item>
              <Descriptions.Item label="解析失败">{jsonlParseErrorCount}</Descriptions.Item>
              <Descriptions.Item label="执行状态">
                {jsonlResults.length > 0 ? '已完成' : '待执行'}
              </Descriptions.Item>
            </Descriptions>
          ) : null}

          {jsonlParseErrorCount > 0 ? (
            <Alert
              type="warning"
              showIcon
              message={`${jsonlParseErrorCount} 行无法解析`}
              description="无效行会保留在输出顺序中，并生成 success=false 的标准失败响应。"
            />
          ) : null}

          {jsonlResults.length > 0 ? (
            <>
              <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
                <Descriptions.Item label="总数">{jsonlResults.length}</Descriptions.Item>
                <Descriptions.Item label="成功">{jsonlSuccessCount}</Descriptions.Item>
                <Descriptions.Item label="失败">{jsonlResults.length - jsonlSuccessCount}</Descriptions.Item>
                <Descriptions.Item label="采购数值合计（混合单位）">
                  {jsonlResults.reduce((total, result) => total + suggestedPurchaseTotal(result), 0)}
                </Descriptions.Item>
              </Descriptions>
              <Table
                rowKey={(result) => String(result.lineNumber)}
                size="small"
                pagination={{ pageSize: 10, hideOnSinglePage: true }}
                dataSource={jsonlResults}
                scroll={{ x: 1450 }}
                columns={[
                  { title: '行', dataIndex: 'lineNumber', width: 64 },
                  {
                    title: '订单号',
                    width: 190,
                    render: (_, result) => result.orderId || '-',
                  },
                  {
                    title: '状态',
                    width: 90,
                    render: (_, result) => (
                      <Tag color={result.envelope.success ? 'green' : 'red'}>
                        {result.envelope.success ? '成功' : '失败'}
                      </Tag>
                    ),
                  },
                  {
                    title: '采购计划',
                    width: 190,
                    render: (_, result) =>
                      String(resultPlan(result)?.procurement_plan_id ?? '-'),
                  },
                  {
                    title: '物料数',
                    width: 90,
                    render: (_, result) => resultLines(result).length,
                  },
                  {
                    title: 'BOM',
                    width: 80,
                    render: (_, result) => {
                      const bom = result.payload && isRecord(result.payload.bom) ? result.payload.bom : null;
                      return bom && Array.isArray(bom.lines) ? bom.lines.length : 0;
                    },
                  },
                  {
                    title: '库存',
                    width: 80,
                    render: (_, result) =>
                      result.payload && Array.isArray(result.payload.inventory_snapshot)
                        ? result.payload.inventory_snapshot.length
                        : 0,
                  },
                  {
                    title: '在途',
                    width: 80,
                    render: (_, result) =>
                      result.payload && Array.isArray(result.payload.open_purchase_orders)
                        ? result.payload.open_purchase_orders.length
                        : 0,
                  },
                  {
                    title: '采购数值合计',
                    width: 130,
                    render: (_, result) => suggestedPurchaseTotal(result),
                  },
                  {
                    title: 'Trace / 错误',
                    width: 260,
                    render: (_, result) =>
                      result.envelope.success
                        ? result.envelope.trace_id || '-'
                        : result.envelope.errors[0]?.message ?? '请求失败',
                  },
                  {
                    title: '操作',
                    width: 130,
                    fixed: 'right',
                    render: (_, result) => (
                      <Button
                        icon={<EyeOutlined />}
                        disabled={!result.payload}
                        onClick={() => setSelectedJsonlResult(result)}
                      >
                        查看详情
                      </Button>
                    ),
                  },
                ]}
              />
            </>
          ) : null}
        </Space>
      </Card>
      <M3JsonlDetailDrawer
        result={selectedJsonlResult}
        onClose={() => setSelectedJsonlResult(null)}
      />
    </Space>
  );
}
