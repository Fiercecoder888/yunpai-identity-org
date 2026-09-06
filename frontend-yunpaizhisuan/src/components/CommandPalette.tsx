import { useEffect, useMemo, useRef, useState } from 'react';
import { Empty, Input, Modal, Tabs } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { routeMeta } from '../app/router';
import { pushRecent, readRecent, type RecentSearchItem } from '../features/command/commandRecent';
import type { SearchEntityType } from '../features/command/searchIndex';
import { useGlobalSearch } from '../features/command/useGlobalSearch';

type PageOption = {
  path: string;
  title: string;
};

type PaletteItem = {
  key: string;
  kind: 'page' | SearchEntityType;
  label: string;
  path?: string;
  hint?: string;
};

const TAB_ITEMS = [
  { key: 'all', label: '全部' },
  { key: 'page', label: '页面' },
  { key: 'order', label: '订单' },
  { key: 'material', label: '物料' },
  { key: 'supplier', label: '供应商' },
  { key: 'operation', label: '工序' },
] as const;

type TabKey = (typeof TAB_ITEMS)[number]['key'];

const ENTITY_KINDS: SearchEntityType[] = ['order', 'material', 'supplier', 'operation'];

const buildCommands = (): PageOption[] => Object.entries(routeMeta).map(([path, meta]) => ({ path, title: meta.title }));

const itemKey = (item: RecentSearchItem | PaletteItem) => {
  const key = item.key.startsWith('recent-') ? item.key.slice(7) : item.key;
  return key.startsWith('page-') || key.startsWith('entity-') ? key.slice(key.indexOf('-') + 1) : key;
};

export function CommandPalette() {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [activeIndex, setActiveIndex] = useState(0);
  const [recent, setRecent] = useState<RecentSearchItem[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const { loading, error, groups } = useGlobalSearch(open ? query : '');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveTab('all');
      setActiveIndex(0);
      setRecent(readRecent());
    }
  }, [open]);

  const pages = useMemo(buildCommands, []);

  const filteredPages = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return pages;
    }
    return pages.filter(
      (command) => command.title.toLowerCase().includes(needle) || command.path.toLowerCase().includes(needle),
    );
  }, [pages, query]);

  const pageItems = useMemo<PaletteItem[]>(
    () => filteredPages.map((command) => ({ key: `page-${command.path}`, kind: 'page', label: command.title, path: command.path })),
    [filteredPages],
  );

  const entityItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];
    for (const kind of ENTITY_KINDS) {
      for (const entry of groups[kind]) {
        items.push({ key: `entity-${entry.id}`, kind, label: entry.label, path: entry.path, hint: entry.hint });
      }
    }
    return items;
  }, [groups]);

  const items = useMemo<PaletteItem[]>(() => {
    if (activeTab === 'page') {
      return pageItems;
    }
    if (activeTab !== 'all') {
      return entityItems.filter((item) => item.kind === activeTab);
    }
    return [...pageItems, ...entityItems];
  }, [activeTab, pageItems, entityItems]);

  const recentItems = useMemo<PaletteItem[]>(
    () =>
      recent.map((entry) => ({
        key: `recent-${itemKey(entry)}`,
        kind: entry.kind,
        label: entry.label,
        path: entry.path,
        hint: entry.hint,
      })),
    [recent],
  );

  const showRecent = !query.trim() && recentItems.length > 0;
  const visibleItems = showRecent ? recentItems : items;

  useEffect(() => {
    setActiveIndex(0);
  }, [query, activeTab, groups]);

  useEffect(() => {
    if (!open || activeIndex === -1 || !listRef.current) {
      return;
    }
    const activeElement = listRef.current.querySelector('.command-palette-item.is-active');
    activeElement?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const selectItem = (item: PaletteItem) => {
    pushRecent({ key: itemKey(item), kind: item.kind, label: item.label, path: item.path, hint: item.hint });
    setOpen(false);
    setQuery('');
    if (item.path) {
      navigate(item.path);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (visibleItems.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(visibleItems.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = visibleItems[activeIndex];
      if (target) {
        selectItem(target);
      }
    }
  };

  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = { all: pageItems.length + entityItems.length, page: pageItems.length, order: 0, material: 0, supplier: 0, operation: 0 };
    for (const kind of ENTITY_KINDS) {
      counts[kind] = groups[kind].length;
    }
    return counts;
  }, [pageItems.length, entityItems.length, groups]);

  return (
    <Modal
      className="command-palette"
      title="命令面板"
      open={open}
      onCancel={() => setOpen(false)}
      footer={null}
      destroyOnHidden
    >
      <Input
        autoFocus
        allowClear
        placeholder="搜索页面、订单、物料、供应商或工序…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        data-testid="command-palette-input"
      />
      <Tabs
        size="small"
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as TabKey)}
        items={TAB_ITEMS.map((tab) => ({
          key: tab.key,
          label: tabCounts[tab.key] > 0 && tab.key !== 'all' ? `${tab.label} (${tabCounts[tab.key]})` : tab.label,
        }))}
        data-testid="command-palette-tabs"
      />
      {loading ? <div className="command-palette-hint">正在构建搜索索引…</div> : null}
      {error ? <div className="command-palette-hint">部分搜索源不可用，已展示可用结果</div> : null}
      <div className="command-palette-list" data-testid="command-palette-list" ref={listRef}>
        {showRecent ? <div className="command-palette-group-label">最近使用</div> : null}
        {visibleItems.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的命令" />
        ) : (
          visibleItems.map((item, index) => (
            <button
              type="button"
              key={item.key}
              className={item.key === `page-${location.pathname}` ? 'command-palette-item is-active is-current' : index === activeIndex ? 'command-palette-item is-active' : 'command-palette-item'}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectItem(item)}
            >
              <span className="command-palette-item-title">{item.label}</span>
              {item.hint ? <span className="command-palette-item-hint">{item.hint}</span> : null}
              <code className="command-palette-item-path">{item.path ?? item.kind}</code>
            </button>
          ))
        )}
      </div>
      <div className="command-palette-hint">↑/↓ 选择 · Enter 打开 · Esc 关闭 · Ctrl/Cmd+K 开关</div>
    </Modal>
  );
}
