import { BellOutlined } from '@ant-design/icons';
import { Badge, Button } from 'antd';
import { useEffect, useState } from 'react';
import { getNotifications } from './notificationApi';
import { useNotificationStore } from './useNotificationStore';
import { NotificationCenterDrawer } from './NotificationCenterDrawer';

const NOTIFICATION_POLL_INTERVAL_MS = 15_000;

export function WorkbenchBell() {
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const mergeItems = useNotificationStore((state) => state.mergeItems);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const items = await getNotifications();
        if (!cancelled) {
          mergeItems(items);
        }
      } catch {
        // Keep existing notifications when the transport is unavailable.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), NOTIFICATION_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [mergeItems]);

  return (
    <>
      <Badge count={unreadCount} size="small" overflowCount={99}>
        <Button type="text" icon={<BellOutlined />} aria-label="通知中心" onClick={() => setOpen(true)} />
      </Badge>
      <NotificationCenterDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
