/* 外卖门店活动测算工具
 * 纯前端实现：多门店、平台通用规则、门店活动、组合利润测算。
 */
(function(){
  'use strict';

  const STORAGE_KEY = 'waimai_store_activity_calculator_v2';
  const PLATFORMS = ['meituan', 'eleme'];
  const PLATFORM_NAMES = { meituan:'美团', eleme:'饿了么' };
  const PLATFORM_PRODUCT_IMPORT_RULES = {
    meituan: {
      name: '美团',
      priceField: 'meituanPrice',
      nameHeaders: ['商品名称', '商品名', '名称'],
      priceHeaders: ['外送价', '美团价', '售价', '价格(元)', '价格']
    },
    eleme: {
      name: '饿了么',
      priceField: 'elemePrice',
      nameHeaders: ['商品名称', '商品名', '名称'],
      priceHeaders: ['价格(元)', '饿了么价', '外送价', '售价', '价格']
    }
  };
  const TRUE_VALUES = new Set(['1','true','yes','y','on','是','有','启用','单点不送','不可单点']);
  const FALSE_VALUES = new Set(['0','false','no','n','off','否','无','不','停用','关闭']);

  const $ = (selector, root=document) => root.querySelector(selector);
  const $$ = (selector, root=document) => Array.from(root.querySelectorAll(selector));

  const defaultState = {
    selectedStoreId: 'store-1',
    activePage: 'store',
    riskSafetyMargin: 0,
    platformRules: {
      commissionRate: 4.8,
      minCommission: 0.96,
      baseDeliveryFee: 2.7,
      extraDeliveryFee: 0.05,
      midPriceRate: 0.13,
      highPriceRate: 0.15,
      freightWithin3: 2.7,
      freightWithin5: 4,
      freightAbove5: 5,
      profitTargets: [
        { enabled:true, payMin:10, payMax:15, rateMin:18, rateMax:26 },
        { enabled:true, payMin:15, payMax:25, rateMin:22, rateMax:32 },
        { enabled:true, payMin:25, payMax:40, rateMin:28, rateMax:40 }
      ],
      redTiers: {
        meituan: [
          { enabled:true, threshold:15, min:2, max:4 },
          { enabled:true, threshold:20, min:3, max:6 },
          { enabled:true, threshold:30, min:5, max:8 }
        ],
        eleme: [
          { enabled:true, threshold:15, min:1.5, max:3.5 },
          { enabled:true, threshold:20, min:2, max:5 },
          { enabled:true, threshold:30, min:4, max:7 }
        ]
      }
    },
    stores: [
      {
        id: 'store-1',
        name: '示例门店',
        startPrice: 20,
        deliveryDistance: 3,
        orderTime: '12:00',
        maxItems: 4,
        maxQtyPerSku: 2,
        maxCoupons: 1,
        maxDiscountItems: '',
        maxChecks: 250000,
        usePlatformFee: true,
        customFeeRule: null,
        usePlatformTargets: true,
        profitTargets: [],
        products: [
          { id:'p1', name:'海鸭蛋和风饭团', price:15, cost:6, meituanPrice:'', elemePrice:'', nonStandalone:false },
          { id:'p2', name:'照烧鸡排饭团', price:16, cost:6.5, meituanPrice:'', elemePrice:'', nonStandalone:false },
          { id:'p3', name:'九州金枪鱼饭团', price:16, cost:6.5, meituanPrice:'', elemePrice:'', nonStandalone:false },
          { id:'p4', name:'酥香肉松饭团', price:8.9, cost:3.2, meituanPrice:'', elemePrice:'', nonStandalone:false },
          { id:'p5', name:'醇香豆浆', price:3, cost:1, meituanPrice:'', elemePrice:'', nonStandalone:true },
          { id:'p6', name:'茶叶蛋', price:2, cost:0.8, meituanPrice:'', elemePrice:'', nonStandalone:true }
        ],
        activities: {
          meituan: makeDefaultActivities('美团'),
          eleme: makeDefaultActivities('饿了么')
        }
      }
    ]
  };

  let state = deepClone(defaultState);
  let lastResults = [];
  let lastOptimizations = [];
  let lastRiskWarnings = [];
  let resultSort = { key:'finalPay', dir:'asc' };
  let optimizationSort = { key:'score', dir:'asc' };

  function makeDefaultActivities(prefix){
    return {
      fullReductions: [
        { enabled:true, threshold:25, amount:3 },
        { enabled:true, threshold:35, amount:6 }
      ],
      coupons: [
        { enabled:true, name:`${prefix}店铺券`, threshold:20, amount:3 }
      ],
      redAddOns: [
        { enabled:true, threshold:20, amount:1 }
      ],
      discountActivities: [
        { enabled:true, name:`${prefix}饭团折扣`, productNames:'饭团', discountRate:8.8, itemLimit:'' }
      ]
    };
  }

  function deepClone(value){
    return JSON.parse(JSON.stringify(value));
  }

  function uid(prefix){
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function toNumber(value, fallback=0){
    const n = Number(String(value ?? '').trim());
    return Number.isFinite(n) ? n : fallback;
  }

  function toMoneyNumber(value, fallback=NaN){
    if(typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    const text = String(value ?? '').trim().replace(/[¥￥元]/g, '').replace(/,/g, '');
    if(text === '') return fallback;
    return toNumber(text, fallback);
  }

  function parseBoolean(value, fallback=false){
    if(typeof value === 'boolean') return value;
    if(typeof value === 'number') return value > 0;
    const text = String(value ?? '').trim().toLowerCase();
    if(text === '') return fallback;
    if(TRUE_VALUES.has(text)) return true;
    if(FALSE_VALUES.has(text)) return false;
    return fallback;
  }

  function money(value){
    return (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);
  }

  function signedMoney(value){
    const n = Number(value) || 0;
    return `${n >= 0 ? '+' : '-'}¥${money(Math.abs(n))}`;
  }

  function rateText(rate){
    return Number.isFinite(rate) ? `${(rate * 100).toFixed(2)}%` : '无法计算';
  }

  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
    }[char]));
  }

  function normalizeDiscountRate(value){
    const n = toNumber(value, 1);
    if(n > 10) return n / 100;
    if(n > 1) return n / 10;
    return n;
  }

  function currentStore(){
    return state.stores.find(store => store.id === state.selectedStoreId) || state.stores[0];
  }

  function effectiveFeeRule(store=currentStore()){
    return store.usePlatformFee || !store.customFeeRule
      ? deepClone(state.platformRules)
      : { ...deepClone(state.platformRules), ...deepClone(store.customFeeRule) };
  }

  function effectiveProfitTargets(store=currentStore()){
    return (store.usePlatformTargets ? state.platformRules.profitTargets : store.profitTargets)
      .filter(target => target.enabled)
      .filter(target => target.payMax > 0 && target.rateMax > target.rateMin);
  }

  function setInputValue(id, value){
    const el = document.getElementById(id);
    if(!el) return;
    if(el.type === 'checkbox') el.checked = Boolean(value);
    else el.value = value ?? '';
  }

  function getInputValue(id){
    const el = document.getElementById(id);
    if(!el) return undefined;
    return el.type === 'checkbox' ? el.checked : el.value;
  }

  function render(){
    renderStoreSelect();
    renderNav();
    mountActivityPages();
    renderForms();
    renderTables();
    renderWarnings([]);
  }

  function renderStoreSelect(){
    const select = $('#currentStoreSelect');
    select.innerHTML = state.stores.map(store => (
      `<option value="${store.id}">${escapeHtml(store.name)}</option>`
    )).join('');
    select.value = currentStore().id;
  }

  function renderNav(){
    $$('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.page === state.activePage));
    $$('.page').forEach(page => page.classList.toggle('active', page.id === `page-${state.activePage}`));
  }

  function mountActivityPages(){
    PLATFORMS.forEach(platform => {
      const mount = $(`#${platform}ActivityMount`);
      if(!mount || mount.dataset.mounted) return;
      const name = PLATFORM_NAMES[platform];
      mount.innerHTML = `
        <section class="card">
          <div class="card-title with-action">
            <div><h2>${name}门店满减</h2><span>当前门店独立配置</span></div>
            <button class="small" data-add="${platform}-full">添加满减</button>
          </div>
          <div class="table-wrap compact">
            <table id="${platform}FullTable">
              <thead><tr><th>启用</th><th>门槛</th><th>减免</th><th></th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </section>
        <section class="card">
          <div class="card-title with-action">
            <div><h2>${name}订单优惠券</h2><span>订单级满减券，不绑定商品</span></div>
            <button class="small" data-add="${platform}-coupon">添加券</button>
          </div>
          <div class="table-wrap compact">
            <table id="${platform}CouponTable">
              <thead><tr><th>启用</th><th>名称</th><th>门槛</th><th>金额</th><th></th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </section>
        <section class="card">
          <div class="card-title with-action">
            <div><h2>${name}${platform === 'meituan' ? '神券' : '爆红包'}加码</h2><span>基础红包阶梯来自平台通用规则</span></div>
            <button class="small" data-add="${platform}-redAddOn">添加加码</button>
          </div>
          <div class="table-wrap compact">
            <table id="${platform}RedAddOnTable">
              <thead><tr><th>启用</th><th>红包门槛</th><th>加码</th><th></th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </section>
        <section class="card">
          <div class="card-title with-action">
            <div><h2>${name}商品折扣活动</h2><span>多个活动可同时存在，按最大优惠生效</span></div>
            <button class="small" data-add="${platform}-discount">添加折扣</button>
          </div>
          <div class="table-wrap compact">
            <table id="${platform}DiscountTable">
              <thead><tr><th>启用</th><th>名称</th><th>商品关键字</th><th>折扣</th><th>活动件数上限</th><th></th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </section>
      `;
      mount.dataset.mounted = '1';
    });
  }

  function renderForms(){
    const store = currentStore();
    const fee = effectiveFeeRule(store);
    setInputValue('riskSafetyMargin', state.riskSafetyMargin);
    setInputValue('storeName', store.name);
    setInputValue('storeStartPrice', store.startPrice);
    setInputValue('storeDeliveryDistance', store.deliveryDistance);
    setInputValue('storeOrderTime', store.orderTime);
    setInputValue('storeMaxItems', store.maxItems);
    setInputValue('storeMaxQtyPerSku', store.maxQtyPerSku);
    setInputValue('storeMaxCoupons', store.maxCoupons);
    setInputValue('storeMaxDiscountItems', store.maxDiscountItems);
    setInputValue('storeMaxChecks', store.maxChecks);
    setInputValue('storeUsePlatformFee', store.usePlatformFee);
    setInputValue('storeCommissionRate', fee.commissionRate);
    setInputValue('storeMinCommission', fee.minCommission);
    setInputValue('storeBaseDeliveryFee', fee.baseDeliveryFee);
    setInputValue('storeExtraDeliveryFee', fee.extraDeliveryFee);
    setInputValue('storeFreightWithin3', fee.freightWithin3);
    setInputValue('storeFreightWithin5', fee.freightWithin5);
    setInputValue('storeFreightAbove5', fee.freightAbove5);
    setInputValue('storeUsePlatformTargets', store.usePlatformTargets);

    setInputValue('platformCommissionRate', state.platformRules.commissionRate);
    setInputValue('platformMinCommission', state.platformRules.minCommission);
    setInputValue('platformBaseDeliveryFee', state.platformRules.baseDeliveryFee);
    setInputValue('platformExtraDeliveryFee', state.platformRules.extraDeliveryFee);
    setInputValue('platformMidPriceRate', state.platformRules.midPriceRate);
    setInputValue('platformHighPriceRate', state.platformRules.highPriceRate);
    setInputValue('platformFreightWithin3', state.platformRules.freightWithin3);
    setInputValue('platformFreightWithin5', state.platformRules.freightWithin5);
    setInputValue('platformFreightAbove5', state.platformRules.freightAbove5);

    toggleRuleInputs();
  }

  function toggleRuleInputs(){
    const store = currentStore();
    ['storeCommissionRate','storeMinCommission','storeBaseDeliveryFee','storeExtraDeliveryFee','storeFreightWithin3','storeFreightWithin5','storeFreightAbove5']
      .forEach(id => {
        const el = document.getElementById(id);
        if(el) el.disabled = store.usePlatformFee;
      });
  }

  function renderTables(){
    const store = currentStore();
    renderProductsTable(store.products);
    renderProfitTargetsTable('storeProfitTargetsTable', store.profitTargets, 'storeTargets', store.usePlatformTargets);
    renderProfitTargetsTable('platformProfitTargetsTable', state.platformRules.profitTargets, 'platformTargets', false);
    renderRedTierTable('meituanBaseRedTable', state.platformRules.redTiers.meituan, 'meituanBaseRed');
    renderRedTierTable('elemeBaseRedTable', state.platformRules.redTiers.eleme, 'elemeBaseRed');
    PLATFORMS.forEach(platform => renderActivityTables(platform, store.activities[platform]));
  }

  function renderProductsTable(products){
    const tbody = $('#productsTable tbody');
    tbody.innerHTML = products.map((p, index) => `
      <tr>
        <td><input data-field="name" value="${escapeHtml(p.name)}" /></td>
        <td><input data-field="price" type="number" step="0.01" value="${p.price}" /></td>
        <td><input data-field="cost" type="number" step="0.01" value="${p.cost}" /></td>
        <td><input data-field="meituanPrice" type="number" step="0.01" value="${p.meituanPrice ?? ''}" placeholder="空=销售价" /></td>
        <td><input data-field="elemePrice" type="number" step="0.01" value="${p.elemePrice ?? ''}" placeholder="空=销售价" /></td>
        <td class="center"><input data-field="nonStandalone" type="checkbox" ${p.nonStandalone ? 'checked' : ''} /></td>
        <td><button class="tiny danger" data-remove="products" data-index="${index}">删</button></td>
      </tr>
    `).join('');
  }

  function renderProfitTargetsTable(tableId, rows, collection, disabled){
    const tbody = $(`#${tableId} tbody`);
    tbody.innerHTML = rows.map((row, index) => `
      <tr>
        <td class="center"><input data-field="enabled" type="checkbox" ${row.enabled ? 'checked' : ''} ${disabled ? 'disabled' : ''} /></td>
        <td><input data-field="payMin" type="number" step="0.01" value="${row.payMin}" ${disabled ? 'disabled' : ''} /></td>
        <td><input data-field="payMax" type="number" step="0.01" value="${row.payMax}" ${disabled ? 'disabled' : ''} /></td>
        <td><input data-field="rateMin" type="number" step="0.01" value="${row.rateMin}" ${disabled ? 'disabled' : ''} /></td>
        <td><input data-field="rateMax" type="number" step="0.01" value="${row.rateMax}" ${disabled ? 'disabled' : ''} /></td>
        <td><button class="tiny danger" data-remove="${collection}" data-index="${index}" ${disabled ? 'disabled' : ''}>删</button></td>
      </tr>
    `).join('');
  }

  function renderRedTierTable(tableId, rows, collection){
    const tbody = $(`#${tableId} tbody`);
    tbody.innerHTML = rows.map((row, index) => `
      <tr>
        <td class="center"><input data-field="enabled" type="checkbox" ${row.enabled ? 'checked' : ''} /></td>
        <td><input data-field="threshold" type="number" step="0.01" value="${row.threshold}" /></td>
        <td><input data-field="min" type="number" step="0.01" value="${row.min}" /></td>
        <td><input data-field="max" type="number" step="0.01" value="${row.max}" /></td>
        <td><button class="tiny danger" data-remove="${collection}" data-index="${index}">删</button></td>
      </tr>
    `).join('');
  }

  function renderActivityTables(platform, activities){
    renderFullTable(`${platform}FullTable`, activities.fullReductions, `${platform}-full`);
    renderCouponTable(`${platform}CouponTable`, activities.coupons, `${platform}-coupon`);
    renderRedAddOnTable(`${platform}RedAddOnTable`, activities.redAddOns, `${platform}-redAddOn`);
    renderDiscountTable(`${platform}DiscountTable`, activities.discountActivities, `${platform}-discount`);
  }

  function renderFullTable(tableId, rows, collection){
    const tbody = $(`#${tableId} tbody`);
    if(!tbody) return;
    tbody.innerHTML = rows.map((row, index) => `
      <tr>
        <td class="center"><input data-field="enabled" type="checkbox" ${row.enabled ? 'checked' : ''} /></td>
        <td><input data-field="threshold" type="number" step="0.01" value="${row.threshold}" /></td>
        <td><input data-field="amount" type="number" step="0.01" value="${row.amount}" /></td>
        <td><button class="tiny danger" data-remove="${collection}" data-index="${index}">删</button></td>
      </tr>
    `).join('');
  }

  function renderCouponTable(tableId, rows, collection){
    const tbody = $(`#${tableId} tbody`);
    if(!tbody) return;
    tbody.innerHTML = rows.map((row, index) => `
      <tr>
        <td class="center"><input data-field="enabled" type="checkbox" ${row.enabled ? 'checked' : ''} /></td>
        <td><input data-field="name" value="${escapeHtml(row.name)}" /></td>
        <td><input data-field="threshold" type="number" step="0.01" value="${row.threshold}" /></td>
        <td><input data-field="amount" type="number" step="0.01" value="${row.amount}" /></td>
        <td><button class="tiny danger" data-remove="${collection}" data-index="${index}">删</button></td>
      </tr>
    `).join('');
  }

  function renderRedAddOnTable(tableId, rows, collection){
    const tbody = $(`#${tableId} tbody`);
    if(!tbody) return;
    tbody.innerHTML = rows.map((row, index) => `
      <tr>
        <td class="center"><input data-field="enabled" type="checkbox" ${row.enabled ? 'checked' : ''} /></td>
        <td><input data-field="threshold" type="number" step="0.01" value="${row.threshold}" /></td>
        <td><input data-field="amount" type="number" step="0.01" value="${row.amount}" /></td>
        <td><button class="tiny danger" data-remove="${collection}" data-index="${index}">删</button></td>
      </tr>
    `).join('');
  }

  function renderDiscountTable(tableId, rows, collection){
    const tbody = $(`#${tableId} tbody`);
    if(!tbody) return;
    tbody.innerHTML = rows.map((row, index) => `
      <tr>
        <td class="center"><input data-field="enabled" type="checkbox" ${row.enabled ? 'checked' : ''} /></td>
        <td><input data-field="name" value="${escapeHtml(row.name)}" /></td>
        <td><input data-field="productNames" value="${escapeHtml(row.productNames)}" placeholder="空=全部，多个用逗号" /></td>
        <td><input data-field="discountRate" type="number" step="0.01" value="${row.discountRate}" /></td>
        <td><input data-field="itemLimit" type="number" min="0" step="1" value="${row.itemLimit ?? ''}" placeholder="空=不限" /></td>
        <td><button class="tiny danger" data-remove="${collection}" data-index="${index}">删</button></td>
      </tr>
    `).join('');
  }

  function readAllForms(){
    const store = currentStore();
    state.riskSafetyMargin = Math.max(0, toNumber(getInputValue('riskSafetyMargin'), state.riskSafetyMargin || 0));
    readPlatformRules();
    readStoreForm(store);
    store.products = readProductsTable();
    store.profitTargets = readProfitTargetsTable('storeProfitTargetsTable');
    state.platformRules.profitTargets = readProfitTargetsTable('platformProfitTargetsTable');
    state.platformRules.redTiers.meituan = readRedTierTable('meituanBaseRedTable');
    state.platformRules.redTiers.eleme = readRedTierTable('elemeBaseRedTable');
    PLATFORMS.forEach(platform => store.activities[platform] = readActivityTables(platform));
  }

  function readPlatformRules(){
    state.platformRules.commissionRate = toNumber(getInputValue('platformCommissionRate'), state.platformRules.commissionRate);
    state.platformRules.minCommission = toNumber(getInputValue('platformMinCommission'), state.platformRules.minCommission);
    state.platformRules.baseDeliveryFee = toNumber(getInputValue('platformBaseDeliveryFee'), state.platformRules.baseDeliveryFee);
    state.platformRules.extraDeliveryFee = toNumber(getInputValue('platformExtraDeliveryFee'), state.platformRules.extraDeliveryFee);
    state.platformRules.midPriceRate = toNumber(getInputValue('platformMidPriceRate'), state.platformRules.midPriceRate);
    state.platformRules.highPriceRate = toNumber(getInputValue('platformHighPriceRate'), state.platformRules.highPriceRate);
    state.platformRules.freightWithin3 = toNumber(getInputValue('platformFreightWithin3'), state.platformRules.freightWithin3);
    state.platformRules.freightWithin5 = toNumber(getInputValue('platformFreightWithin5'), state.platformRules.freightWithin5);
    state.platformRules.freightAbove5 = toNumber(getInputValue('platformFreightAbove5'), state.platformRules.freightAbove5);
  }

  function readStoreForm(store){
    if(!store) return;
    store.name = String(getInputValue('storeName') || store.name).trim() || '未命名门店';
    store.startPrice = Math.max(0, toNumber(getInputValue('storeStartPrice'), store.startPrice));
    store.deliveryDistance = Math.max(0, toNumber(getInputValue('storeDeliveryDistance'), store.deliveryDistance));
    store.orderTime = String(getInputValue('storeOrderTime') || '12:00');
    store.maxItems = clampInt(getInputValue('storeMaxItems'), 1, 10, store.maxItems);
    store.maxQtyPerSku = clampInt(getInputValue('storeMaxQtyPerSku'), 1, 10, store.maxQtyPerSku);
    store.maxCoupons = clampInt(getInputValue('storeMaxCoupons'), 0, 8, store.maxCoupons);
    const maxDiscountRaw = String(getInputValue('storeMaxDiscountItems') ?? '').trim();
    store.maxDiscountItems = maxDiscountRaw === '' ? '' : Math.max(0, Math.floor(toNumber(maxDiscountRaw, 0)));
    store.maxChecks = Math.max(1000, Math.floor(toNumber(getInputValue('storeMaxChecks'), store.maxChecks)));
    store.usePlatformFee = Boolean(getInputValue('storeUsePlatformFee'));
    store.usePlatformTargets = Boolean(getInputValue('storeUsePlatformTargets'));
    if(!store.usePlatformFee){
      store.customFeeRule = {
        commissionRate: toNumber(getInputValue('storeCommissionRate'), state.platformRules.commissionRate),
        minCommission: toNumber(getInputValue('storeMinCommission'), state.platformRules.minCommission),
        baseDeliveryFee: toNumber(getInputValue('storeBaseDeliveryFee'), state.platformRules.baseDeliveryFee),
        extraDeliveryFee: toNumber(getInputValue('storeExtraDeliveryFee'), state.platformRules.extraDeliveryFee),
        freightWithin3: toNumber(getInputValue('storeFreightWithin3'), state.platformRules.freightWithin3),
        freightWithin5: toNumber(getInputValue('storeFreightWithin5'), state.platformRules.freightWithin5),
        freightAbove5: toNumber(getInputValue('storeFreightAbove5'), state.platformRules.freightAbove5)
      };
    }
  }

  function clampInt(value, min, max, fallback){
    const n = Math.floor(toNumber(value, fallback));
    return Math.max(min, Math.min(max, n));
  }

  function readProductsTable(){
    return $$('#productsTable tbody tr').map((tr, index) => {
      const row = readRowFields(tr);
      const name = String(row.name ?? '').trim();
      const price = toMoneyNumber(row.price, NaN);
      if(!name || !(price > 0)) return null;
      return {
        id: currentStore().products[index]?.id || uid('p'),
        name,
        price,
        cost: Math.max(0, toMoneyNumber(row.cost, 0)),
        meituanPrice: normalizeOptionalPrice(row.meituanPrice),
        elemePrice: normalizeOptionalPrice(row.elemePrice),
        nonStandalone: parseBoolean(row.nonStandalone)
      };
    }).filter(Boolean);
  }

  function normalizeOptionalPrice(value){
    const text = String(value ?? '').trim();
    if(text === '') return '';
    const n = toMoneyNumber(text, NaN);
    return n > 0 ? n : '';
  }

  function readProfitTargetsTable(tableId){
    return $$(`#${tableId} tbody tr`).map(tr => {
      const row = readRowFields(tr);
      let payMin = toNumber(row.payMin, NaN);
      let payMax = toNumber(row.payMax, NaN);
      let rateMin = toNumber(row.rateMin, NaN);
      let rateMax = toNumber(row.rateMax, NaN);
      if(payMin > payMax) [payMin, payMax] = [payMax, payMin];
      if(rateMin > rateMax) [rateMin, rateMax] = [rateMax, rateMin];
      return { enabled:parseBoolean(row.enabled), payMin, payMax, rateMin, rateMax };
    }).filter(row => Number.isFinite(row.payMin) && Number.isFinite(row.payMax) && Number.isFinite(row.rateMin) && Number.isFinite(row.rateMax));
  }

  function readRedTierTable(tableId){
    return $$(`#${tableId} tbody tr`).map(tr => {
      const row = readRowFields(tr);
      let min = toNumber(row.min, NaN);
      let max = toNumber(row.max, NaN);
      if(min > max) [min, max] = [max, min];
      return {
        enabled: parseBoolean(row.enabled),
        threshold: toNumber(row.threshold, NaN),
        min,
        max
      };
    }).filter(row => Number.isFinite(row.threshold) && Number.isFinite(row.min) && Number.isFinite(row.max));
  }

  function readActivityTables(platform){
    return {
      fullReductions: readFullTable(`${platform}FullTable`),
      coupons: readCouponTable(`${platform}CouponTable`),
      redAddOns: readRedAddOnTable(`${platform}RedAddOnTable`),
      discountActivities: readDiscountTable(`${platform}DiscountTable`)
    };
  }

  function readFullTable(tableId){
    return $$(`#${tableId} tbody tr`).map(tr => {
      const row = readRowFields(tr);
      return { enabled:parseBoolean(row.enabled), threshold:toNumber(row.threshold, NaN), amount:toNumber(row.amount, NaN) };
    }).filter(row => Number.isFinite(row.threshold) && Number.isFinite(row.amount));
  }

  function readCouponTable(tableId){
    return $$(`#${tableId} tbody tr`).map(tr => {
      const row = readRowFields(tr);
      return {
        enabled: parseBoolean(row.enabled),
        name: String(row.name ?? '').trim() || '订单优惠券',
        threshold: toNumber(row.threshold, NaN),
        amount: toNumber(row.amount, NaN)
      };
    }).filter(row => Number.isFinite(row.threshold) && Number.isFinite(row.amount));
  }

  function readRedAddOnTable(tableId){
    return $$(`#${tableId} tbody tr`).map(tr => {
      const row = readRowFields(tr);
      return { enabled:parseBoolean(row.enabled), threshold:toNumber(row.threshold, NaN), amount:toNumber(row.amount, NaN) };
    }).filter(row => Number.isFinite(row.threshold) && Number.isFinite(row.amount));
  }

  function readDiscountTable(tableId){
    return $$(`#${tableId} tbody tr`).map(tr => {
      const row = readRowFields(tr);
      return {
        enabled: parseBoolean(row.enabled),
        name: String(row.name ?? '').trim() || '商品折扣',
        productNames: String(row.productNames ?? '').trim(),
        discountRate: toNumber(row.discountRate, NaN),
        itemLimit: String(row.itemLimit ?? '').trim() === '' ? '' : Math.max(0, Math.floor(toNumber(row.itemLimit, 0)))
      };
    }).filter(row => Number.isFinite(row.discountRate));
  }

  function readRowFields(tr){
    const row = {};
    $$('[data-field]', tr).forEach(input => {
      row[input.dataset.field] = input.type === 'checkbox' ? input.checked : input.value;
    });
    return row;
  }

  function addRow(type){
    readAllForms();
    const store = currentStore();
    const target = resolveCollection(type, store);
    if(!target) return;
    target.push(makeNewRow(type));
    render();
  }

  function removeRow(type, index){
    readAllForms();
    const store = currentStore();
    const target = resolveCollection(type, store);
    if(!target) return;
    target.splice(index, 1);
    render();
  }

  function resolveCollection(type, store){
    const map = {
      products: store.products,
      storeTargets: store.profitTargets,
      platformTargets: state.platformRules.profitTargets,
      meituanBaseRed: state.platformRules.redTiers.meituan,
      elemeBaseRed: state.platformRules.redTiers.eleme
    };
    if(map[type]) return map[type];
    const [platform, kind] = type.split('-');
    if(!PLATFORMS.includes(platform)) return null;
    const activity = store.activities[platform];
    return {
      full: activity.fullReductions,
      coupon: activity.coupons,
      redAddOn: activity.redAddOns,
      discount: activity.discountActivities
    }[kind] || null;
  }

  function makeNewRow(type){
    if(type === 'products') return { id:uid('p'), name:'新商品', price:0, cost:0, meituanPrice:'', elemePrice:'', nonStandalone:false };
    if(type.endsWith('Targets')) return { enabled:true, payMin:0, payMax:20, rateMin:20, rateMax:30 };
    if(type.endsWith('BaseRed')) return { enabled:true, threshold:0, min:0, max:0 };
    if(type.endsWith('-full')) return { enabled:true, threshold:0, amount:0 };
    if(type.endsWith('-coupon')) return { enabled:true, name:'订单优惠券', threshold:0, amount:0 };
    if(type.endsWith('-redAddOn')) return { enabled:true, threshold:0, amount:0 };
    if(type.endsWith('-discount')) return { enabled:true, name:'商品折扣', productNames:'', discountRate:8.8, itemLimit:'' };
    return {};
  }

  function runCalculation(){
    readAllForms();
    const t0 = performance.now();
    const store = currentStore();
    const warnings = [];
    if(!store.products.length) warnings.push('当前门店没有有效商品，请先导入或维护商品。');
    const platformFilter = $('#resultPlatformFilter').value;
    const platforms = platformFilter === 'all' ? PLATFORMS : [platformFilter];
    const results = [];
    const qtys = Array(store.products.length).fill(0);
    let checked = 0;
    let validCombos = 0;
    let stopped = false;

    function dfs(index, totalQty){
      if(stopped) return;
      if(index === store.products.length){
        if(totalQty === 0) return;
        checked++;
        if(checked > store.maxChecks){
          stopped = true;
          return;
        }
        if(!qtys.some((qty, i) => qty > 0 && !store.products[i].nonStandalone)) return;
        validCombos++;
        for(const platform of platforms){
          const result = evaluateCombo(store, platform, qtys);
          if(result) results.push(...result);
        }
        return;
      }
      const maxQty = Math.min(store.maxQtyPerSku, store.maxItems - totalQty);
      for(let qty = 0; qty <= maxQty; qty++){
        qtys[index] = qty;
        dfs(index + 1, totalQty + qty);
        if(stopped) return;
      }
      qtys[index] = 0;
    }

    if(store.products.length) dfs(0, 0);
    if(stopped) warnings.push(`已达到最多检查组合数 ${store.maxChecks}，已停止继续枚举。`);
    lastResults = annotateRiskWarnings(sortRows(dedupeResults(results), resultSort));
    lastRiskWarnings = buildRiskWarnings(lastResults);
    renderResults(lastResults, checked, validCombos, Math.round(performance.now() - t0));
    renderRiskWarnings(lastRiskWarnings);
    renderWarnings(warnings);
  }

  function evaluateCombo(store, platform, qtys){
    const totals = buildPlatformTotals(store, platform, qtys);
    if(!totals.items.length) return [];
    if(totals.afterProductDiscount + 1e-9 < store.startPrice) return [];
    const activity = store.activities[platform];
    const full = bestFullReduction(activity.fullReductions, totals.afterProductDiscount);
    const afterFull = Math.max(0, roundMoney(totals.afterProductDiscount - full.amount));
    const couponOptions = eligibleCouponOptions(activity.coupons, afterFull, store.maxCoupons);
    const output = [];

    for(const couponOption of couponOptions){
      const afterCoupon = Math.max(0, roundMoney(afterFull - couponOption.amount));
      const baseRed = bestBaseRed(platform, afterCoupon);
      const addOn = bestRedAddOn(activity.redAddOns, afterCoupon);
      const finalPay = Math.max(0, roundMoney(afterCoupon - baseRed.amount - addOn.amount));
      const fee = buildFeeSummary(store, finalPay);
      const activityAmount = roundMoney(totals.productDiscount + full.amount + couponOption.amount + baseRed.amount + addOn.amount + fee.freightSubsidy);
      const profit = roundMoney(finalPay - fee.commission - fee.serviceFee - fee.freightSubsidy - totals.costTotal);
      output.push({
        platform,
        platformName: PLATFORM_NAMES[platform],
        items: totals.items,
        finalPay,
        cost: totals.costTotal,
        activityAmount,
        commission: fee.commission,
        serviceFee: fee.serviceFee,
        freightSubsidy: fee.freightSubsidy,
        profit,
        profitRate: finalPay > 0 ? profit / finalPay : null,
        productDiscount: totals.productDiscount,
        full,
        coupons: couponOption.coupons,
        couponAmount: couponOption.amount,
        baseRed,
        redAddOn: addOn,
        originalTotal: totals.originalTotal,
        afterProductDiscount: totals.afterProductDiscount
      });
    }
    return output;
  }

  function buildPlatformTotals(store, platform, qtys){
    const units = [];
    const items = [];
    let originalTotal = 0;
    let costTotal = 0;
    store.products.forEach((product, index) => {
      const qty = qtys[index] || 0;
      if(qty <= 0) return;
      const price = platformPrice(product, platform);
      const cost = Number(product.cost) || 0;
      originalTotal += price * qty;
      costTotal += cost * qty;
      items.push({ name:product.name, qty, price, cost, nonStandalone:product.nonStandalone });
      for(let unitIndex = 0; unitIndex < qty; unitIndex++){
        units.push({ product, price, discount:0, activityName:'' });
      }
    });
    const discount = applyProductDiscounts(units, store.activities[platform].discountActivities, store.maxDiscountItems);
    return {
      items,
      originalTotal: roundMoney(originalTotal),
      costTotal: roundMoney(costTotal),
      productDiscount: roundMoney(discount),
      afterProductDiscount: roundMoney(originalTotal - discount)
    };
  }

  function platformPrice(product, platform){
    const platformValue = platform === 'eleme' ? product.elemePrice : product.meituanPrice;
    const n = Number(platformValue);
    return n > 0 ? n : Number(product.price) || 0;
  }

  function applyProductDiscounts(units, activities, maxDiscountItems){
    const enabled = activities.filter(a => a.enabled);
    if(!enabled.length) return 0;
    const candidates = [];
    enabled.forEach((activity, activityIndex) => {
      units.forEach((unit, unitIndex) => {
        if(!activityMatchesProduct(activity, unit.product)) return;
        const discounted = roundMoney(unit.price * normalizeDiscountRate(activity.discountRate));
        const amount = roundMoney(unit.price - discounted);
        if(amount > 0) candidates.push({ unitIndex, activityIndex, amount });
      });
    });
    candidates.sort((a, b) => b.amount - a.amount);
    const globalLimit = maxDiscountItems === '' ? Infinity : Math.max(0, Number(maxDiscountItems) || 0);
    const activityLimits = enabled.map(activity => activity.itemLimit === '' ? Infinity : Math.max(0, Number(activity.itemLimit) || 0));
    const usedUnits = new Set();
    let usedGlobal = 0;
    let total = 0;
    for(const candidate of candidates){
      if(usedGlobal >= globalLimit) break;
      if(usedUnits.has(candidate.unitIndex)) continue;
      if(activityLimits[candidate.activityIndex] <= 0) continue;
      usedUnits.add(candidate.unitIndex);
      usedGlobal++;
      activityLimits[candidate.activityIndex]--;
      total += candidate.amount;
    }
    return roundMoney(total);
  }

  function activityMatchesProduct(activity, product){
    const text = String(activity.productNames || '').trim();
    if(!text) return true;
    return text.split(/[,，、\s]+/).filter(Boolean).some(keyword => product.name.includes(keyword));
  }

  function bestFullReduction(rows, basis){
    return rows
      .filter(row => row.enabled && basis + 1e-9 >= row.threshold)
      .sort((a, b) => b.amount - a.amount || b.threshold - a.threshold)[0] || { threshold:0, amount:0 };
  }

  function eligibleCouponOptions(coupons, basis, maxCoupons){
    const eligible = coupons.filter(c => c.enabled && basis + 1e-9 >= c.threshold);
    const options = [{ coupons:[], amount:0 }];
    function dfs(start, chosen, amount){
      if(chosen.length >= maxCoupons) return;
      for(let i = start; i < eligible.length; i++){
        const coupon = eligible[i];
        const next = chosen.concat(coupon);
        const nextAmount = roundMoney(amount + coupon.amount);
        options.push({ coupons:next, amount:nextAmount });
        dfs(i + 1, next, nextAmount);
      }
    }
    if(maxCoupons > 0) dfs(0, [], 0);
    return options;
  }

  function bestBaseRed(platform, basis){
    const tier = state.platformRules.redTiers[platform]
      .filter(row => row.enabled && basis + 1e-9 >= row.threshold)
      .sort((a, b) => b.max - a.max || b.threshold - a.threshold)[0];
    if(!tier) return { threshold:0, min:0, max:0, amount:0 };
    return { ...tier, amount:roundMoney(Math.max(0, Number(tier.max) || 0)) };
  }

  function bestRedAddOn(rows, basis){
    return rows
      .filter(row => row.enabled && basis + 1e-9 >= row.threshold)
      .sort((a, b) => b.amount - a.amount || b.threshold - a.threshold)[0] || { threshold:0, amount:0 };
  }

  function buildFeeSummary(store, finalPay){
    const rule = effectiveFeeRule(store);
    const commission = roundMoney(Math.max(finalPay * (rule.commissionRate / 100), rule.minCommission));
    const serviceFee = calculateServiceFee(rule, store, finalPay);
    const freightSubsidy = calculateFreightSubsidy(rule, store.deliveryDistance);
    return { commission, serviceFee, freightSubsidy };
  }

  function calculateServiceFee(rule, store, priceBasis){
    const distance = Math.max(0, Number(store.deliveryDistance) || 0);
    const extraUnits = distance <= 3 ? 0 : Math.ceil(((distance - 3) * 10) - 1e-9);
    const distanceFee = roundMoney(rule.baseDeliveryFee + extraUnits * rule.extraDeliveryFee);
    const basis = Math.max(0, Number(priceBasis) || 0);
    let priceFee = 0;
    if(basis > 25) priceFee = 5 * rule.midPriceRate + (basis - 25) * rule.highPriceRate;
    else if(basis > 20) priceFee = (basis - 20) * rule.midPriceRate;
    const timeFee = calculateTimeFee(store.orderTime);
    return roundMoney(distanceFee + priceFee + timeFee);
  }

  function calculateTimeFee(value){
    const minutes = parseOrderMinutes(value);
    if(minutes === null) return 0;
    if(minutes > 0 && minutes <= 120) return 0.8;
    if(minutes > 120 && minutes <= 360) return 1;
    if(minutes > 1260 && minutes <= 1440) return 0.3;
    return 0;
  }

  function parseOrderMinutes(value){
    const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if(!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if(hour === 24 && minute === 0) return 1440;
    if(hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return hour * 60 + minute;
  }

  function calculateFreightSubsidy(rule, distanceValue){
    const distance = Math.max(0, Number(distanceValue) || 0);
    if(distance <= 3) return roundMoney(rule.freightWithin3);
    if(distance <= 5) return roundMoney(rule.freightWithin5);
    return roundMoney(rule.freightAbove5);
  }

  function roundMoney(value){
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function dedupeResults(results){
    const seen = new Set();
    const output = [];
    for(const result of results){
      const itemKey = result.items.map(item => `${item.name}:${item.qty}`).join('|');
      const couponKey = result.coupons.map(c => `${c.name}:${c.amount}`).join('|');
      const key = [result.platform, itemKey, result.finalPay, result.full.amount, couponKey, result.baseRed.amount, result.redAddOn.amount].join('::');
      if(seen.has(key)) continue;
      seen.add(key);
      output.push(result);
    }
    return output;
  }

  function sortRows(rows, sort){
    const copy = rows.slice();
    copy.sort((a, b) => compareValues(a[sort.key], b[sort.key], sort.dir));
    return copy;
  }

  function compareValues(a, b, dir){
    const multiplier = dir === 'asc' ? 1 : -1;
    if(typeof a === 'string' || typeof b === 'string') return String(a ?? '').localeCompare(String(b ?? ''), 'zh-CN') * multiplier;
    return ((Number(a) || 0) - (Number(b) || 0)) * multiplier;
  }

  function annotateRiskWarnings(rows){
    const targets = effectiveProfitTargets();
    return rows.map(row => ({
      ...row,
      risk: buildRiskInfo(row, targets)
    }));
  }

  function buildRiskInfo(row, targets){
    const target = targetForPayExtended(row.finalPay, targets);
    const marginRate = (Number(state.riskSafetyMargin) || 0) / 100;
    const reasons = [];
    let severity = 'none';
    let thresholdRate = null;
    let rateGap = null;

    if(row.profit < 0){
      severity = maxSeverity(severity, 'critical');
      reasons.push('亏损');
    }
    if(row.finalPay + 1e-9 < row.cost){
      severity = maxSeverity(severity, 'high');
      reasons.push('用户实付低于成本');
    }
    if(target){
      thresholdRate = target.rateMin / 100 + marginRate;
      rateGap = Number.isFinite(row.profitRate) ? row.profitRate - thresholdRate : null;
      if(!Number.isFinite(row.profitRate) || row.profitRate + 1e-9 < thresholdRate){
        severity = maxSeverity(severity, row.profit < 0 ? 'critical' : 'medium');
        reasons.push(`利润率低于${money(target.rateMin + state.riskSafetyMargin)}%阈值`);
      }
    }else{
      severity = maxSeverity(severity, 'config');
      reasons.push('未匹配利润率阶梯');
    }

    return {
      hasRisk: severity !== 'none',
      severity,
      severityRank: severityRank(severity),
      reasons,
      target,
      thresholdRate,
      rateGap
    };
  }

  function targetForPayExtended(pay, targets){
    const sorted = targets.slice().sort((a, b) => a.payMin - b.payMin || a.payMax - b.payMax);
    if(!sorted.length) return null;
    const matched = sorted.find(target => pay + 1e-9 >= target.payMin && pay <= target.payMax + 1e-9);
    if(matched) return matched;
    if(pay < sorted[0].payMin) return sorted[0];
    return sorted[sorted.length - 1];
  }

  function maxSeverity(a, b){
    return severityRank(b) < severityRank(a) ? b : a;
  }

  function severityRank(severity){
    return { critical:0, high:1, medium:2, config:3, none:9 }[severity] ?? 9;
  }

  function buildRiskWarnings(rows){
    return rows
      .filter(row => row.risk?.hasRisk)
      .sort((a, b) => a.risk.severityRank - b.risk.severityRank ||
        a.profit - b.profit ||
        (a.profitRate || 0) - (b.profitRate || 0) ||
        a.finalPay - b.finalPay);
  }

  function renderResults(results, checked, validCombos, elapsed){
    const displayRows = $('#riskOnlyToggle')?.checked ? results.filter(row => row.risk?.hasRisk) : results;
    $('#resultCount').textContent = displayRows.length;
    $('#comboCount').textContent = checked;
    $('#validComboCount').textContent = validCombos;
    if(elapsed !== null) $('#elapsedTime').textContent = `${elapsed}ms`;
    const tbody = $('#resultsTable tbody');
    if(!displayRows.length){
      tbody.innerHTML = '<tr><td colspan="10" class="empty">没有找到商品组合结果。</td></tr>';
      return;
    }
    tbody.innerHTML = displayRows.map(row => `
      <tr class="${riskRowClass(row.risk)}">
        <td><span class="tag green">${row.platformName}</span>${row.risk?.hasRisk ? `<br>${renderRiskBadge(row.risk)}` : ''}</td>
        <td>${renderItems(row.items)}</td>
        <td class="money">¥${money(row.finalPay)}</td>
        <td class="money">¥${money(row.cost)}</td>
        <td class="money">¥${money(row.activityAmount)}</td>
        <td class="money">¥${money(row.commission)}</td>
        <td class="money">¥${money(row.serviceFee)}</td>
        <td class="${row.profit < 0 ? 'bad' : 'ok'}">${signedMoney(row.profit)}</td>
        <td class="${row.profit < 0 ? 'bad' : 'ok'}">${rateText(row.profitRate)}</td>
        <td>${renderDiscountBreakdown(row)}</td>
      </tr>
    `).join('');
  }

  function riskRowClass(risk){
    if(!risk?.hasRisk) return '';
    return `risk-row risk-${risk.severity}`;
  }

  function renderRiskBadge(risk){
    const labels = { critical:'严重', high:'高', medium:'中', config:'配置' };
    return `<span class="risk-badge risk-badge-${risk.severity}">${labels[risk.severity] || '风险'}</span>`;
  }

  function renderRiskWarnings(rows){
    const tbody = $('#riskTable tbody');
    const lossRows = rows.filter(row => row.profit < 0);
    const lowRateRows = rows.filter(row => row.risk?.reasons.some(reason => reason.includes('利润率低于')));
    const belowCostRows = rows.filter(row => row.finalPay + 1e-9 < row.cost);
    const lowestRate = rows.reduce((min, row) => Math.min(min, Number.isFinite(row.profitRate) ? row.profitRate : min), Infinity);
    const maxLoss = lossRows.reduce((min, row) => Math.min(min, row.profit), 0);

    $('#riskTotalCount').textContent = rows.length;
    $('#riskLossCount').textContent = lossRows.length;
    $('#riskLowRateCount').textContent = lowRateRows.length;
    $('#riskBelowCostCount').textContent = belowCostRows.length;
    $('#riskLowestRate').textContent = Number.isFinite(lowestRate) ? rateText(lowestRate) : '--';
    $('#riskMaxLoss').textContent = maxLoss < 0 ? signedMoney(maxLoss) : '--';

    if(!rows.length){
      tbody.innerHTML = '<tr><td colspan="15" class="empty">当前没有预警组合。</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(row => `
      <tr class="${riskRowClass(row.risk)}">
        <td>${renderRiskBadge(row.risk)}</td>
        <td><span class="tag green">${row.platformName}</span></td>
        <td>${renderItems(row.items)}</td>
        <td class="money">¥${money(row.finalPay)}</td>
        <td class="money">¥${money(row.cost)}</td>
        <td class="money">¥${money(row.activityAmount)}</td>
        <td class="money">¥${money(row.commission)}</td>
        <td class="money">¥${money(row.serviceFee)}</td>
        <td class="money">¥${money(row.freightSubsidy)}</td>
        <td class="${row.profit < 0 ? 'bad' : 'ok'}">${signedMoney(row.profit)}</td>
        <td class="${row.profit < 0 ? 'bad' : 'ok'}">${rateText(row.profitRate)}</td>
        <td>${renderRiskTarget(row.risk)}</td>
        <td>${renderRiskGap(row.risk)}</td>
        <td>${row.risk.reasons.map(escapeHtml).join('<br>')}</td>
        <td>${renderDiscountBreakdown(row)}</td>
      </tr>
    `).join('');
  }

  function renderRiskTarget(risk){
    if(!risk?.target) return '<span class="tag gray">未配置</span>';
    const margin = Number(state.riskSafetyMargin) || 0;
    const range = riskTargetRangeText(risk.target);
    return `
      <span class="tag">${range}</span><br>
      <span class="tag green">${money(risk.target.rateMin)}% + ${money(margin)}%</span>
    `;
  }

  function riskTargetRangeText(target){
    const targets = effectiveProfitTargets().slice().sort((a, b) => a.payMin - b.payMin || a.payMax - b.payMax);
    const last = targets[targets.length - 1];
    if(last && last.payMin === target.payMin && last.payMax === target.payMax){
      return `¥${money(target.payMin)}以上`;
    }
    return `¥${money(target.payMin)}-${money(target.payMax)}`;
  }

  function renderRiskGap(risk){
    if(!Number.isFinite(risk?.rateGap)) return '--';
    const cls = risk.rateGap < 0 ? 'bad' : 'ok';
    return `<span class="${cls}">${(risk.rateGap * 100).toFixed(2)}%</span>`;
  }

  function renderItems(items){
    return items.map(item => `<span class="tag">${escapeHtml(item.name)} x ${item.qty}</span>`).join('');
  }

  function renderDiscountBreakdown(row){
    return `
      商品折扣 ¥${money(row.productDiscount)}<br>
      满减 ${row.full.amount ? `满${money(row.full.threshold)}减${money(row.full.amount)}` : '无'}<br>
      优惠券 ${row.coupons.length ? row.coupons.map(c => `${escapeHtml(c.name)} -¥${money(c.amount)}`).join('，') : '无'}<br>
      基础红包 ¥${money(row.baseRed.amount)} / 加码 ¥${money(row.redAddOn.amount)}<br>
      运费补贴 ¥${money(row.freightSubsidy)}
    `;
  }

  function runOptimization(){
    readAllForms();
    const t0 = performance.now();
    const store = currentStore();
    const targets = effectiveProfitTargets();
    const platformFilter = $('#resultPlatformFilter').value;
    const platforms = platformFilter === 'all' ? PLATFORMS : [platformFilter];
    const rows = [];
    const qtys = Array(store.products.length).fill(0);
    let checked = 0;
    let validCombos = 0;
    let stopped = false;

    function dfs(index, totalQty){
      if(stopped) return;
      if(index === store.products.length){
        if(totalQty === 0) return;
        checked++;
        if(checked > store.maxChecks){
          stopped = true;
          return;
        }
        if(!qtys.some((qty, i) => qty > 0 && !store.products[i].nonStandalone)) return;
        validCombos++;
        for(const platform of platforms){
          const base = evaluateOptimizationBase(store, platform, qtys);
          if(!base) continue;
          for(const target of targets){
            const candidate = buildOptimizationCandidate(store, platform, base, target);
            if(candidate) rows.push(candidate);
          }
        }
        return;
      }
      const maxQty = Math.min(store.maxQtyPerSku, store.maxItems - totalQty);
      for(let qty = 0; qty <= maxQty; qty++){
        qtys[index] = qty;
        dfs(index + 1, totalQty + qty);
        if(stopped) return;
      }
      qtys[index] = 0;
    }

    if(store.products.length && targets.length) dfs(0, 0);
    const grouped = new Map();
    for(const row of rows){
      const key = [
        row.platform,
        row.fullThreshold,
        row.fullAmount,
        row.couponThreshold,
        row.couponAmount,
        row.redAddThreshold,
        row.redAddAmount,
        row.target.payMin,
        row.target.payMax
      ].join('::');
      if(!grouped.has(key)){
        grouped.set(key, {
          platform: row.platform,
          platformName: row.platformName,
          full: { threshold:row.fullThreshold, amount:row.fullAmount },
          coupon: { threshold:row.couponThreshold, amount:row.couponAmount, name:'建议订单券' },
          redAddOn: { threshold:row.redAddThreshold, amount:row.redAddAmount },
          target: row.target,
          coverage: 0,
          scoreTotal: 0,
          finalPayTotal: 0,
          profitRateTotal: 0,
          example: row
        });
      }
      const group = grouped.get(key);
      group.coverage++;
      group.scoreTotal += row.score;
      group.finalPayTotal += row.finalPay;
      group.profitRateTotal += row.profitRate || 0;
      if(row.score > group.example.score) group.example = row;
    }
    lastOptimizations = Array.from(grouped.values()).map(group => ({
      ...group,
      score: group.scoreTotal / group.coverage,
      finalPay: group.finalPayTotal / group.coverage,
      profitRate: group.profitRateTotal / group.coverage
    }));
    lastOptimizations = sortRows(lastOptimizations, optimizationSort);
    renderOptimizations(lastOptimizations);
    $('#comboCount').textContent = checked;
    $('#validComboCount').textContent = validCombos;
    $('#elapsedTime').textContent = `${Math.round(performance.now() - t0)}ms`;
    renderWarnings(stopped ? [`已达到最多检查组合数 ${store.maxChecks}，已停止继续枚举。`] : []);
  }

  function evaluateOptimizationBase(store, platform, qtys){
    const totals = buildPlatformTotals(store, platform, qtys);
    if(!totals.items.length) return null;
    if(totals.afterProductDiscount + 1e-9 < store.startPrice) return null;
    const baseRed = bestBaseRed(platform, totals.afterProductDiscount);
    const basePay = Math.max(0, roundMoney(totals.afterProductDiscount - baseRed.amount));
    if(basePay <= 0) return null;
    return {
      platform,
      platformName: PLATFORM_NAMES[platform],
      items: totals.items,
      afterProductDiscount: totals.afterProductDiscount,
      cost: totals.costTotal,
      baseRed,
      basePay
    };
  }

  function buildOptimizationCandidate(store, platform, base, target){
    const lower = Math.max(0.01, Number(target.payMin) || 0);
    const upper = Math.min(Number(target.payMax) || base.basePay, base.basePay);
    if(upper < lower) return null;
    const midRate = ((Number(target.rateMin) || 0) + (Number(target.rateMax) || 0)) / 200;
    const desiredPay = findClosestPayForRate(store, base.cost, lower, upper, midRate);
    if(desiredPay === null) return null;
    const merchantDiscount = roundMoney(base.basePay - desiredPay);
    if(merchantDiscount < 0) return null;
    const split = splitSuggestedDiscount(merchantDiscount, base.afterProductDiscount, base.baseRed.threshold);
    const finalPay = Math.max(0, roundMoney(base.basePay - split.total));
    const metrics = buildProfitMetrics(store, base.cost, finalPay);
    const score = Math.abs((metrics.profitRate || 0) - midRate);
    return {
      platform,
      platformName: PLATFORM_NAMES[platform],
      target,
      items: base.items,
      fullThreshold: split.fullThreshold,
      fullAmount: split.fullAmount,
      couponThreshold: split.couponThreshold,
      couponAmount: split.couponAmount,
      redAddThreshold: split.redAddThreshold,
      redAddAmount: split.redAddAmount,
      finalPay,
      profitRate: metrics.profitRate,
      score
    };
  }

  function findClosestPayForRate(store, cost, lower, upper, targetRate){
    let bestPay = null;
    let bestScore = Infinity;
    const steps = Math.max(1, Math.ceil((upper - lower) / 0.1));
    for(let i = 0; i <= steps; i++){
      const pay = roundMoney(lower + (upper - lower) * (i / steps));
      const rate = buildProfitMetrics(store, cost, pay).profitRate;
      if(!Number.isFinite(rate)) continue;
      const score = Math.abs(rate - targetRate);
      if(score < bestScore || (Math.abs(score - bestScore) < 1e-9 && pay < bestPay)){
        bestScore = score;
        bestPay = pay;
      }
    }
    return bestPay;
  }

  function buildProfitMetrics(store, cost, finalPay){
    const fee = buildFeeSummary(store, finalPay);
    const profit = roundMoney(finalPay - fee.commission - fee.serviceFee - fee.freightSubsidy - cost);
    return {
      profit,
      profitRate: finalPay > 0 ? profit / finalPay : null
    };
  }

  function splitSuggestedDiscount(amount, basis, redThreshold){
    const total = roundMoney(Math.max(0, amount));
    const fullAmount = roundMoney(total * 0.5);
    const couponAmount = roundMoney(total * 0.3);
    const redAddAmount = roundMoney(total - fullAmount - couponAmount);
    return {
      total,
      fullThreshold: recommendThreshold(basis),
      fullAmount,
      couponThreshold: recommendThreshold(Math.max(0, basis - fullAmount)),
      couponAmount,
      redAddThreshold: redThreshold || recommendThreshold(basis),
      redAddAmount
    };
  }

  function recommendThreshold(value){
    const amount = Math.max(1, Number(value) || 0);
    return Math.max(1, Math.floor(amount / 5) * 5 || Math.floor(amount));
  }

  function renderOptimizations(rows){
    const tbody = $('#optimizationTable tbody');
    if(!rows.length){
      tbody.innerHTML = '<tr><td colspan="7" class="empty">没有找到可形成活动建议的组合，请先生成组合结果或调整利润率阶梯。</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(row => `
      <tr>
        <td><span class="tag green">${row.platformName}</span></td>
        <td>
          ${row.full.amount ? `<span class="tag">满${money(row.full.threshold)}减${money(row.full.amount)}</span>` : '<span class="tag gray">不建议满减</span>'}<br>
          ${row.coupon.amount ? `<span class="tag">券满${money(row.coupon.threshold)}减${money(row.coupon.amount)}</span>` : '<span class="tag gray">不建议优惠券</span>'}<br>
          ${row.redAddOn.amount ? `<span class="tag green">红包满${money(row.redAddOn.threshold)}加${money(row.redAddOn.amount)}</span>` : '<span class="tag gray">不建议红包加码</span>'}
        </td>
        <td>${(row.score * 100).toFixed(2)}%</td>
        <td>${row.coverage} 个组合</td>
        <td>${renderItems(row.example.items)}</td>
        <td class="money">¥${money(row.finalPay)}</td>
        <td>${rateText(row.profitRate)}</td>
      </tr>
    `).join('');
  }

  function exportResultsCsv(){
    readAllForms();
    if(!lastResults.length) runCalculation();
    const rows = lastResults.map(row => ({
      门店: currentStore().name,
      平台: row.platformName,
      商品组合: row.items.map(item => `${item.name}x${item.qty}`).join(' + '),
      用户实付: money(row.finalPay),
      成本: money(row.cost),
      活动金额: money(row.activityAmount),
      通用佣金: money(row.commission),
      外卖服务费: money(row.serviceFee),
      运费补贴: money(row.freightSubsidy),
      利润: money(row.profit),
      利润率: rateText(row.profitRate),
      商品折扣: money(row.productDiscount),
      满减: row.full.amount ? `满${money(row.full.threshold)}减${money(row.full.amount)}` : '',
      优惠券: row.coupons.map(c => `${c.name}-${money(c.amount)}`).join('|'),
      基础红包: money(row.baseRed.amount),
      红包加码: money(row.redAddOn.amount)
    }));
    downloadCsv(`${currentStore().name}_组合测算结果.csv`, rows);
  }

  function runRiskWarnings(){
    readAllForms();
    if(!lastResults.length){
      runCalculation();
      return;
    }
    lastResults = annotateRiskWarnings(lastResults);
    lastRiskWarnings = buildRiskWarnings(lastResults);
    renderResults(lastResults, Number($('#comboCount').textContent) || 0, Number($('#validComboCount').textContent) || 0, null);
    renderRiskWarnings(lastRiskWarnings);
  }

  function exportRiskCsv(){
    readAllForms();
    if(!lastRiskWarnings.length) runRiskWarnings();
    const rows = lastRiskWarnings.map(row => ({
      门店: currentStore().name,
      等级: riskLabel(row.risk),
      平台: row.platformName,
      商品组合: row.items.map(item => `${item.name}x${item.qty}`).join(' + '),
      用户实付: money(row.finalPay),
      成本: money(row.cost),
      活动金额: money(row.activityAmount),
      通用佣金: money(row.commission),
      外卖服务费: money(row.serviceFee),
      运费补贴: money(row.freightSubsidy),
      利润: money(row.profit),
      利润率: rateText(row.profitRate),
      目标阶梯: row.risk.target ? `实付${money(row.risk.target.payMin)}-${money(row.risk.target.payMax)} 利润率${money(row.risk.target.rateMin)}%-${money(row.risk.target.rateMax)}%` : '未配置',
      利润率差距: Number.isFinite(row.risk.rateGap) ? `${(row.risk.rateGap * 100).toFixed(2)}%` : '',
      触发原因: row.risk.reasons.join('|'),
      满减: row.full.amount ? `满${money(row.full.threshold)}减${money(row.full.amount)}` : '',
      优惠券: row.coupons.map(c => `${c.name}-${money(c.amount)}`).join('|'),
      基础红包: money(row.baseRed.amount),
      红包加码: money(row.redAddOn.amount)
    }));
    downloadCsv(`${currentStore().name}_风险预警.csv`, rows);
  }

  function riskLabel(risk){
    return { critical:'严重', high:'高', medium:'中', config:'配置' }[risk?.severity] || '风险';
  }

  function downloadCsv(filename, rows){
    if(!rows.length){
      alert('没有可导出的结果。');
      return;
    }
    const headers = Object.keys(rows[0]);
    const lines = [
      headers.join(','),
      ...rows.map(row => headers.map(header => csvCell(row[header])).join(','))
    ];
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function csvCell(value){
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function renderWarnings(warnings){
    const box = $('#warningBox');
    if(!warnings.length){
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    box.classList.remove('hidden');
    box.innerHTML = warnings.map(escapeHtml).join('<br>');
  }

  function parseProducts(raw){
    const text = String(raw ?? '').trim();
    if(!text) return [];
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const products = [];
    let headers = null;
    for(const line of lines){
      if(!line.trim()) continue;
      const fields = splitCsvLine(line).map(field => field.trim());
      if(!headers && /商品|名称|name/i.test(fields[0] || '')){
        headers = fields.map(normalizeHeader);
        continue;
      }
      const row = headers ? objectFromHeaders(headers, fields) : {
        name: fields[0],
        price: fields[1],
        cost: fields[2],
        meituanPrice: fields[3],
        elemePrice: fields[4],
        nonStandalone: fields[5]
      };
      const product = normalizeImportedProduct(row);
      if(product) products.push(product);
    }
    return products;
  }

  function splitCsvLine(line){
    const fields = [];
    let current = '';
    let quoted = false;
    for(let i = 0; i < line.length; i++){
      const char = line[i];
      if(char === '"'){
        if(quoted && line[i + 1] === '"'){
          current += '"';
          i++;
        }else{
          quoted = !quoted;
        }
        continue;
      }
      if((char === ',' || char === '，' || char === '\t') && !quoted){
        fields.push(current);
        current = '';
        continue;
      }
      current += char;
    }
    fields.push(current);
    return fields;
  }

  function normalizeHeader(value){
    const text = String(value ?? '').trim().toLowerCase();
    const map = {
      商品名:'name', 商品名称:'name', 名称:'name', name:'name',
      销售价:'price', 售价:'price', 原价:'price', 价格:'price', price:'price',
      成本价:'cost', 成本:'cost', cost:'cost',
      美团价:'meituanPrice', 美团价格:'meituanPrice', meituanprice:'meituanPrice',
      饿了么价:'elemePrice', 饿了么价格:'elemePrice', elemeprice:'elemePrice',
      单点不送:'nonStandalone', 不可单点:'nonStandalone', nonstandalone:'nonStandalone'
    };
    return map[text] || text;
  }

  function objectFromHeaders(headers, fields){
    return headers.reduce((row, header, index) => {
      row[header] = fields[index] ?? '';
      return row;
    }, {});
  }

  function normalizeImportedProduct(row){
    const name = String(row.name ?? '').trim();
    const price = toMoneyNumber(row.price, NaN);
    if(!name || !(price > 0)) return null;
    return {
      id: uid('p'),
      name,
      price,
      cost: Math.max(0, toMoneyNumber(row.cost, 0)),
      meituanPrice: normalizeOptionalPrice(row.meituanPrice),
      elemePrice: normalizeOptionalPrice(row.elemePrice),
      nonStandalone: parseBoolean(row.nonStandalone)
    };
  }

  function importPlatformProductsFile(file, platform, inputEl){
    if(!file) return;
    const rule = PLATFORM_PRODUCT_IMPORT_RULES[platform];
    if(!rule) return;
    if(!window.XLSX){
      alert('Excel 解析组件未加载，请刷新页面后重试。');
      if(inputEl) inputEl.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try{
        const workbook = window.XLSX.read(reader.result, { type:'array', cellDates:false });
        const parsed = parsePlatformProductWorkbook(workbook, platform);
        if(!parsed.products.length){
          alert(`没有识别到有效${rule.name}商品，请确认表格包含商品名称和价格列。`);
          return;
        }

        readAllForms();
        const report = mergePlatformProducts(parsed.products, platform);
        clearCalculatedState();
        render();
        alert(formatPlatformImportMessage(rule, report, parsed));
      }catch(error){
        alert(`导入${rule.name}商品表失败，请确认文件是平台导出的商品表。`);
        console.error(error);
      }finally{
        if(inputEl) inputEl.value = '';
      }
    };
    reader.onerror = () => {
      alert('读取文件失败，请重新选择文件。');
      if(inputEl) inputEl.value = '';
    };
    reader.readAsArrayBuffer(file);
  }

  function parsePlatformProductWorkbook(workbook, platform){
    const rule = PLATFORM_PRODUCT_IMPORT_RULES[platform];
    const sheetName = workbook.SheetNames[0];
    if(!sheetName) throw new Error('工作簿没有可读取的工作表');
    const sheet = workbook.Sheets[sheetName];
    const rows = window.XLSX.utils.sheet_to_json(sheet, { header:1, defval:'', raw:false });
    const header = findPlatformProductHeader(rows, rule);
    if(!header) throw new Error('没有找到商品名称或价格列');

    const productsByName = new Map();
    let skipped = 0;
    let duplicated = 0;
    rows.slice(header.rowIndex + 1).forEach(row => {
      const rawName = String(row[header.nameIndex] ?? '').trim();
      const price = toMoneyNumber(row[header.priceIndex], NaN);
      if(!rawName || !(price > 0)){
        if(rowHasText(row)) skipped++;
        return;
      }

      const name = normalizeImportedProductName(rawName);
      const key = normalizeProductMatchName(name);
      if(productsByName.has(key)) duplicated++;
      productsByName.set(key, { name, price });
    });

    return {
      products: Array.from(productsByName.values()),
      skipped,
      duplicated,
      sheetName,
      headerRow: header.rowIndex + 1
    };
  }

  function findPlatformProductHeader(rows, rule){
    const limit = Math.min(rows.length, 50);
    for(let rowIndex = 0; rowIndex < limit; rowIndex++){
      const row = rows[rowIndex] || [];
      const nameIndex = findImportColumnIndex(row, rule.nameHeaders);
      const priceIndex = findImportColumnIndex(row, rule.priceHeaders);
      if(nameIndex >= 0 && priceIndex >= 0) return { rowIndex, nameIndex, priceIndex };
    }
    return null;
  }

  function findImportColumnIndex(row, candidates){
    const cells = row.map(normalizeImportHeader);
    const normalizedCandidates = candidates.map(normalizeImportHeader);
    for(const candidate of normalizedCandidates){
      const exactIndex = cells.indexOf(candidate);
      if(exactIndex >= 0) return exactIndex;
    }
    for(const candidate of normalizedCandidates){
      const partialIndex = cells.findIndex(cell => (
        cell.includes(candidate) && !isExcludedImportPriceHeader(cell)
      ));
      if(partialIndex >= 0) return partialIndex;
    }
    return -1;
  }

  function normalizeImportHeader(value){
    return String(value ?? '')
      .trim()
      .replace(/\s+/g, '')
      .replace(/（/g, '(')
      .replace(/）/g, ')')
      .toLowerCase();
  }

  function isExcludedImportPriceHeader(header){
    return /餐盒|包装/.test(header);
  }

  function normalizeImportedProductName(value){
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalizeProductMatchName(value){
    return normalizeImportedProductName(value).toLowerCase();
  }

  function rowHasText(row){
    return Array.isArray(row) && row.some(cell => String(cell ?? '').trim() !== '');
  }

  function mergePlatformProducts(products, platform){
    const rule = PLATFORM_PRODUCT_IMPORT_RULES[platform];
    const store = currentStore();
    const productMap = new Map(store.products.map(product => [
      normalizeProductMatchName(product.name),
      product
    ]));
    let added = 0;
    let updated = 0;
    let unchanged = 0;

    products.forEach(item => {
      const key = normalizeProductMatchName(item.name);
      const existing = productMap.get(key);
      if(existing){
        const oldValue = normalizeOptionalPrice(existing[rule.priceField]);
        existing[rule.priceField] = item.price;
        if(oldValue === item.price) unchanged++;
        else updated++;
        return;
      }

      const product = {
        id: uid('p'),
        name: item.name,
        price: item.price,
        cost: 0,
        meituanPrice: '',
        elemePrice: '',
        nonStandalone: false
      };
      product[rule.priceField] = item.price;
      store.products.push(product);
      productMap.set(key, product);
      added++;
    });

    return { total:products.length, added, updated, unchanged };
  }

  function formatPlatformImportMessage(rule, report, parsed){
    const lines = [
      `已导入${rule.name}商品表：识别 ${report.total} 个商品，更新 ${report.updated} 个，新增 ${report.added} 个，未变化 ${report.unchanged} 个。`
    ];
    if(parsed.duplicated) lines.push(`发现 ${parsed.duplicated} 个重复商品名，已按表格最后一条价格生效。`);
    if(parsed.skipped) lines.push(`跳过 ${parsed.skipped} 行无效或无价格数据。`);
    return lines.join('\n');
  }

  function saveState(){
    readAllForms();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    alert('已保存到当前浏览器。');
  }

  function loadState(){
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw){
      alert('当前浏览器没有保存过新版配置。');
      return;
    }
    try{
      state = normalizeState(JSON.parse(raw));
      clearCalculatedState();
      render();
      alert('已读取保存配置。');
    }catch(error){
      alert('读取失败，保存数据可能已损坏。');
      console.error(error);
    }
  }

  function normalizeState(data){
    if(!data || typeof data !== 'object') return deepClone(defaultState);
    return {
      ...deepClone(defaultState),
      ...data,
      platformRules: { ...deepClone(defaultState.platformRules), ...(data.platformRules || {}) },
      stores: Array.isArray(data.stores) && data.stores.length ? data.stores : deepClone(defaultState.stores)
    };
  }

  function exportConfig(){
    readAllForms();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type:'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `外卖门店活动配置_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importConfig(file){
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try{
        state = normalizeState(JSON.parse(reader.result));
        clearCalculatedState();
        render();
        alert('配置已导入。');
      }catch(error){
        alert('导入失败，请确认是新版配置 JSON。');
        console.error(error);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function resetState(){
    if(!confirm('确定恢复示例配置吗？当前未保存的修改会丢失。')) return;
    state = deepClone(defaultState);
    lastResults = [];
    lastOptimizations = [];
    lastRiskWarnings = [];
    render();
    renderResults([], 0, 0, 0);
    renderOptimizations([]);
    renderRiskWarnings([]);
  }

  function addStore(){
    readAllForms();
    const next = deepClone(defaultState.stores[0]);
    next.id = uid('store');
    next.name = `新门店${state.stores.length + 1}`;
    next.products = [];
    state.stores.push(next);
    state.selectedStoreId = next.id;
    state.activePage = 'store';
    clearCalculatedState();
    render();
  }

  function duplicateStore(){
    readAllForms();
    const current = currentStore();
    const copy = deepClone(current);
    copy.id = uid('store');
    copy.name = `${current.name} 副本`;
    state.stores.push(copy);
    state.selectedStoreId = copy.id;
    clearCalculatedState();
    render();
  }

  function deleteStore(){
    if(state.stores.length <= 1){
      alert('至少保留一个门店。');
      return;
    }
    if(!confirm(`确定删除门店「${currentStore().name}」吗？`)) return;
    state.stores = state.stores.filter(store => store.id !== state.selectedStoreId);
    state.selectedStoreId = state.stores[0].id;
    clearCalculatedState();
    render();
  }

  function clearCalculatedState(){
    lastResults = [];
    lastOptimizations = [];
    lastRiskWarnings = [];
  }

  function bindEvents(){
    document.body.addEventListener('click', event => {
      const nav = event.target.closest('[data-page]');
      if(nav){
        readAllForms();
        state.activePage = nav.dataset.page;
        render();
        return;
      }
      const link = event.target.closest('[data-page-link]');
      if(link){
        readAllForms();
        state.activePage = link.dataset.pageLink;
        render();
        return;
      }
      const add = event.target.closest('[data-add]');
      if(add){
        addRow(add.dataset.add);
        return;
      }
      const remove = event.target.closest('[data-remove]');
      if(remove){
        removeRow(remove.dataset.remove, Number(remove.dataset.index));
        return;
      }
      const sortHeader = event.target.closest('[data-sort]');
      if(sortHeader){
        resultSort = nextSort(resultSort, sortHeader.dataset.sort);
        lastResults = sortRows(lastResults, resultSort);
        renderResults(lastResults, Number($('#comboCount').textContent) || 0, Number($('#validComboCount').textContent) || 0, null);
        return;
      }
      const optSortHeader = event.target.closest('[data-opt-sort]');
      if(optSortHeader){
        optimizationSort = nextSort(optimizationSort, optSortHeader.dataset.optSort);
        lastOptimizations = sortRows(lastOptimizations, optimizationSort);
        renderOptimizations(lastOptimizations);
      }
    });

    $('#currentStoreSelect').addEventListener('change', event => {
      readAllForms();
      state.selectedStoreId = event.target.value;
      lastResults = [];
      lastOptimizations = [];
      lastRiskWarnings = [];
      render();
      renderResults([], 0, 0, 0);
      renderOptimizations([]);
      renderRiskWarnings([]);
    });
    $('#addStoreBtn').addEventListener('click', addStore);
    $('#duplicateStoreBtn').addEventListener('click', duplicateStore);
    $('#deleteStoreBtn').addEventListener('click', deleteStore);
    $('#saveBtn').addEventListener('click', saveState);
    $('#loadBtn').addEventListener('click', loadState);
    $('#exportConfigBtn').addEventListener('click', exportConfig);
    $('#importConfigFile').addEventListener('change', e => importConfig(e.target.files[0]));
    $('#resetBtn').addEventListener('click', resetState);
    $('#resetFeeRuleBtn').addEventListener('click', () => {
      readAllForms();
      currentStore().usePlatformFee = true;
      currentStore().customFeeRule = null;
      render();
    });
    $('#addProductBtn').addEventListener('click', () => addRow('products'));
    $('#addStoreProfitTargetBtn').addEventListener('click', () => addRow('storeTargets'));
    $('#addPlatformProfitTargetBtn').addEventListener('click', () => addRow('platformTargets'));
    $('#addMeituanRedTierBtn').addEventListener('click', () => addRow('meituanBaseRed'));
    $('#addElemeRedTierBtn').addEventListener('click', () => addRow('elemeBaseRed'));
    $('#appendProductsBtn').addEventListener('click', () => applyBulkProducts('append'));
    $('#replaceProductsBtn').addEventListener('click', () => applyBulkProducts('replace'));
    $('#productCsvFile').addEventListener('change', event => importProductsFile(event.target.files[0]));
    $('#meituanProductExcelFile').addEventListener('change', event => importPlatformProductsFile(event.target.files[0], 'meituan', event.target));
    $('#elemeProductExcelFile').addEventListener('change', event => importPlatformProductsFile(event.target.files[0], 'eleme', event.target));
    $('#runResultsBtn').addEventListener('click', runCalculation);
    $('#runOptimizeBtn').addEventListener('click', runOptimization);
    $('#exportResultsBtn').addEventListener('click', exportResultsCsv);
    $('#runRiskBtn').addEventListener('click', runRiskWarnings);
    $('#exportRiskBtn').addEventListener('click', exportRiskCsv);
    $('#riskOnlyToggle').addEventListener('change', () => {
      renderResults(lastResults, Number($('#comboCount').textContent) || 0, Number($('#validComboCount').textContent) || 0, null);
    });
    $('#riskSafetyMargin').addEventListener('change', runRiskWarnings);
  }

  function nextSort(current, key){
    return current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir:'asc' };
  }

  function applyBulkProducts(mode){
    readAllForms();
    const products = parseProducts($('#productBulkText').value);
    if(!products.length){
      alert('没有识别到有效商品。');
      return;
    }
    if(mode === 'replace' && !confirm(`确定用 ${products.length} 个商品替换当前门店商品吗？`)) return;
    const store = currentStore();
    store.products = mode === 'replace' ? products : store.products.concat(products);
    $('#productBulkText').value = '';
    render();
  }

  function importProductsFile(file){
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const products = parseProducts(reader.result);
      if(!products.length){
        alert('没有识别到有效商品。');
        return;
      }
      readAllForms();
      currentStore().products = currentStore().products.concat(products);
      render();
      alert(`已导入 ${products.length} 个商品。`);
    };
    reader.readAsText(file, 'utf-8');
  }

  function init(){
    render();
    bindEvents();
  }

  init();
})();
