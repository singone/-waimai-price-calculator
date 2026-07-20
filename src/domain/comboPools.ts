export type ComboPoolCandidate = {
  index: number;
  price: number;
  stapleCount: number;
};

export type ComboPoolRow = {
  qtys: number[];
  totalQty: number;
  originalTotal: number;
  stapleCount: number;
};

export type ComboPoolBuildOptions = {
  cacheKey: string;
  productCount: number;
  mainProducts: ComboPoolCandidate[];
  addOnProducts: ComboPoolCandidate[];
  maxQtyPerSku: number;
  maxItems: number;
  minStapleCount: number;
  maxStapleCount: number;
  maxAddOnCount: number;
  maxOriginalTotal: number;
  shouldStop: () => boolean;
  maybeYield: () => Promise<void>;
};

export type SeparatedComboPools = {
  mainCombos: ComboPoolRow[];
  addOnCombosByCount: ComboPoolRow[][];
};

const MAX_COMBO_POOL_CACHE_SIZE = 4;
const comboPoolCache = new Map<string, SeparatedComboPools>();

function rememberComboPools(key: string, pools: SeparatedComboPools) {
  if (comboPoolCache.has(key)) comboPoolCache.delete(key);
  comboPoolCache.set(key, pools);
  while (comboPoolCache.size > MAX_COMBO_POOL_CACHE_SIZE) {
    const oldestKey = comboPoolCache.keys().next().value;
    if (!oldestKey) break;
    comboPoolCache.delete(oldestKey);
  }
}

export function candidatePoolSignature(candidates: ComboPoolCandidate[]) {
  return candidates.map(row => `${row.index}:${row.price}:${row.stapleCount}`).join('|');
}

export function mergeComboQtys(productCount: number, base: ComboPoolRow, addOn: ComboPoolRow) {
  const qtys = Array(productCount).fill(0);
  for (let index = 0; index < productCount; index++) {
    qtys[index] = (base.qtys[index] || 0) + (addOn.qtys[index] || 0);
  }
  return qtys;
}

export async function buildSeparatedComboPoolsAsync(options: ComboPoolBuildOptions): Promise<SeparatedComboPools> {
  const cached = comboPoolCache.get(options.cacheKey);
  if (cached) {
    comboPoolCache.delete(options.cacheKey);
    comboPoolCache.set(options.cacheKey, cached);
    return cached;
  }

  const mainCombos: ComboPoolRow[] = [];
  const addOnCombosByCount: ComboPoolRow[][] = Array.from({ length: options.maxAddOnCount + 1 }, () => []);
  addOnCombosByCount[0].push({
    qtys: Array(options.productCount).fill(0),
    totalQty: 0,
    originalTotal: 0,
    stapleCount: 0
  });

  const mainStack: Array<ComboPoolRow & { startIndex: number }> = [{
    startIndex: 0,
    qtys: Array(options.productCount).fill(0),
    totalQty: 0,
    originalTotal: 0,
    stapleCount: 0
  }];

  while (mainStack.length && !options.shouldStop()) {
    const current = mainStack.pop() as ComboPoolRow & { startIndex: number };
    await options.maybeYield();
    if (
      current.originalTotal > options.maxOriginalTotal + 1e-9
      || current.stapleCount > options.maxStapleCount + 1e-9
      || current.totalQty > options.maxItems
    ) continue;
    if (current.stapleCount + 1e-9 >= options.minStapleCount && current.stapleCount <= options.maxStapleCount + 1e-9 && current.totalQty > 0) {
      mainCombos.push({
        qtys: current.qtys.slice(),
        totalQty: current.totalQty,
        originalTotal: current.originalTotal,
        stapleCount: current.stapleCount
      });
    }
    if (current.totalQty >= options.maxItems || current.stapleCount >= options.maxStapleCount) continue;

    const nextStates: Array<ComboPoolRow & { startIndex: number }> = [];
    for (let index = current.startIndex; index < options.mainProducts.length; index++) {
      const candidate = options.mainProducts[index];
      const currentQty = current.qtys[candidate.index] || 0;
      if (currentQty >= options.maxQtyPerSku) continue;
      const nextOriginalTotal = current.originalTotal + candidate.price;
      const nextStapleCount = current.stapleCount + candidate.stapleCount;
      if (nextOriginalTotal > options.maxOriginalTotal + 1e-9) break;
      if (nextStapleCount > options.maxStapleCount + 1e-9) continue;
      const nextQtys = current.qtys.slice();
      nextQtys[candidate.index] = currentQty + 1;
      nextStates.push({
        startIndex: index,
        qtys: nextQtys,
        totalQty: current.totalQty + 1,
        originalTotal: nextOriginalTotal,
        stapleCount: nextStapleCount
      });
    }
    for (let index = nextStates.length - 1; index >= 0; index--) mainStack.push(nextStates[index]);
  }

  const addOnStack: Array<ComboPoolRow & { startIndex: number }> = [{
    startIndex: 0,
    qtys: Array(options.productCount).fill(0),
    totalQty: 0,
    originalTotal: 0,
    stapleCount: 0
  }];

  while (addOnStack.length && !options.shouldStop()) {
    const current = addOnStack.pop() as ComboPoolRow & { startIndex: number };
    await options.maybeYield();
    if (current.originalTotal > options.maxOriginalTotal + 1e-9 || current.totalQty > options.maxAddOnCount) continue;
    if (current.totalQty > 0) {
      addOnCombosByCount[current.totalQty].push({
        qtys: current.qtys.slice(),
        totalQty: current.totalQty,
        originalTotal: current.originalTotal,
        stapleCount: 0
      });
    }
    if (current.totalQty >= options.maxAddOnCount) continue;

    const nextStates: Array<ComboPoolRow & { startIndex: number }> = [];
    for (let index = current.startIndex; index < options.addOnProducts.length; index++) {
      const candidate = options.addOnProducts[index];
      const currentQty = current.qtys[candidate.index] || 0;
      if (currentQty >= options.maxQtyPerSku) continue;
      const nextOriginalTotal = current.originalTotal + candidate.price;
      if (nextOriginalTotal > options.maxOriginalTotal + 1e-9) break;
      const nextQtys = current.qtys.slice();
      nextQtys[candidate.index] = currentQty + 1;
      nextStates.push({
        startIndex: index + 1,
        qtys: nextQtys,
        totalQty: current.totalQty + 1,
        originalTotal: nextOriginalTotal,
        stapleCount: 0
      });
    }
    for (let index = nextStates.length - 1; index >= 0; index--) addOnStack.push(nextStates[index]);
  }

  mainCombos.sort((a, b) => a.originalTotal - b.originalTotal || a.totalQty - b.totalQty);
  addOnCombosByCount.forEach(rows => rows.sort((a, b) => a.originalTotal - b.originalTotal || a.totalQty - b.totalQty));
  const pools = { mainCombos, addOnCombosByCount };
  if (!options.shouldStop()) rememberComboPools(options.cacheKey, pools);
  return pools;
}
