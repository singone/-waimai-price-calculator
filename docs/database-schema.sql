-- 外卖门店活动测算工具 PostgreSQL 数据设计
-- 目标：前端当前 IndexedDB 数据后续迁移到 PostgreSQL 时，只替换数据仓库适配层。
-- 约定：金额字段使用 numeric(12,2)，百分比字段使用百分数值，例如 4.8 表示 4.8%。

create extension if not exists pgcrypto;

create type platform_code as enum ('meituan', 'eleme');
create type discount_match_mode as enum ('all', 'keyword', 'product');
create type calculation_platform_filter as enum ('all', 'meituan', 'eleme');
create type risk_severity as enum ('none', 'config', 'medium', 'high', 'critical');
create type import_job_status as enum ('pending', 'success', 'failed');
create type product_category as enum ('staple', 'snack_drink', 'add_on', 'set_meal', 'other');
create type staple_scenario as enum ('single', 'double', 'multi');
create type activity_task_type as enum ('combo_cache_build', 'price_scan_build', 'activity_route_design', 'activity_route_validate');
create type activity_task_status as enum ('pending', 'running', 'success', 'failed', 'cancelled');
create type activity_weight_reason_type as enum ('low_frequency', 'high_frequency', 'strategy_combo', 'cost_anomaly', 'temporary_ignore', 'other');
create type activity_coupon_design_basis as enum ('original', 'pay');
create type activity_design_mode as enum ('auto', 'full', 'coupon', 'stacked');
create type activity_coupon_user_scenario as enum ('low_price_order_growth', 'raise_order_value', 'high_price_retention', 'multi_person_conversion', 'order_volume_growth');
create type activity_coupon_channel as enum ('in_store', 'order_return', 'review_return', 'points_return', 'targeted');
create type activity_coupon_target_user as enum ('all', 'new_customer', 'high_frequency', 'high_aov', 'lost_customer', 'specified');
create type activity_coupon_threshold_mode as enum ('low_threshold_order', 'full_reduction_interleave', 'add_on_critical', 'high_margin_guide', 'retention_recall');

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
  staple_count_min integer not null default 0 check (staple_count_min >= 0),
  staple_count_max integer check (staple_count_max is null or staple_count_max >= staple_count_min),
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
  pricing_single_staple_target_rate_percent numeric(8,4) not null default 32 check (pricing_single_staple_target_rate_percent >= 0),
  pricing_double_staple_target_rate_percent numeric(8,4) not null default 36 check (pricing_double_staple_target_rate_percent >= 0),
  pricing_multi_staple_target_rate_percent numeric(8,4) not null default 38 check (pricing_multi_staple_target_rate_percent >= 0),
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

create table platform_pricing_strategy_tiers (
  id uuid primary key default gen_random_uuid(),
  scenario staple_scenario not null,
  enabled boolean not null default true,
  pay_min numeric(12,2) not null check (pay_min >= 0),
  pay_max numeric(12,2) not null check (pay_max > pay_min),
  pay_rate_min_percent numeric(8,4) not null default 0 check (pay_rate_min_percent >= 0),
  pay_rate_target_percent numeric(8,4) not null default 0 check (pay_rate_target_percent >= pay_rate_min_percent),
  net_rate_min_percent numeric(8,4) not null default 0 check (net_rate_min_percent >= 0),
  net_rate_target_percent numeric(8,4) not null default 0 check (net_rate_target_percent >= net_rate_min_percent),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table activity_strategy_settings (
  id uuid primary key default gen_random_uuid(),
  name text not null default '系统活动策略' check (length(trim(name)) > 0),
  objective_templates jsonb not null default '[]'::jsonb,
  objective_strategies jsonb not null default '{}'::jsonb,
  platform_coupon_scene_keys jsonb not null default '{"meituan": [], "eleme": []}'::jsonb,
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table activity_coupon_scene_templates (
  id uuid primary key default gen_random_uuid(),
  strategy_setting_id uuid not null references activity_strategy_settings(id) on delete cascade,
  key text not null check (length(trim(key)) > 0),
  enabled boolean not null default true,
  name text not null check (length(trim(name)) > 0),
  platforms platform_code[],
  channel activity_coupon_channel not null default 'order_return',
  target_user activity_coupon_target_user not null default 'all',
  objective text not null check (length(trim(objective)) > 0),
  threshold_mode activity_coupon_threshold_mode not null default 'low_threshold_order',
  pay_min numeric(12,2) not null default 0 check (pay_min >= 0),
  pay_max numeric(12,2) not null default 25 check (pay_max > pay_min),
  threshold_min numeric(12,2) not null default 10 check (threshold_min >= 0),
  threshold_max numeric(12,2) not null default 45 check (threshold_max > threshold_min),
  threshold_step integer not null default 5 check (threshold_step > 0),
  threshold_window integer not null default 5 check (threshold_window > 0),
  add_on_min numeric(12,2) not null default 0 check (add_on_min >= 0),
  add_on_max numeric(12,2) not null default 5 check (add_on_max >= add_on_min),
  full_reduction_offset_min numeric(12,2) not null default -3,
  full_reduction_offset_max numeric(12,2) not null default 8 check (full_reduction_offset_max >= full_reduction_offset_min),
  coupon_budget_share numeric(8,4) not null default 50 check (coupon_budget_share >= 0 and coupon_budget_share <= 100),
  max_coupon_count integer not null default 3 check (max_coupon_count >= 0),
  max_coupon_amount numeric(12,2) not null default 20 check (max_coupon_amount >= 0),
  min_pay_profit_rate numeric(8,4) not null default 0,
  min_net_profit_rate numeric(8,4) not null default -20,
  max_loss_share numeric(8,4) not null default 20 check (max_loss_share >= 0 and max_loss_share <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (strategy_setting_id, key)
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

create table store_activity_design_settings (
  store_id uuid primary key references stores(id) on delete cascade,
  staple_max_count integer not null default 2 check (staple_max_count > 0),
  add_on_max_count integer check (add_on_max_count is null or add_on_max_count >= 0),
  target_profit_rate_percent numeric(8,4) not null default 25 check (target_profit_rate_percent >= 0),
  min_profit_rate_percent numeric(8,4) not null default 0 check (min_profit_rate_percent >= 0),
  coupon_profit_drop_points numeric(8,4) not null default 3 check (coupon_profit_drop_points >= 0),
  red_add_on_space numeric(12,2) not null default 0 check (red_add_on_space >= 0),
  coupon_design_basis activity_coupon_design_basis not null default 'original',
  coupon_design_threshold_step integer not null default 5 check (coupon_design_threshold_step > 0),
  coupon_design_amount_step numeric(12,2) not null default 1 check (coupon_design_amount_step > 0),
  coupon_design_max_full_amount numeric(12,2) check (coupon_design_max_full_amount is null or coupon_design_max_full_amount >= 0),
  coupon_design_max_coupon_amount numeric(12,2) check (coupon_design_max_coupon_amount is null or coupon_design_max_coupon_amount >= 0),
  design_mode activity_design_mode not null default 'auto',
  objective text not null default 'longTerm',
  objective_templates jsonb not null default '[]'::jsonb,
  objective_pay_targets jsonb not null default '{
    "longTerm": { "payMin": 0, "payMax": 25 },
    "orderGrowth": { "payMin": 0, "payMax": 20 },
    "raiseAov": { "payMin": 15, "payMax": 25 },
    "hotProduct": { "payMin": 0, "payMax": 18 },
    "highMarginConversion": { "payMin": 10, "payMax": 25 },
    "profitRecovery": { "payMin": 15, "payMax": 30 }
  }'::jsonb,
  objective_strategies jsonb not null default '{}'::jsonb,
  use_platform_coupon_scenes boolean not null default true,
  enabled_coupon_scene_keys jsonb not null default '[]'::jsonb,
  coupon_scene_templates jsonb not null default '[]'::jsonb,
  original_band_size integer not null default 5 check (original_band_size > 0),
  pay_band_size integer not null default 5 check (pay_band_size > 0),
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
  category product_category not null default 'other',
  staple_serving_count integer not null default 0 check (staple_serving_count >= 0),
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
  category product_category not null default 'other',
  staple_serving_count integer not null default 0 check (staple_serving_count >= 0),
  non_standalone boolean not null default false,
  sort_order integer not null default 0
);

create table activity_combo_cache (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  platform platform_code not null,
  product_version text not null,
  combo_config_key text not null,
  combo_key text not null,
  items_snapshot jsonb not null,
  original_total numeric(12,2) not null check (original_total >= 0),
  cost_amount numeric(12,2) not null check (cost_amount >= 0),
  base_net_pay numeric(12,2) not null default 0 check (base_net_pay >= 0),
  base_profit_amount numeric(12,2) not null,
  base_profit_rate numeric(12,6),
  staple_count integer not null default 0 check (staple_count >= 0),
  add_on_count integer not null default 0 check (add_on_count >= 0),
  scenario staple_scenario not null,
  is_valid boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, platform, product_version, combo_config_key, combo_key)
);

create table activity_price_scan_snapshots (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  platform platform_code not null,
  product_version text not null,
  combo_config_key text not null,
  settings_snapshot jsonb not null,
  status activity_task_status not null default 'pending',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table activity_price_bucket_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references activity_price_scan_snapshots(id) on delete cascade,
  platform platform_code not null,
  price_bucket integer not null check (price_bucket >= 0),
  combo_count integer not null default 0 check (combo_count >= 0),
  weighted_combo_count numeric(14,4) not null default 0 check (weighted_combo_count >= 0),
  avg_cost numeric(12,2) not null default 0,
  weighted_avg_cost numeric(12,2) not null default 0,
  avg_profit numeric(12,2) not null default 0,
  weighted_avg_profit numeric(12,2) not null default 0,
  weighted_profit_rate numeric(12,6),
  min_profit_rate numeric(12,6),
  max_profit_rate numeric(12,6),
  profit_rate_spread numeric(12,6),
  outlier_count integer not null default 0 check (outlier_count >= 0),
  risk_count integer not null default 0 check (risk_count >= 0),
  metrics_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (snapshot_id, platform, price_bucket)
);

create table activity_combo_weight_overrides (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references activity_price_scan_snapshots(id) on delete cascade,
  combo_key text not null,
  price_bucket integer not null check (price_bucket >= 0),
  weight numeric(8,4) not null default 1 check (weight >= 0),
  reason_type activity_weight_reason_type not null default 'other',
  reason text not null default '',
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (snapshot_id, combo_key)
);

create table activity_combo_weight_logs (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references activity_price_scan_snapshots(id) on delete cascade,
  combo_key text not null,
  price_bucket integer not null check (price_bucket >= 0),
  old_weight numeric(8,4) not null check (old_weight >= 0),
  new_weight numeric(8,4) not null check (new_weight >= 0),
  reason_type activity_weight_reason_type not null default 'other',
  reason text not null default '',
  impact_snapshot jsonb not null default '{}'::jsonb,
  operator_name text,
  created_at timestamptz not null default now()
);

create table activity_full_routes (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references activity_price_scan_snapshots(id) on delete cascade,
  platform platform_code not null,
  route_key text not null,
  objective text not null,
  rules jsonb not null,
  score numeric(12,4) not null default 0,
  diagnosis text not null default '',
  metrics_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (snapshot_id, platform, route_key)
);

create table activity_coupon_routes (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references activity_price_scan_snapshots(id) on delete cascade,
  platform platform_code not null,
  route_key text not null,
  user_scenario activity_coupon_user_scenario not null,
  rules jsonb not null,
  score numeric(12,4) not null default 0,
  diagnosis text not null default '',
  metrics_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (snapshot_id, platform, route_key)
);

create table activity_routes (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references activity_price_scan_snapshots(id) on delete cascade,
  platform platform_code not null,
  route_key text not null,
  full_route_id uuid references activity_full_routes(id) on delete set null,
  coupon_route_ids uuid[] not null default '{}',
  red_add_on_rules jsonb not null default '[]'::jsonb,
  rules_snapshot jsonb not null,
  created_by text,
  created_at timestamptz not null default now(),
  unique (snapshot_id, platform, route_key)
);

create table activity_calc_results (
  id uuid primary key default gen_random_uuid(),
  activity_route_id uuid not null references activity_routes(id) on delete cascade,
  combo_key text not null,
  platform platform_code not null,
  original_total numeric(12,2) not null check (original_total >= 0),
  final_pay numeric(12,2) not null check (final_pay >= 0),
  net_pay numeric(12,2) not null check (net_pay >= 0),
  cost_amount numeric(12,2) not null check (cost_amount >= 0),
  activity_amount numeric(12,2) not null default 0 check (activity_amount >= 0),
  profit_amount numeric(12,2) not null,
  profit_rate numeric(12,6),
  profit_space numeric(12,2) not null default 0,
  pay_bucket integer not null check (pay_bucket >= 0),
  risk_flags jsonb not null default '[]'::jsonb,
  discount_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (activity_route_id, combo_key)
);

create table activity_pay_bucket_summaries (
  id uuid primary key default gen_random_uuid(),
  activity_route_id uuid not null references activity_routes(id) on delete cascade,
  platform platform_code not null,
  pay_bucket integer not null check (pay_bucket >= 0),
  combo_count integer not null default 0 check (combo_count >= 0),
  avg_final_pay numeric(12,2) not null default 0,
  avg_net_pay numeric(12,2) not null default 0,
  avg_profit numeric(12,2) not null default 0,
  avg_profit_rate numeric(12,6),
  min_profit numeric(12,2),
  max_profit numeric(12,2),
  risk_count integer not null default 0 check (risk_count >= 0),
  outlier_count integer not null default 0 check (outlier_count >= 0),
  metrics_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (activity_route_id, platform, pay_bucket)
);

create table activity_task_statuses (
  id uuid primary key default gen_random_uuid(),
  task_type activity_task_type not null,
  store_id uuid not null references stores(id) on delete cascade,
  status activity_task_status not null default 'pending',
  progress numeric(8,4) not null default 0 check (progress >= 0 and progress <= 100),
  processed_count integer not null default 0 check (processed_count >= 0),
  total_count integer not null default 0 check (total_count >= 0),
  result_snapshot jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
create index idx_activity_strategy_settings_default on activity_strategy_settings (is_default, updated_at desc);
create index idx_activity_coupon_scene_templates_strategy on activity_coupon_scene_templates (strategy_setting_id, enabled, objective);
create index idx_red_packet_tiers_platform_sort on platform_red_packet_tiers (platform, enabled, sort_order, threshold_amount);
create index idx_calculation_runs_store_created on calculation_runs (store_id, created_at desc);
create index idx_calculation_result_rows_run_pay on calculation_result_rows (run_id, platform, final_pay);
create index idx_calculation_result_rows_run_risk on calculation_result_rows (run_id, risk_severity);
create index idx_activity_combo_cache_scope on activity_combo_cache (store_id, platform, product_version, combo_config_key);
create index idx_activity_combo_cache_original on activity_combo_cache (store_id, platform, product_version, combo_config_key, original_total);
create index idx_activity_price_scan_store_created on activity_price_scan_snapshots (store_id, platform, created_at desc);
create index idx_activity_price_bucket_snapshot on activity_price_bucket_snapshots (snapshot_id, platform, price_bucket);
create index idx_activity_weight_overrides_snapshot on activity_combo_weight_overrides (snapshot_id, price_bucket);
create index idx_activity_weight_logs_snapshot_created on activity_combo_weight_logs (snapshot_id, created_at desc);
create index idx_activity_full_routes_snapshot_score on activity_full_routes (snapshot_id, platform, score);
create index idx_activity_coupon_routes_snapshot_score on activity_coupon_routes (snapshot_id, platform, user_scenario, score);
create index idx_activity_routes_snapshot_created on activity_routes (snapshot_id, platform, created_at desc);
create index idx_activity_calc_results_route_pay on activity_calc_results (activity_route_id, platform, pay_bucket);
create index idx_activity_calc_results_route_profit on activity_calc_results (activity_route_id, profit_rate);
create index idx_activity_pay_bucket_route on activity_pay_bucket_summaries (activity_route_id, platform, pay_bucket);
create index idx_activity_task_statuses_store_status on activity_task_statuses (store_id, task_type, status, updated_at desc);

comment on table stores is '门店基础配置，商品、活动、利润阶梯均以门店为归属边界。';
comment on table platform_fee_rules is '平台通用费用规则；门店默认继承，可通过 store_fee_overrides 覆盖。';
comment on table platform_red_packet_tiers is '美团神券、饿了么爆红包基础阶梯，门店不可覆盖基础规则。';
comment on table activity_strategy_settings is '系统活动策略主配置，保存可新增经营目标模板、经营目标策略和平台默认启用券场景。';
comment on table activity_coupon_scene_templates is '系统券场景模板，绑定经营目标 key，用于下单送、评价送、店内领券、集点返券和定向唤回等场景。';
comment on table store_products is '门店独立商品主表，不跨门店共享。';
comment on table store_product_platforms is '商品在不同平台的价格覆盖和上下架状态。';
comment on table store_full_reduction_activities is '门店承担的满减活动。';
comment on table store_order_coupons is '门店承担的订单级优惠券，暂不包含商品券。';
comment on table store_red_packet_add_ons is '门店在平台基础神券/爆红包上的加码金额。';
comment on table store_activity_design_settings is '门店级活动设计默认参数，活动设计读取这里的组合边界、经营目标覆盖、最低到手价、边界口径、券合并策略、加码空间和区间粒度；支付价核验再展示成本和利润风险。';
comment on table store_product_discount_activities is '商品折扣活动，支持整单折扣商品上限和活动自身件数上限。';
comment on table calculation_runs is '一次测算的配置快照和汇总指标。';
comment on table calculation_result_rows is '测算结果组合明细，用于排序、预警和 CSV 导出。';
comment on table activity_combo_cache is '活动设计商品组合基础缓存，只保存商品组合原价、成本、基础利润等不随活动路线变化的数据。';
comment on table activity_price_scan_snapshots is '原价整数扫描快照，作为后续满减路线和优惠券路线设计的固定输入。';
comment on table activity_price_bucket_snapshots is '原价整数桶聚合结果，支持价格利润曲线和门槛窗口分析。';
comment on table activity_combo_weight_overrides is '原价扫描快照下的组合人工权重覆盖，用于修正低频、常购或策略组合对均值的影响。';
comment on table activity_combo_weight_logs is '组合权重调整日志，用于解释价格桶均值变化和活动路线生成依据。';
comment on table activity_full_routes is '满减活动候选路线，只包含全门店公开满减阶梯。';
comment on table activity_coupon_routes is '优惠券候选路线，按用户场景设计，不同用户可命中不同券。';
comment on table activity_routes is '完整活动路线，由满减路线、优惠券路线和神券/爆红包加码规则组合保存。';
comment on table activity_calc_results is '完整活动路线下的组合支付价核验结果。';
comment on table activity_pay_bucket_summaries is '支付价整数桶聚合结果，用于支付价维度分析和明细分页入口。';
comment on table activity_task_statuses is '活动设计相关异步任务状态，用于前端 Worker 或后端任务统一落库。';
