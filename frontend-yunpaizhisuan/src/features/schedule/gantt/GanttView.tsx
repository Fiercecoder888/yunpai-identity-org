import { Alert, Button, Descriptions, Drawer, Form, Input, InputNumber, Modal, Segmented, Select, Space, Tag, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScheduleBoard, ScheduleDependency, ScheduleTask } from '../../../types/api';
import { StatusTag } from '../../../components/StatusTag';
import { ActionGate } from '../../../components/ActionGate';
import { useWorkbenchStore, type ScheduleScale } from '../../../store/useWorkbenchStore';
import { exportCsv } from '../../../utils/export';
import { computeFocusWindow, computeTodayWindow, demoGanttAdapter, ganttTimelineHelpers } from './GanttAdapter';
import { buildDragReason, findOverlappingTasks, getDayFromPointer, getMaxStartDay } from './ganttDrag';
import { buildLinkPaths, isRelatedLink } from './ganttLinks';
import { computeCapacityLoad } from './capacityLoad';
import type { GanttTask } from './types';

const { parseTimelineMs } = ganttTimelineHelpers;
const GANTT_ROW_HEIGHT = 64;
const GANTT_TRACK_HEIGHT = 48;

export type ScheduleAdjustmentRequest = {
  task: ScheduleTask;
  startDay: number;
  durationDays: number;
  reason: string;
  /** 平移后的原始精确时间（M5 工序有 start_time/end_time 时提供，页面优先采用）。 */
  startAt?: string;
  endAt?: string;
};

type GanttViewProps = {
  board: ScheduleBoard;
  dependencies: ScheduleDependency[];
  adjusting: boolean;
  adjustable: boolean;
  onAdjust: (request: ScheduleAdjustmentRequest) => void;
  /** 锁定/解锁工序（schedule:write 门控在页面层与 Drawer 内控制）。 */
  onToggleLock?: (request: { task: ScheduleTask; lock: boolean }) => void;
  locking?: boolean;
};

type AdjustmentFields = {
  startDay: number;
  durationDays: number;
  reason: string;
};

type GanttDragState = {
  task: GanttTask;
  pointerId: number;
  startClientX: number;
  originalStartDay: number;
  previewStartDay: number;
  moved: boolean;
};

type ConflictPrompt = {
  task: ScheduleTask;
  startDay: number;
  overlaps: ScheduleTask[];
};

const DRAG_MOVE_THRESHOLD_PX = 4;
const DAY_MS = 24 * 60 * 60 * 1000;
const getTaskTitle = (board: ScheduleBoard, id: string) => board.tasks.find((task) => task.id === id)?.title ?? id;

/** 按天平移原始精确时间，保持小时级精度（不重建 08:00-18:00）。 */
const shiftTime = (value: string | undefined, deltaMs: number): string | undefined => {
  if (!value) {
    return undefined;
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return value;
  }
  return new Date(ms + deltaMs).toISOString();
};

const LEGEND_ITEMS = [
  { className: 'gantt-task-planned', label: '计划' },
  { className: 'gantt-task-locked', label: '锁定' },
  { className: 'gantt-task-wip', label: 'WIP' },
  { className: 'gantt-task-delayed', label: '延误' },
] as const;

const matchesDragPointer = (state: GanttDragState, pointerId: number | undefined) =>
  state.pointerId === pointerId || pointerId === undefined || pointerId === 0;

export function GanttView({ board, dependencies, adjusting, adjustable, onAdjust, onToggleLock, locking }: GanttViewProps) {
  const [form] = Form.useForm<AdjustmentFields>();
  const [selectedTask, setSelectedTask] = useState<GanttTask | null>(null);
  const [dragState, setDragState] = useState<GanttDragState | null>(null);
  const [conflictPrompt, setConflictPrompt] = useState<ConflictPrompt | null>(null);
  const [permissionNotice, setPermissionNotice] = useState(false);
  const [lockedDragNotice, setLockedDragNotice] = useState(false);
  const suppressClickRef = useRef(false);
  const scheduleResourceFilter = useWorkbenchStore((state) => state.scheduleResourceFilter);
  const scheduleScale = useWorkbenchStore((state) => state.scheduleScale);
  const ganttWindow = useWorkbenchStore((state) => state.ganttWindow);
  const setScheduleResourceFilter = useWorkbenchStore((state) => state.setScheduleResourceFilter);
  const setScheduleScale = useWorkbenchStore((state) => state.setScheduleScale);
  const setGanttWindow = useWorkbenchStore((state) => state.setGanttWindow);

  const visibleResources = useMemo(
    () => (scheduleResourceFilter === 'all' ? board.resources : board.resources.filter((resource) => resource.id === scheduleResourceFilter)),
    [board.resources, scheduleResourceFilter],
  );
  const fullPlanDays = useMemo(
    () => Math.max(
      1,
      ...board.tasks.map((task) => task.startDay + Math.max(1, task.durationDays)),
      ...board.tasks
        .filter((task) => task.actualStartDay !== undefined && task.actualDurationDays !== undefined)
        .map((task) => Number(task.actualStartDay) + Math.max(1, Number(task.actualDurationDays))),
    ),
    [board.tasks],
  );
  const layout = useMemo(
    () =>
      demoGanttAdapter.toGanttLayout(board, {
        scale: scheduleScale,
        resourceFilter: scheduleResourceFilter,
        dependencies,
        window: ganttWindow ?? undefined,
      }),
    [board, scheduleResourceFilter, scheduleScale, dependencies, ganttWindow],
  );
  const linkPaths = useMemo(
    () => buildLinkPaths(layout, dependencies, { resourceOrder: visibleResources, rowHeight: GANTT_ROW_HEIGHT, trackHeight: GANTT_TRACK_HEIGHT }),
    [layout, dependencies, visibleResources],
  );
  const linksSvgHeight = visibleResources.length * GANTT_ROW_HEIGHT;
  const conflictTaskIds = useMemo(() => new Set(board.conflicts.map((conflict) => conflict.taskId)), [board.conflicts]);
  // 拖拽指针数学对齐 L2 百分比布局：百分/天 = 100/totalDays
  const scaleUnit = 100 / Math.max(1, layout.totalDays);
  const selectedDependencies = selectedTask
    ? dependencies.filter((dependency) => dependency.predecessorId === selectedTask.id || dependency.successorId === selectedTask.id)
    : [];

  const handleToday = () => {
    setGanttWindow(computeTodayWindow(parseTimelineMs(board.timelineStart), Date.now(), fullPlanDays));
  };

  const handleFocusTask = () => {
    if (!selectedTask) {
      return;
    }
    setGanttWindow(computeFocusWindow(selectedTask.startDay, selectedTask.durationDays, fullPlanDays));
  };

  const handleClearWindow = () => setGanttWindow(null);

  useEffect(() => {
    if (selectedTask) {
      form.setFieldsValue({
        startDay: selectedTask.startDay,
        durationDays: selectedTask.durationDays,
        reason: '人工等价调整排程',
      });
    }
  }, [form, selectedTask]);

  useEffect(() => {
    if (!permissionNotice) {
      return;
    }
    const timer = window.setTimeout(() => setPermissionNotice(false), 3000);
    return () => window.clearTimeout(timer);
  }, [permissionNotice]);

  useEffect(() => {
    if (!lockedDragNotice) {
      return;
    }
    const timer = window.setTimeout(() => setLockedDragNotice(false), 3000);
    return () => window.clearTimeout(timer);
  }, [lockedDragNotice]);

  const resourceNameOf = (resourceId: string) => board.resources.find((resource) => resource.id === resourceId)?.name ?? resourceId;

  const handleExportTasks = () => {
    const rows = layout.tasks.map((task) => ({
      任务: task.title,
      资源: resourceNameOf(task.resourceId),
      开始偏移: task.startDay,
      持续天数: task.durationDays,
      状态: task.status,
      关键路径: task.criticalPath === 'available' ? (task.isCritical ? '是' : '否') : '未提供',
    }));
    exportCsv(`排程任务-${board.planVersion ?? 'default'}.csv`, rows, [
      { key: '任务', title: '任务' },
      { key: '资源', title: '资源' },
      { key: '开始偏移', title: '开始偏移' },
      { key: '持续天数', title: '持续天数' },
      { key: '状态', title: '状态' },
      { key: '关键路径', title: '关键路径' },
    ]);
  };

  const handleExportCapacity = () => {
    const capacity = computeCapacityLoad(board, scheduleScale);
    const rows = capacity.rows.map((row) => {
      const base: Record<string, unknown> = { 资源: row.resourceName, 总负载: row.totalLoad };
      for (const bucket of capacity.buckets) {
        const entry = row.buckets.find((item) => item.bucketKey === bucket.key);
        base[`${bucket.label}负载`] = entry?.load ?? 0;
      }
      return base;
    });
    exportCsv(`排程产能-${board.planVersion ?? 'default'}.csv`, rows);
  };

  const handleTaskClick = (task: GanttTask) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setSelectedTask(task);
  };

  const handleTaskPointerDown = (event: React.PointerEvent<HTMLButtonElement>, task: GanttTask) => {
    if (!adjustable) {
      setPermissionNotice(true);
      return;
    }
    if (task.barKind === 'locked') {
      setLockedDragNotice(true);
      return;
    }
    if (adjusting || dragState) {
      return;
    }
    event.preventDefault();
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // pointer capture may be unavailable in test/embedded environments
      }
    }
    suppressClickRef.current = false;
    setDragState({
      task,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      originalStartDay: task.startDay,
      previewStartDay: task.startDay,
      moved: false,
    });
  };

  const handleTaskPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragState || !matchesDragPointer(dragState, event.pointerId)) {
      return;
    }
    const track = event.currentTarget.closest('.gantt-track');
    const rect = track?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const maxStartDay = layout.minStartDay + getMaxStartDay(dragState.task.durationDays, scaleUnit);
    const previewStartDay = getDayFromPointer({
      clientX: event.clientX,
      trackLeft: rect.left,
      trackWidth: rect.width,
      scaleUnit,
      minStartDay: layout.minStartDay,
      maxStartDay,
    });
    setDragState((previous) => {
      if (!previous || previous.pointerId !== event.pointerId) {
        return previous;
      }
      return {
        ...previous,
        previewStartDay,
        moved: previous.moved || Math.abs(event.clientX - previous.startClientX) > DRAG_MOVE_THRESHOLD_PX,
      };
    });
  };

  const handleTaskPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragState || !matchesDragPointer(dragState, event.pointerId)) {
      return;
    }
    const { task, originalStartDay, previewStartDay, moved } = dragState;
    setDragState(null);
    if (typeof event.currentTarget.releasePointerCapture === 'function') {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // pointer capture may be unavailable in test/embedded environments
      }
    }
    if (!moved || previewStartDay === originalStartDay) {
      return;
    }
    const overlaps = findOverlappingTasks(board.tasks, task, previewStartDay);
    if (overlaps.length > 0) {
      setConflictPrompt({ task, startDay: previewStartDay, overlaps });
      return;
    }
    suppressClickRef.current = true;
    const deltaMs = (previewStartDay - originalStartDay) * DAY_MS;
    onAdjust({
      task,
      startDay: previewStartDay,
      durationDays: task.durationDays,
      reason: buildDragReason(task.title, originalStartDay, previewStartDay),
      // 拖动只平移时间窗：保留工序原始精确 start/end 时间。
      startAt: shiftTime(task.startAt, deltaMs),
      endAt: shiftTime(task.endAt, deltaMs),
    });
  };

  const handleTaskPointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragState && matchesDragPointer(dragState, event.pointerId)) {
      setDragState(null);
    }
  };

  const conflictResourceName = conflictPrompt
    ? board.resources.find((resource) => resource.id === conflictPrompt.task.resourceId)?.name
    : undefined;

  return (
    <>
      <Space wrap size={12}>
        <Select
          aria-label="资源筛选"
          value={scheduleResourceFilter}
          style={{ width: 180 }}
          onChange={setScheduleResourceFilter}
          options={[
            { label: '全部资源', value: 'all' },
            ...board.resources.map((resource) => ({ label: resource.name, value: resource.id })),
          ]}
        />
        <Segmented<ScheduleScale>
          aria-label="时间粒度"
          value={scheduleScale}
          options={[
            { label: '日', value: 'day' },
            { label: '周', value: 'week' },
            { label: '月', value: 'month' },
          ]}
          onChange={setScheduleScale}
        />
        <Button size="small" aria-label="今天" onClick={handleToday}>
          今天
        </Button>
        <Button size="small" aria-label="聚焦任务" disabled={selectedTask === null} onClick={handleFocusTask}>
          聚焦任务
        </Button>
        {ganttWindow ? (
          <Button size="small" type="link" aria-label="清除时间窗" onClick={handleClearWindow}>
            清除时间窗
          </Button>
        ) : null}
        <Button size="small" aria-label="导出任务 CSV" onClick={handleExportTasks}>
          导出任务 CSV
        </Button>
        <Button size="small" aria-label="导出产能 CSV" onClick={handleExportCapacity}>
          导出产能 CSV
        </Button>
      </Space>
      {permissionNotice ? (
        <Alert
          className="inline-alert"
          type="warning"
          showIcon
          message="当前角色无排程调整权限（需要 schedule:write）"
          description="已禁用拖拽调整，可查看任务详情与只读排程。"
        />
      ) : null}
      {lockedDragNotice ? (
        <Alert
          className="inline-alert"
          type="info"
          showIcon
          message="该任务已锁定"
          description="锁定任务不可拖拽调整，可先解锁后再调整。"
        />
      ) : null}
      <div className="gantt-legend">
        {LEGEND_ITEMS.map((item) => (
          <span className="gantt-legend-item" key={item.label}>
            <span className={`gantt-legend-swatch ${item.className}`} />
            {item.label}
          </span>
        ))}
        <span className="gantt-legend-item">
          <span className="gantt-legend-swatch gantt-task-critical" />
          关键路径
        </span>
        <span className="gantt-legend-item">
          <span className="gantt-legend-swatch gantt-legend-swatch-actual" />
          实际
        </span>
        <span className="gantt-legend-item">
          <span className="gantt-legend-swatch gantt-link-f2s" />
          完成-开始依赖
        </span>
        <span className="gantt-legend-item">
          <span className="gantt-legend-swatch gantt-link-s2s" />
          开始-开始依赖
        </span>
        {dependencies.length === 0 ? <span className="gantt-legend-note">依赖端点未提供</span> : null}
        {!layout.criticalPathAvailable ? <span className="gantt-legend-note">关键路径字段未提供</span> : null}
        <span className="gantt-legend-note">实际数据未提供时任务条标记「未提供」</span>
      </div>
      <div className="gantt-placeholder" data-testid="gantt-placeholder">
        <div className="gantt-header-row">
          <div className="gantt-label-spacer">资源</div>
          <div className="gantt-axis">
            {layout.columns.map((column) => (
              <div
                className={column.isWeek ? 'gantt-axis-col gantt-axis-col-week' : 'gantt-axis-col'}
                key={column.key}
                style={{ left: `${column.leftPercent}%`, width: `${column.widthPercent}%` }}
                title={column.label}
              >
                {column.label}
              </div>
            ))}
          </div>
        </div>
        <div className="gantt-rows" data-testid="gantt-rows">
          {linkPaths.length > 0 ? (
            <svg
              className="gantt-links-svg"
              viewBox={`0 0 100 ${linksSvgHeight}`}
              preserveAspectRatio="none"
              aria-hidden="true"
              data-testid="gantt-links-svg"
            >
              <defs>
                <marker
                  id="gantt-link-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
              </defs>
              {linkPaths.map((link) => {
                const active = isRelatedLink(link, selectedTask);
                const classes = ['gantt-link', `gantt-link-${link.type === 'start_to_start' ? 's2s' : 'f2s'}`];
                if (selectedTask) {
                  classes.push(active ? 'gantt-link-active' : 'gantt-link-dimmed');
                }
                return (
                  <path
                    key={link.id}
                    className={classes.join(' ')}
                    d={link.d}
                    vectorEffect="non-scaling-stroke"
                    markerEnd="url(#gantt-link-arrow)"
                    data-testid={`gantt-link-${link.id}`}
                  />
                );
              })}
            </svg>
          ) : null}
          {visibleResources.map((resource) => (
          <div className="gantt-row" key={resource.id}>
            <span className="gantt-label">{resource.name}</span>
            <div className="gantt-track">
              {layout.tasks
                .filter((task) => task.resourceId === resource.id)
                .map((task) => {
                  const isDragging = dragState?.task.id === task.id;
                  const previewPercent =
                    isDragging && dragState
                      ? Math.max(0, Math.min(100, ((dragState.previewStartDay - layout.minStartDay) / layout.totalDays) * 100))
                      : null;
                  const classes = ['gantt-task', `gantt-task-${task.barKind}`];
                  if (task.isCritical) {
                    classes.push('gantt-task-critical');
                  }
                  if (conflictTaskIds.has(task.id)) {
                    classes.push('gantt-task-has-conflict');
                  }
                  if (isDragging) {
                    classes.push('gantt-task-dragging');
                  }
                  if (!adjustable || task.barKind === 'locked') {
                    classes.push('gantt-task-drag-disabled');
                  }
                  return (
                    <span key={task.id}>
                      <button
                        className={classes.join(' ')}
                        style={{ left: previewPercent !== null ? `${previewPercent}%` : `${task.leftPercent}%`, width: `${task.widthPercent}%` }}
                        type="button"
                        title={isDragging && dragState ? `拖拽至第 ${dragState.previewStartDay + 1} 天` : task.title}
                        onPointerDown={(event) => handleTaskPointerDown(event, task)}
                        onPointerMove={handleTaskPointerMove}
                        onPointerUp={handleTaskPointerUp}
                        onPointerCancel={handleTaskPointerCancel}
                        onClick={() => handleTaskClick(task)}
                      >
                        <span className="gantt-task-title">{task.title}</span>
                        {!task.hasActualData ? <span className="gantt-task-missing">未提供</span> : null}
                        {task.isCritical ? <span className="gantt-critical-badge">关键</span> : null}
                        {conflictTaskIds.has(task.id) ? <span className="gantt-conflict-badge">!</span> : null}
                      </button>
                      {task.actualBar ? (
                        <div
                          className="gantt-actual-bar"
                          data-testid={`gantt-actual-${task.id}`}
                          style={{ left: `${task.actualBar.leftPercent}%`, width: `${task.actualBar.widthPercent}%` }}
                          title={`实际：${task.actualStartAt ?? `第 ${task.actualStartDay !== undefined ? task.actualStartDay + 1 : '?'} 天`}起，${task.actualEndAt ?? (task.actualStatus === 'running' || task.actualStatus === 'in_progress' ? '进行中' : `${task.actualDurationDays ?? '?'} 天`)}`}
                        />
                      ) : null}
                    </span>
                  );
                })}
            </div>
          </div>
        ))}
        </div>
      </div>
      <Drawer title="任务详情" open={selectedTask !== null} onClose={() => setSelectedTask(null)} width={460}>
        {selectedTask ? (
          <Space direction="vertical" size={16} className="page-stack">
            <Typography.Title level={4}>{selectedTask.title}</Typography.Title>
            <Space wrap size={8}>
              <StatusTag value={selectedTask.status} />
              {selectedTask.isCritical ? <Tag color="gold">关键路径</Tag> : null}
              {conflictTaskIds.has(selectedTask.id) ? <Tag color="red">冲突</Tag> : null}
            </Space>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="资源">{board.resources.find((item) => item.id === selectedTask.resourceId)?.name}</Descriptions.Item>
              <Descriptions.Item label="计划开始偏移">第 {selectedTask.startDay + 1} 天</Descriptions.Item>
              <Descriptions.Item label="计划持续">{selectedTask.durationDays} 天</Descriptions.Item>
              <Descriptions.Item label="实际开始偏移">
                {selectedTask.actualStartDay !== undefined ? `第 ${selectedTask.actualStartDay + 1} 天` : '未提供'}
              </Descriptions.Item>
              <Descriptions.Item label="实际持续">{selectedTask.actualDurationDays !== undefined ? `${selectedTask.actualDurationDays} 天` : '未提供'}</Descriptions.Item>
              <Descriptions.Item label="关键路径">
                {selectedTask.criticalPath === 'available' ? (selectedTask.isCritical ? '是' : '否') : '未提供'}
              </Descriptions.Item>
            </Descriptions>
            <Space direction="vertical" size={8}>
              <Typography.Text strong>依赖关系</Typography.Text>
              {selectedDependencies.length > 0 ? (
                selectedDependencies.map((dependency) => (
                  <Tag key={dependency.id}>
                    {getTaskTitle(board, dependency.predecessorId)} -&gt; {getTaskTitle(board, dependency.successorId)} / {dependency.type} / 滞后 {dependency.lagDays} 天
                  </Tag>
                ))
              ) : (
                <Typography.Text type="secondary">无依赖</Typography.Text>
              )}
            </Space>
            {onToggleLock ? (
              <Space>
                <Button
                  type={selectedTask.rawStatus === 'locked' ? 'primary' : 'default'}
                  danger={selectedTask.rawStatus === 'locked'}
                  loading={locking}
                  disabled={!adjustable}
                  aria-label={selectedTask.rawStatus === 'locked' ? '解锁工序' : '锁定工序'}
                  onClick={() => onToggleLock({ task: selectedTask, lock: selectedTask.rawStatus !== 'locked' })}
                >
                  {selectedTask.rawStatus === 'locked' ? '解锁' : '锁定'}
                </Button>
                <Typography.Text type="secondary">
                  {selectedTask.rawStatus === 'locked' ? '已锁定，他人不可调整该工序' : '锁定后该工序将禁拖拽'}
                </Typography.Text>
              </Space>
            ) : null}
            {adjustable ? (
              <Form
                form={form}
                layout="vertical"
                onFinish={(values) =>
                  onAdjust({
                    task: selectedTask,
                    ...values,
                    // 表单提交同样按平移保持精确时间；endAt 额外跟随 durationDays 变化。
                    startAt: shiftTime(selectedTask.startAt, (values.startDay - selectedTask.startDay) * DAY_MS),
                    endAt: shiftTime(selectedTask.endAt, (values.startDay + values.durationDays - selectedTask.startDay - selectedTask.durationDays) * DAY_MS),
                  })
                }
              >
                <Form.Item label="开始偏移（天）" name="startDay" rules={[{ required: true, message: '请输入开始偏移' }]}>
                  <InputNumber min={0} max={14} />
                </Form.Item>
                <Form.Item label="持续天数" name="durationDays" rules={[{ required: true, message: '请输入持续天数' }]}>
                  <InputNumber min={1} max={14} />
                </Form.Item>
                <Form.Item label="调整原因" name="reason" rules={[{ required: true, message: '请输入调整原因' }]}>
                  <Input.TextArea rows={3} />
                </Form.Item>
                <ActionGate permission="schedule:write" auditModule="M5" targetId={selectedTask.id}>
                  <Button type="primary" htmlType="submit" loading={adjusting}>
                    提交调整
                  </Button>
                </ActionGate>
              </Form>
            ) : (
              <Alert type="warning" showIcon message="当前角色无排程调整权限（需要 schedule:write）" />
            )}
          </Space>
        ) : null}
      </Drawer>
      <Modal
        open={conflictPrompt !== null}
        title="排程冲突"
        onOk={() => setConflictPrompt(null)}
        onCancel={() => setConflictPrompt(null)}
        okText="知道了"
        cancelText="取消"
      >
        {conflictPrompt ? (
          <Typography.Paragraph>
            任务「{conflictPrompt.task.title}」移至第 {conflictPrompt.startDay + 1} 天后，与
            {conflictPrompt.overlaps.map((task) => `「${task.title}」`).join('、')}在同一产线{conflictResourceName ? `（${conflictResourceName}）` : ''}上时间重叠。请选择其他位置，或由计划员人工处理。
          </Typography.Paragraph>
        ) : null}
      </Modal>
    </>
  );
}
