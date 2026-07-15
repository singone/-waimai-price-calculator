-- 外卖门店活动测算工具 PostgreSQL 数据设计
-- 目标：前端当前 IndexedDB 数据后续迁移到 PostgreSQL 时，只替换数据仓库适配层。
-- 约定：金额字段使用 numeric(12,2)，百分比字段使用百分数值，例如 4.8 表示 4.8%。

create extension if not exists pgcrypto;

create type platform_code as enum ('meituan', 'eleme');
create type discount_match_mode as enum ('all', 'keyword', 'product');
create type calculation_platform_filter as enum ('all', 'meituan', 'eleme');
create type risk_severity as enum ('none', 'config', 'medium', 'high', 'critical');
create type import_job_status as enum ('pending', 'success', 'failed');

create table app_settings (
  id uuid primary key default gen_random_uuid(),
  selected_store_id uuid,
  risk_safety_margin numeric(8,4) not null default 0 check (risk_safety_margin >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  start_price numeric(12,2) not null default 0 check (start_price >= 0),
  calculation_total_min numeric(12,2) not null default 0 check (calculation_total_min >= 0),
  calculation_total_max numeric(12,2) check (calculation_total_max is null or calculation_total_max >= calculation_total_min),
  delivery_distance_km numeric(8,2) not null default 0 check (delivery_distance_km >= 0),
  order_time time not null default '12:00',
  max_items integer not null default 4 check (max_items > 0),
  max_qty_per_sku integer not null default 2 check (max_qty_per_sku > 0),
  max_coupons integer not null default 1 check (max_coupons >= 0),
  max_discount_items integer check (max_discount_items is null or max_discount_items >= 0),
  max_checks integer not null default 250000 check (max_checks > 0),
  use_platform_fee boolean not null default true,
  use_platform_targets boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table app_settings
  add constraint app_settings_selected_store_fk
  foreign key (selected_store_id) references stores(id) on delete set null;

create table platform_fee_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null default '平台通用费用规则',
  commission_rate_percent numeric(8,4) not null default 4.8 check (commission_rate_percent >= 0),
  min_commission numeric(12,2) not null default 0.96 check (min_commission >= 0),
  base_delivery_fee numeric(12,2) not null default 2.70 check (base_delivery_fee >= 0),
  extra_delivery_fee_per_0_1km numeric(12,2) not null default 0.05 check (extra_delivery_fee_per_0_1km >= 0),
  mid_price_fee_per_yuan numeric(12,2) not null default 0.13 check (mid_price_fee_per_yuan >= 0),
  high_price_fee_per_yuan numeric(12,2) not null default 0.15 check (high_price_fee_per_yuan >= 0),
  freight_subsidy_within_3km numeric(12,2) not null default 2.70 check (freight_subsidy_within_3km >= 0),
  freight_subsidy_within_5km numeric(12,2) not null default 4.00 check (freight_subsidy_within_5km >= 0),
  freight_subsidy_above_5km numeric(12,2) not null default 5.00 check (freight_subsidy_above_5km >= 0),
  pricing_normal_target_rate_percent numeric(8,4) not null default 25 check (pricing_normal_target_rate_percent >= 0),
  pricing_add_on_target_rate_percent numeric(8,4) not null default 45 check (pricing_add_on_target_rate_percent >= 0),
  pricing_rice_ball_target_rate_percent numeric(8,4) not null default 32 check (pricing_rice_ball_target_rate_percent >= 0),
  pricing_set_meal_target_rate_percent numeric(8,4) not null default 36 check (pricing_set_meal_target_rate_percent >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table store_fee_overrides (
  store_id uuid primary key references stores(id) on delete cascade,
  commission_rate_percent numeric(8,4) check (commission_rate_percent is null or commission_rate_percent >= 0),
  min_commission numeric(12,2) check (min_commission is null or min_commission >= 0),
  base_delivery_fee numeric(12,2) check (base_delivery_fee is null or base_delivery_fee >= 0),
  extra_delivery_fee_per_0_1km numeric(12,2) check (extra_delivery_fee_per_0_1km is null or extra_delivery_fee_per_0_1km >= 0),
  mid_price_fee_per_yuan numeric(12,2) check (mid_price_fee_per_yuan is null or mid_price_fee_per_yuan >= 0),
  high_price_fee_per_yuan numeric(12,2) check (high_price_fee_per_yuan is null or high_price_fee_per_yuan >= 0),
  freight_subsidy_within_3km numeric(12,2) check (freight_subsidy_within_3km is null or freight_subsidy_within_3km >= 0),
  freight_subsidy_within_5km numeric(12,2) check (freight_subsidy_within_5km is null or freight_subsidy_within_5km >= 0),
  freight_subsidy_above_5km numeric(12,2) check (freight_subsidy_above_5km is null or freight_subsidy_above_5km >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table platform_profit_target_tiers (
  id uuid primary key default gen_random_uuid(),
  enabled boolean not null default true,
  pay_min numeric(12,2) not null check (pay_min >= 0),
  pay_max numeric(12,2) not null check (pay_max > pay_min),
  rate_min_percent numeric(8,4) not null,
  rate_max_percent numeric(8,4) not null check (rate_max_percent > rate_min_percent),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table store_profit_target_tiers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  enabled boolean not null default true,
  pay_min numeric(12,2) not null check (pay_min >= 0),
  pay_max numeric(12,2) not null check (pay_max > pay_min),
  rate_min_percent numeric(8,4) not null,
  rate_max_percent numeric(8,4) not null check (rate_max_percent > rate_min_percent),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table platform_red_packet_tiers (
  id uuid primary key default gen_random_uuid(),
  platform platform_code not null,
  enabled boolean not null default true,
  threshold_amount numeric(12,2) not null check (threshold_amount >= 0),
  min_amount numeric(12,2) not null check (min_amount >= 0),
  max_amount numeric(12,2) not null check (max_amount >= min_amount),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table store_products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  sale_price numeric(12,2) not null default 0 check (sale_price >= 0),
  cost_price numeric(12,2) not null default 0 check (cost_price >= 0),
  package_fee numeric(12,2) not null default 0 check (package_fee >= 0),
  non_standalone boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, name)
);

create table store_product_platforms (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references store_products(id) on delete cascade,
  platform platform_code not null,
  price_override numeric(12,2) check (price_override is null or price_override >= 0),
  package_fee_override numeric(12,2) check (package_fee_override is null or package_fee_override >= 0),
  is_listed boolean not null default true,
  external_product_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, platform)
);

create table store_product_import_aliases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references store_products(id) on delete cascade,
  platform platform_code,
  alias_name text not null check (length(trim(alias_name)) > 0),
  created_at timestamptz not null default now(),
  unique (product_id, platform, alias_name)
);

create table store_full_reduction_activities (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  platform platform_code not null,
  enabled boolean not null default true,
  threshold_amount numeric(12,2) not null check (threshold_amount >= 0),
  reduction_amount numeric(12,2) not null check (reduction_amount >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table store_order_coupons (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  platform platform_code not null,
  enabled boolean not null default true,
  name text not null default '订单优惠券',
  threshold_amount numeric(12,2) not null check (threshold_amount >= 0),
  coupon_amount numeric(12,2) not null check (coupon_amount >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table store_red_packet_add_ons (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  platform platform_code not null,
  enabled boolean not null default true,
  threshold_amount numeric(12,2) not null check (threshold_amount >= 0),
  add_on_amount numeric(12,2) not null check (add_on_amount >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table store_product_discount_activities (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  platform platform_code not null,
  enabled boolean not null default true,
  name text not null default '商品折扣',
  match_mode discount_match_mode not null default 'keyword',
  product_keywords text not null default '',
  discount_rate numeric(8,4) not null check (discount_rate >= 0),
  item_limit integer check (item_limit is null or item_limit >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table store_product_discount_activity_products (
  activity_id uuid not null references store_product_discount_activities(id) on delete cascade,
  product_id uuid not null references store_products(id) on delete cascade,
  primary key (activity_id, product_id)
);

create table import_jobs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete set null,
  platform platform_code,
  import_type text not null check (import_type in ('product', 'cost', 'config')),
  file_name text not null,
  status import_job_status not null default 'pending',
  row_count integer not null default 0 check (row_count >= 0),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table calculation_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  platform_filter calculation_platform_filter not null default 'all',
  risk_safety_margin numeric(8,4) not null default 0 check (risk_safety_margin >= 0),
  combo_count integer not null default 0 check (combo_count >= 0),
  valid_combo_count integer not null default 0 check (valid_combo_count >= 0),
  result_count integer not null default 0 check (result_count >= 0),
  elapsed_ms integer check (elapsed_ms is null or elapsed_ms >= 0),
  config_snapshot jsonb not null,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table calculation_result_rows (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references calculation_runs(id) on delete cascade,
  platform platform_code not null,
  final_pay numeric(12,2) not null check (final_pay >= 0),
  original_total numeric(12,2) not null check (original_total >= 0),
  after_product_discount numeric(12,2) not null check (after_product_discount >= 0),
  cost_amount numeric(12,2) not null check (cost_amount >= 0),
  activity_amount numeric(12,2) not null check (activity_amount >= 0),
  product_discount_amount numeric(12,2) not null check (product_discount_amount >= 0),
  full_reduction_amount numeric(12,2) not null check (full_reduction_amount >= 0),
  coupon_amount numeric(12,2) not null check (coupon_amount >= 0),
  base_red_packet_amount numeric(12,2) not null check (base_red_packet_amount >= 0),
  red_packet_add_on_amount numeric(12,2) not null check (red_packet_add_on_amount >= 0),
  commission_amount numeric(12,2) not null check (commission_amount >= 0),
  service_fee_amount numeric(12,2) not null check (service_fee_amount >= 0),
  freight_subsidy_amount numeric(12,2) not null check (freight_subsidy_amount >= 0),
  profit_amount numeric(12,2) not null,
  profit_rate numeric(12,6),
  risk_severity risk_severity not null default 'none',
  risk_reasons jsonb not null default '[]'::jsonb,
  target_snapshot jsonb,
  discount_snapshot jsonb not null default '{}'::jsonb,
  sort_key numeric(12,2) generated always as (final_pay) stored,
  created_at timestamptz not null default now()
);

create table calculation_result_items (
  id uuid primary key default gen_random_uuid(),
  result_row_id uuid not null references calculation_result_rows(id) on delete cascade,
  product_id uuid references store_products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  non_standalone boolean not null default false,
  sort_order integer not null default 0
);

create table cost_price_adjustment_records (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  product_id uuid references store_products(id) on delete set null,
  platform platform_code not null,
  product_name text not null,
  sales_price numeric(12,2) not null check (sales_price >= 0),
  old_platform_price numeric(12,2) not null check (old_platform_price >= 0),
  suggested_platform_price numeric(12,2) check (suggested_platform_price >= 0),
  new_platform_price numeric(12,2) not null check (new_platform_price >= 0),
  increase_amount numeric(12,2) not null,
  increase_rate numeric(12,6),
  target_profit_rate numeric(12,6) not null default 0,
  min_profit_rate numeric(12,6),
  avg_profit_rate numeric(12,6),
  combo_count integer not null default 0 check (combo_count >= 0),
  source text not null default 'cost_analysis',
  created_at timestamptz not null default now()
);

create index idx_stores_active on stores (is_active, name);
create index idx_store_products_store on store_products (store_id, name);
create index idx_store_product_platforms_platform on store_product_platforms (platform, is_listed);
create index idx_full_reductions_store_platform on store_full_reduction_activities (store_id, platform, enabled, threshold_amount);
create index idx_order_coupons_store_platform on store_order_coupons (store_id, platform, enabled, threshold_amount);
create index idx_red_add_ons_store_platform on store_red_packet_add_ons (store_id, platform, enabled, threshold_amount);
create index idx_discount_activities_store_platform on store_product_discount_activities (store_id, platform, enabled);
create index idx_profit_targets_platform_sort on platform_profit_target_tiers (enabled, sort_order, pay_min);
create index idx_profit_targets_store_sort on store_profit_target_tiers (store_id, enabled, sort_order, pay_min);
create index idx_red_packet_tiers_platform_sort on platform_red_packet_tiers (platform, enabled, sort_order, threshold_amount);
create index idx_calculation_runs_store_created on calculation_runs (store_id, created_at desc);
create index idx_calculation_result_rows_run_pay on calculation_result_rows (run_id, platform, final_pay);
create index idx_calculation_result_rows_run_risk on calculation_result_rows (run_id, risk_severity);
create index idx_cost_price_adjustments_store_created on cost_price_adjustment_records (store_id, created_at desc);
create index idx_cost_price_adjustments_product_platform on cost_price_adjustment_records (product_id, platform, created_at desc);

comment on table stores is '门店基础配置，商品、活动、利润阶梯均以门店为归属边界。';
comment on table platform_fee_rules is '平台通用费用规则；门店默认继承，可通过 store_fee_overrides 覆盖。';
comment on table platform_red_packet_tiers is '美团神券、饿了么爆红包基础阶梯，门店不可覆盖基础规则。';
comment on table store_products is '门店独立商品主表，不跨门店共享。';
comment on table store_product_platforms is '商品在不同平台的价格覆盖和上下架状态。';
comment on table store_full_reduction_activities is '门店承担的满减活动。';
comment on table store_order_coupons is '门店承担的订单级优惠券，暂不包含商品券。';
comment on table store_red_packet_add_ons is '门店在平台基础神券/爆红包上的加码金额。';
comment on table store_product_discount_activities is '商品折扣活动，支持整单折扣商品上限和活动自身件数上限。';
comment on table calculation_runs is '一次测算的配置快照和汇总指标。';
comment on table calculation_result_rows is '测算结果组合明细，用于排序、预警和 CSV 导出。';
comment on table cost_price_adjustment_records is '成本测算页应用建议调价后的流水，用于对比调前价、建议价、调后价和加价比例。';
