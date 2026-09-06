export type BusinessFlowOrder = {
  catalogId: string;
  orderId: string;
  productName: string;
  status: string;
  taskId?: string;
  runnable: boolean;
};

type HistoricalOrder = {
  catalog_id: string;
  order_id: string;
  product_name: string;
  status: string;
  task_id?: string;
};

type CandidateRun = {
  catalog_id: string;
  title: string;
  order: {
    order_id: string;
  };
};

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`${url}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function getBusinessFlowOrders(): Promise<BusinessFlowOrder[]> {
  const [historicalOrders, candidateRuns] = await Promise.all([
    readJson<HistoricalOrder[]>('/historical-order-catalog.json'),
    readJson<CandidateRun[]>('/run-config/candidate-run-manifest.json'),
  ]);
  const candidateByCatalog = new Map(candidateRuns.map((candidate) => [candidate.catalog_id, candidate]));
  const orders: BusinessFlowOrder[] = historicalOrders.map((order) => ({
    catalogId: order.catalog_id,
    orderId: order.order_id,
    productName: order.product_name,
    status: order.status,
    taskId: order.task_id,
    runnable: candidateByCatalog.has(order.catalog_id),
  }));
  const knownCatalogs = new Set(orders.map((order) => order.catalogId));

  for (const candidate of candidateRuns) {
    if (knownCatalogs.has(candidate.catalog_id)) continue;
    orders.push({
      catalogId: candidate.catalog_id,
      orderId: candidate.order.order_id,
      productName: candidate.title,
      status: '待运行',
      taskId: undefined,
      runnable: true,
    });
  }

  return orders;
}
