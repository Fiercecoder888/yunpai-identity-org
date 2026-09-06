import type { BusinessCatalogRunConfig } from '../../services/businessFlowRunApi';

const normalizeBaseName = (name: string) => name.trim().toLowerCase().replace(/\.[^.]*$/, '');

const tokenize = (value: string) => value.split(/[_\-\s]+/).filter(Boolean);

const matchScore = (base: string, candidate: string): number => {
  if (candidate === base) return 1;
  if (!candidate || !base) return 0;
  if (candidate.includes(base) || base.includes(candidate)) {
    return candidate.length / Math.max(candidate.length, base.length);
  }
  const baseTokens = tokenize(base);
  const candidateTokens = tokenize(candidate);
  if (!baseTokens.length || !candidateTokens.length) return 0;
  const common = baseTokens.filter((token) => candidateTokens.includes(token)).length;
  return common / Math.max(baseTokens.length, candidateTokens.length);
};

export function buildOrderNameHint(
  configs: BusinessCatalogRunConfig[],
  filename: string,
): string | undefined {
  const baseName = normalizeBaseName(filename);
  if (!baseName) return undefined;
  let bestScore = 0;
  let bestHint: string | undefined;
  for (const config of configs) {
    const productName = config.order?.product_name?.trim();
    const orderFilename = config.order_filename?.trim();
    const candidates = [
      orderFilename ? normalizeBaseName(orderFilename) : '',
      productName ? normalizeBaseName(productName) : '',
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const score = matchScore(baseName, candidate);
      if (score > 0.5 && score > bestScore) {
        bestScore = score;
        bestHint = productName || orderFilename;
      }
    }
  }
  return bestHint;
}
