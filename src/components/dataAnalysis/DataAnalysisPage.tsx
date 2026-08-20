// @ts-nocheck
'use client';

import dynamic from 'next/dynamic';
import React from 'react';
import { App as AntApp, Button, Card, Col, DatePicker, Row, Select, Space, Table, Tag, Tooltip, Typography, Upload } from 'antd';
import type { TableColumnsType } from 'antd';
import { DeleteOutlined, DownloadOutlined, EditOutlined, PlusOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { PLATFORMS, PLATFORM_NAMES } from '../../domain/core';
import { downloadCsv } from '../../utils/csv';
import { uploadProps } from '../../utils/upload';
import { BusinessNoteEditorModal } from '../modals/BusinessNoteEditorModal';
import type { Platform } from '../../domain/types';
import {
  aggregateBusinessRecordsByDate,
  aggregateBusinessRecordsByPlatform,
  aggregateBusinessRecordsByWeekday,
  BUSINESS_NOTE_LIMIT,
  businessAddDays,
  businessCustomerFunnelChartRows,
  businessDateRangeText,
  businessDateToDayjs,
  businessDateSpanDays,
  businessDiagnosticColor,
  businessDiagnosticSeverityText,
  businessFunnelChartRows,
  businessFunnelMetrics,
  businessFunnelStageText,
  businessImportedAtText,
  businessMonthEnd,
  businessMonthStart,
  businessNoteContainsDate,
  businessNoteItemsText,
  businessNoteMatchesPlatformFilter,
  businessNoteMatchesRecord,
  businessNoteOverlapsDateRange,
  businessPrimaryRepeatRate,
  businessRepeatSummaryText,
  businessReportExportRows,
  businessWeekLabel,
  businessWeekStart,
  diagnoseBusinessRecords,
  importBusinessReportFileToState,
  loadBusinessDataState,
  money,
  normalizeBusinessData,
  normalizeBusinessDate,
  normalizeBusinessDateRange,
  rateText,
  roundMoney,
  saveBusinessDataState,
  summarizeBusinessRecords,
  type BusinessAnalysisNote,
  type BusinessDailyAggregate,
  type BusinessDailyRecord,
  type BusinessDataImportBatch,
  type BusinessDataState,
  type BusinessDataSummary,
  type BusinessDiagnosticItem,
  type BusinessFunnelChartRow,
  type BusinessNoteEditorState,
  type BusinessPlatformAggregate
} from './dataAnalysisPageData';

const AntvLine = dynamic(() => import('@ant-design/charts').then(mod => mod.Line), { ssr: false });
const AntvColumn = dynamic(() => import('@ant-design/charts').then(mod => mod.Column), { ssr: false });
const AntvFunnel = dynamic(() => import('@ant-design/charts').then(mod => mod.Funnel), { ssr: false });
const { RangePicker } = DatePicker;
const { Text } = Typography;

const BUSINESS_WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const BUSINESS_WEEK_TOTAL_LABEL = '周总计';
const BUSINESS_WEEKLY_TREND_MIN_DAYS = 30;
const BUSINESS_WEEKDAY_CHART_COLORS = [
  '#496f5d',
  '#d95b18',
  '#5b7c99',
  '#8f6f4e',
  '#6d6aa8',
  '#b85f32',
  '#7b8c42',
  '#2f5d62'
];
const BUSINESS_LINE_CHART_COLORS = [
  '#d95b18',
  '#6d6aa8',
  '#496f5d',
  '#b85f32',
  '#5b7c99',
  '#8f6f4e'
];

type AnyRecord = Record<string, any>;

export type DataAnalysisPageProps = AnyRecord;

export function DataAnalysisPage(pageProps: DataAnalysisPageProps = {}) {
  const { message, modal } = AntApp.useApp();
  const props = pageProps;
  const {
    storeId,
    storeName
  } = props;

    const [businessData, setBusinessData] = React.useState<BusinessDataState>(() => normalizeBusinessData(undefined));
    const [businessNoteEditor, setBusinessNoteEditor] = React.useState<BusinessNoteEditorState | null>(null);
    React.useEffect(() => {
      let cancelled = false;
      loadBusinessDataState().then(nextState => {
        if (!cancelled) setBusinessData(nextState);
      });
      return () => {
        cancelled = true;
      };
    }, []);
    const persistBusinessData = React.useCallback(async (nextState: BusinessDataState, successMessage?: string) => {
      setBusinessData(nextState);
      try {
        await saveBusinessDataState(nextState);
        if (successMessage) message.success(successMessage);
      } catch {
        message.error('保存经营分析数据失败，当前浏览器数据库不可用。');
      }
    }, [message]);
    const importBusinessReport = React.useCallback(async (file: File) => {
      try {
        const result = await importBusinessReportFileToState({
          file,
          currentState: businessData,
          storeId,
          storeName
        });
        await persistBusinessData(
          result.state,
          `已导入${result.platformName}经营日报：${result.importedCount} 天，覆盖 ${result.replacedDates.length} 天。`
        );
        if (result.warnings.length) message.warning(result.warnings.slice(0, 2).join('；'));
      } catch (error) {
        message.error(error instanceof Error ? error.message : '导入经营日报失败，请确认文件格式。');
      }
    }, [businessData, message, persistBusinessData, storeId, storeName]);
    const businessRecords = businessData.records;
    const businessImports = businessData.imports;
    const businessAnalysisNotes = businessData.notes;
    const exportBusinessAnalysis = React.useCallback((records: BusinessDailyRecord[], notes: BusinessAnalysisNote[], dateStart: string, dateEnd: string) => {
      const ok = downloadCsv(
        `${storeName}_经营数据_${businessDateRangeText(dateStart, dateEnd)}.csv`,
        businessReportExportRows(records, notes)
      );
      if (!ok) message.warning('当前筛选范围没有可导出的经营数据。');
    }, [message, storeName]);
    const openBusinessMemoNoteEditor = React.useCallback((note: BusinessAnalysisNote) => {
      setBusinessNoteEditor({
        id: note.id,
        dateStart: note.dateStart,
        dateEnd: note.dateEnd,
        platform: note.platform,
        title: note.title,
        content: businessNoteItemsText(note)
      });
    }, []);
    const openBusinessMemoNoteEditorWithContext = React.useCallback((context: BusinessNoteEditorState) => {
      const range = normalizeBusinessDateRange(context.dateStart, context.dateEnd);
      if (!range.dateStart || !range.dateEnd) {
        message.warning('没有识别到图表日期，无法新增备忘。');
        return;
      }
      setBusinessNoteEditor({
        ...context,
        ...range,
        title: context.title.trim() || '经营备忘'
      });
    }, [message]);
    const updateBusinessMemoNoteDateRange = React.useCallback((dateStrings: string[]) => {
      const range = normalizeBusinessDateRange(dateStrings[0], dateStrings[1]);
      setBusinessNoteEditor(prev => prev ? { ...prev, ...range } : prev);
    }, []);
    const saveBusinessMemoNote = React.useCallback(async () => {
      if (!businessNoteEditor) return;
      const range = normalizeBusinessDateRange(businessNoteEditor.dateStart, businessNoteEditor.dateEnd);
      if (!range.dateStart || !range.dateEnd) {
        message.warning('请选择备忘日期。');
        return;
      }
      const content = businessNoteEditor.content.trim();
      if (!content) {
        message.warning('请填写备忘内容。');
        return;
      }
      const title = businessNoteEditor.title.trim() || '经营备忘';
      const nextNote: BusinessAnalysisNote = {
        id: businessNoteEditor.id || `business-note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        storeId,
        kind: 'memo',
        title,
        createdAt: businessNoteEditor.id
          ? businessAnalysisNotes.find(row => row.id === businessNoteEditor.id)?.createdAt || new Date().toISOString()
          : new Date().toISOString(),
        dateStart: range.dateStart,
        dateEnd: range.dateEnd,
        platform: businessNoteEditor.platform,
        items: [content]
      };
      const nextData = normalizeBusinessData({
        ...businessData,
        notes: businessNoteEditor.id
          ? businessAnalysisNotes.map(row => row.id === businessNoteEditor.id ? nextNote : row)
          : [nextNote, ...businessAnalysisNotes].slice(0, BUSINESS_NOTE_LIMIT)
      });
      await persistBusinessData(nextData, businessNoteEditor.id ? '备忘录已更新。' : '备忘录已保存。');
      setBusinessNoteEditor(null);
    }, [businessAnalysisNotes, businessData, businessNoteEditor, message, persistBusinessData, storeId]);
    const deleteBusinessAnalysisNote = React.useCallback((note: BusinessAnalysisNote) => {
      modal.confirm({
        title: note.kind === 'memo' ? '删除备忘录' : '删除诊断记录',
        content: `确定删除「${note.title}」吗？`,
        okText: '删除',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: () => persistBusinessData(
          normalizeBusinessData({
            ...businessData,
            notes: businessAnalysisNotes.filter(row => row.id !== note.id)
          }),
          note.kind === 'memo' ? '备忘录已删除。' : '诊断记录已删除。'
        )
      });
    }, [businessAnalysisNotes, businessData, modal, persistBusinessData]);
    const saveBusinessAnalysisNote = React.useCallback(async ({
      records,
      summary: businessSummary,
      platform,
      diagnostics
    }: {
      records: BusinessDailyRecord[];
      summary: BusinessDataSummary;
      platform: Platform | 'all';
      diagnostics: BusinessDiagnosticItem[];
    }) => {
      if (!records.length) {
        message.warning('当前筛选范围没有经营数据，无法保存诊断。');
        return;
      }
      const dateStart = businessSummary.dateStart;
      const dateEnd = businessSummary.dateEnd;
      const items = diagnostics.map(row => `${row.title}：${row.description} 建议：${row.suggestion}`);
      const note: BusinessAnalysisNote = {
        id: `business-note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        storeId,
        kind: 'diagnostic',
        title: `${storeName} ${businessDateRangeText(dateStart, dateEnd)} 经营诊断`,
        createdAt: new Date().toISOString(),
        dateStart,
        dateEnd,
        platform,
        items
      };
      await persistBusinessData(
        normalizeBusinessData({
          ...businessData,
          notes: [note, ...businessAnalysisNotes].slice(0, BUSINESS_NOTE_LIMIT)
        }),
        '当前经营诊断已保存。'
      );
    }, [businessAnalysisNotes, businessData, message, persistBusinessData, storeId, storeName]);

    const [businessAnalysisPlatform, setBusinessAnalysisPlatform] = React.useState<Platform | 'all'>('all');
    const [businessAnalysisDateStart, setBusinessAnalysisDateStart] = React.useState('');
    const [businessAnalysisDateEnd, setBusinessAnalysisDateEnd] = React.useState('');
    const businessStoreRecords = React.useMemo(() => {
      return businessRecords.filter(row => row.storeId === storeId);
    }, [businessRecords, storeId]);
    const businessDataDateBounds = React.useMemo(() => {
      if (!businessStoreRecords.length) return { start: '', end: '' };
      const dates = businessStoreRecords.map(row => row.date).sort();
      return { start: dates[0], end: dates[dates.length - 1] };
    }, [businessStoreRecords]);
    const businessDateRangePickerValue = React.useMemo(() => {
      const start = businessDateToDayjs(businessAnalysisDateStart);
      const end = businessDateToDayjs(businessAnalysisDateEnd);
      return start && end ? [start, end] as [Dayjs, Dayjs] : null;
    }, [businessAnalysisDateEnd, businessAnalysisDateStart, businessDateToDayjs]);
    const businessDateRangePresets = React.useMemo(() => {
      const presets: Array<{ label: React.ReactNode; value: [Dayjs, Dayjs] }> = [];
      const addPreset = (label: React.ReactNode, startText: string, endText: string) => {
        const start = businessDateToDayjs(startText);
        const end = businessDateToDayjs(endText);
        if (start && end) presets.push({ label, value: [start, end] });
      };
      if (!businessDataDateBounds.start || !businessDataDateBounds.end) return presets;
      addPreset('全部数据', businessDataDateBounds.start, businessDataDateBounds.end);
      const latest7Start = businessAddDays(businessDataDateBounds.end, -6);
      addPreset('最近7天', latest7Start < businessDataDateBounds.start ? businessDataDateBounds.start : latest7Start, businessDataDateBounds.end);
      const latest30Start = businessAddDays(businessDataDateBounds.end, -29);
      addPreset('最近30天', latest30Start < businessDataDateBounds.start ? businessDataDateBounds.start : latest30Start, businessDataDateBounds.end);
      Array.from(new Set(businessStoreRecords.map(row => businessWeekStart(row.date)).filter(Boolean)))
        .sort((a, b) => b.localeCompare(a))
        .forEach(weekStart => addPreset(`周 ${businessWeekLabel(weekStart)}`, weekStart, businessAddDays(weekStart, 6)));
      Array.from(new Set(businessStoreRecords.map(row => businessMonthStart(row.date)).filter(Boolean)))
        .sort((a, b) => b.localeCompare(a))
        .forEach(monthStart => addPreset(`${monthStart.slice(0, 7)} 月`, monthStart, businessMonthEnd(monthStart)));
      return presets;
    }, [businessAddDays, businessDataDateBounds.end, businessDataDateBounds.start, businessDateToDayjs, businessMonthEnd, businessMonthStart, businessStoreRecords, businessWeekLabel, businessWeekStart]);
    const updateBusinessAnalysisDateRange = (dateStrings: string[]) => {
      setBusinessAnalysisDateStart(normalizeBusinessDate(dateStrings[0]));
      setBusinessAnalysisDateEnd(normalizeBusinessDate(dateStrings[1]));
    };
    const filteredBusinessRecords = React.useMemo(() => {
      return businessStoreRecords
        .filter(row => businessAnalysisPlatform === 'all' || row.platform === businessAnalysisPlatform)
        .filter(row => !businessAnalysisDateStart || row.date >= businessAnalysisDateStart)
        .filter(row => !businessAnalysisDateEnd || row.date <= businessAnalysisDateEnd)
        .sort((a, b) => a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform));
    }, [businessAnalysisDateEnd, businessAnalysisDateStart, businessAnalysisPlatform, businessStoreRecords]);
    const businessSummary = React.useMemo(() => summarizeBusinessRecords(filteredBusinessRecords), [filteredBusinessRecords, summarizeBusinessRecords]);
    const businessActiveDateRangeText = businessDateRangeText(
      businessAnalysisDateStart || businessSummary.dateStart,
      businessAnalysisDateEnd || businessSummary.dateEnd
    );
    const businessPlatformRows = React.useMemo(() => aggregateBusinessRecordsByPlatform(filteredBusinessRecords), [aggregateBusinessRecordsByPlatform, filteredBusinessRecords]);
    const businessDailyRows = React.useMemo(() => aggregateBusinessRecordsByDate(filteredBusinessRecords), [aggregateBusinessRecordsByDate, filteredBusinessRecords]);
    const businessWeeklyRows = React.useMemo(() => aggregateBusinessRecordsByWeekday(filteredBusinessRecords), [aggregateBusinessRecordsByWeekday, filteredBusinessRecords]);
    const businessDiagnostics = React.useMemo(() => diagnoseBusinessRecords(filteredBusinessRecords), [diagnoseBusinessRecords, filteredBusinessRecords]);
    const businessImportRows = React.useMemo(() => {
      return businessImports
        .filter(row => row.storeId === storeId)
        .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    }, [businessImports, storeId]);
    const businessNotes = React.useMemo(() => {
      return businessAnalysisNotes
        .filter(row => row.storeId === storeId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }, [businessAnalysisNotes, storeId]);
    const businessVisibleNotes = React.useMemo(() => {
      return businessNotes
        .filter(row => businessNoteMatchesPlatformFilter(row, businessAnalysisPlatform))
        .filter(row => businessNoteOverlapsDateRange(row, businessAnalysisDateStart, businessAnalysisDateEnd));
    }, [businessAnalysisDateEnd, businessAnalysisDateStart, businessAnalysisPlatform, businessNoteMatchesPlatformFilter, businessNoteOverlapsDateRange, businessNotes]);
    const openBusinessMemoNoteEditorForCurrentRange = () => {
      const fallbackStart = businessAnalysisDateStart || businessSummary.dateStart || businessDataDateBounds.end || '';
      const fallbackEnd = businessAnalysisDateEnd || businessSummary.dateEnd || fallbackStart;
      openBusinessMemoNoteEditorWithContext({
        dateStart: fallbackStart,
        dateEnd: fallbackEnd,
        platform: businessAnalysisPlatform,
        title: '经营备忘',
        content: ''
      });
    };
    const exportCurrentBusinessAnalysis = () => {
      exportBusinessAnalysis(filteredBusinessRecords, businessNotes, businessSummary.dateStart, businessSummary.dateEnd);
    };
    const saveCurrentBusinessAnalysisNote = () => {
      saveBusinessAnalysisNote({
        records: filteredBusinessRecords,
        summary: businessSummary,
        platform: businessAnalysisPlatform,
        diagnostics: businessDiagnostics
      });
    };
    const platformDailyRows = filteredBusinessRecords;
    type BusinessChartMemoUnit = 'count' | 'rate' | 'money';
    type BusinessTrendChartDatum = {
      key: string;
      value: number;
      platform: Platform;
      platformName: string;
      series?: string;
      metric?: string;
      date?: string;
      weekStart?: string;
      weekLabel?: string;
    } & Record<string, unknown>;
    type BusinessTrendInflectionSeverity = 'drop' | 'rise' | 'volatile';
    type BusinessTrendInflectionRow = {
      key: string;
      sourceKey: string;
      dateStart: string;
      dateEnd: string;
      dateLabel: string;
      platform: Platform;
      platformName: string;
      chartTitle: string;
      metricName: string;
      currentValue: number;
      baselineValue: number;
      changeValue: number;
      changeRate: number | null;
      unit: BusinessChartMemoUnit;
      severity: BusinessTrendInflectionSeverity;
      chartLabel: string;
      reason: string;
      suggestion: string;
      memoCount: number;
      memoText: string;
    };
    const moneyTrendRows = platformDailyRows.flatMap(row => [
      { key: `${row.date}-${row.platform}-actualReceipt`, date: row.date, platform: row.platform, platformName: row.platformName, metric: `${row.platformName}实收`, value: roundMoney(row.actualReceipt) },
      { key: `${row.date}-${row.platform}-grossSales`, date: row.date, platform: row.platform, platformName: row.platformName, metric: `${row.platformName}营业额`, value: roundMoney(row.grossSales) },
      { key: `${row.date}-${row.platform}-merchantActivityCost`, date: row.date, platform: row.platform, platformName: row.platformName, metric: `${row.platformName}活动成本`, value: roundMoney(row.merchantActivityCost) }
    ]).filter(row => Number.isFinite(row.value));
    const visitRateTrendRows = platformDailyRows.map(row => ({
      key: `${row.date}-${row.platform}-visitRate`,
      date: row.date,
      platform: row.platform,
      platformName: row.platformName,
      metric: `${row.platformName}入店率`,
      value: row.visitRate === null ? null : roundMoney(row.visitRate * 100)
    })).filter((row): row is { key: string; date: string; platform: Platform; platformName: string; metric: string; value: number } => row.value !== null && Number.isFinite(row.value));
    const orderRateTrendRows = platformDailyRows.map(row => ({
      key: `${row.date}-${row.platform}-orderRate`,
      date: row.date,
      platform: row.platform,
      platformName: row.platformName,
      metric: `${row.platformName}下单率`,
      value: row.orderRate === null ? null : roundMoney(row.orderRate * 100)
    })).filter((row): row is { key: string; date: string; platform: Platform; platformName: string; metric: string; value: number } => row.value !== null && Number.isFinite(row.value));
    const businessTrendDateSpanDays = businessDateSpanDays(
      businessAnalysisDateStart || businessSummary.dateStart,
      businessAnalysisDateEnd || businessSummary.dateEnd
    );
    const isBusinessShortTrendRange = businessTrendDateSpanDays > 0 && businessTrendDateSpanDays < BUSINESS_WEEKLY_TREND_MIN_DAYS;
    const dailyTrendChartRows = platformDailyRows.map(row => ({
      key: `${row.date}-${row.platform}-daily`,
      date: row.date,
      platform: row.platform,
      platformName: row.platformName,
      series: '每日',
      exposureUsers: row.exposureUsers,
      visitUsers: row.visitUsers,
      orderUsers: row.orderUsers
    }));
    const weeklyTrendChartRows = businessWeeklyRows
      .slice()
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.platform.localeCompare(b.platform))
      .flatMap(row => {
        const weekdayRows = BUSINESS_WEEKDAY_LABELS.flatMap((weekdayLabel, weekdayIndex) => {
          const day = row.days[weekdayIndex];
          if (!day) return [];
          return [{
            key: `${row.key}-${weekdayIndex}`,
            weekLabel: row.weekLabel,
            weekStart: row.weekStart,
            platform: row.platform,
            platformName: row.platformName,
            weekdayIndex,
            weekdayLabel,
            series: weekdayLabel,
            exposureUsers: day.exposureUsers,
            visitUsers: day.visitUsers,
            orderUsers: day.orderUsers,
            validOrders: day.validOrders,
            actualReceipt: roundMoney(day.actualReceipt),
            visitRate: day.visitRate === null ? null : roundMoney(day.visitRate * 100),
            orderRate: day.orderRate === null ? null : roundMoney(day.orderRate * 100),
            isWeekTotal: false
          }];
        });
        return weekdayRows.concat({
          key: `${row.key}-total`,
          weekLabel: row.weekLabel,
          weekStart: row.weekStart,
          platform: row.platform,
          platformName: row.platformName,
          weekdayIndex: BUSINESS_WEEKDAY_LABELS.length,
          weekdayLabel: BUSINESS_WEEK_TOTAL_LABEL,
          series: BUSINESS_WEEK_TOTAL_LABEL,
          exposureUsers: row.total.exposureUsers,
          visitUsers: row.total.visitUsers,
          orderUsers: row.total.orderUsers,
          validOrders: row.total.validOrders,
          actualReceipt: roundMoney(row.total.actualReceipt),
          visitRate: row.total.visitRate === null ? null : roundMoney(row.total.visitRate * 100),
          orderRate: row.total.orderRate === null ? null : roundMoney(row.total.orderRate * 100),
          isWeekTotal: true
        });
      });
    const weeklyTrendPlatformGroups = PLATFORMS
      .map(platform => ({
        platform,
        platformName: PLATFORM_NAMES[platform],
        rows: (isBusinessShortTrendRange ? dailyTrendChartRows : weeklyTrendChartRows).filter(row => row.platform === platform)
      }))
      .filter(group => group.rows.length);
    const businessTrendCardTitle = isBusinessShortTrendRange ? '按天变化（日趋势）' : '按周变化（星期对比）';
    const businessTrendDescription = isBusinessShortTrendRange
      ? `当前日期范围少于${BUSINESS_WEEKLY_TREND_MIN_DAYS}天，按日展示曝光、入店和下单变化；平台分开展示。可拖动图表底部滑块缩放日期范围。`
      : `当前日期范围达到${BUSINESS_WEEKLY_TREND_MIN_DAYS}天及以上，横轴是自然周，每条线代表周一到周日中的某一天，并额外展示周总计曲线；平台分开展示。可拖动图表底部滑块缩放自然周范围。`;
    const businessTrendGroupDescription = isBusinessShortTrendRange
      ? '按每天的经营数据展示当前范围内变化。'
      : '每条线为一个星期几，周总计为该平台当周合计口径。';
    const businessTrendXField = isBusinessShortTrendRange ? 'date' : 'weekLabel';
    const businessTrendXTitle = isBusinessShortTrendRange ? '日期' : '自然周';
    const businessFunnelChartGroups = PLATFORMS
      .filter(platform => businessAnalysisPlatform === 'all' || platform === businessAnalysisPlatform)
      .map(platform => {
        const row = businessPlatformRows.find(item => item.platform === platform);
        const totalRows = row ? businessFunnelChartRows(row) : [];
        const newRows = row ? businessCustomerFunnelChartRows(row, 'new') : [];
        const oldRows = row ? businessCustomerFunnelChartRows(row, 'old') : [];
        return {
          platform,
          platformName: PLATFORM_NAMES[platform],
          row,
          rows: totalRows,
          funnels: [
            {
              key: 'total',
              title: '总漏斗',
              rows: totalRows,
              emptyText: `暂无${PLATFORM_NAMES[platform]}总漏斗数据`,
              colors: ['#376996', '#4f8f73', '#d1902f']
            },
            {
              key: 'new',
              title: '新客漏斗',
              rows: newRows,
              emptyText: row?.customerBreakdownProvided ? '暂无新客漏斗数据' : '日报未提供新客字段',
              colors: ['#376996', '#4f8f73', '#d1902f']
            },
            {
              key: 'old',
              title: '老客漏斗',
              rows: oldRows,
              emptyText: row?.customerBreakdownProvided ? '暂无老客漏斗数据' : '日报未提供老客字段',
              colors: ['#6d6aa8', '#8f5f42', '#b7791f']
            }
          ]
        };
      });
    const businessCustomerPlatformGroups = PLATFORMS
      .filter(platform => businessAnalysisPlatform === 'all' || platform === businessAnalysisPlatform)
      .map(platform => {
        const row = businessPlatformRows.find(item => item.platform === platform);
        const rows = platformDailyRows.filter(item => item.platform === platform && (item.customerBreakdownProvided || item.repeatDataProvided));
        const customerRows = rows.filter(item => item.customerBreakdownProvided);
        const orderRows = customerRows.flatMap(item => [
          { key: `${item.key}-new-order-users`, date: item.date, platform: item.platform, platformName: item.platformName, series: '新客下单人数', value: item.newOrderUsers },
          { key: `${item.key}-old-order-users`, date: item.date, platform: item.platform, platformName: item.platformName, series: '老客下单人数', value: item.oldOrderUsers }
        ]);
        const rateRows = customerRows.flatMap(item => [
          item.newVisitRate === null ? null : { key: `${item.key}-new-visit-rate`, date: item.date, platform: item.platform, platformName: item.platformName, series: '新客入店率', value: roundMoney(item.newVisitRate * 100) },
          item.oldVisitRate === null ? null : { key: `${item.key}-old-visit-rate`, date: item.date, platform: item.platform, platformName: item.platformName, series: '老客入店率', value: roundMoney(item.oldVisitRate * 100) },
          item.newOrderRate === null ? null : { key: `${item.key}-new-order-rate`, date: item.date, platform: item.platform, platformName: item.platformName, series: '新客下单率', value: roundMoney(item.newOrderRate * 100) },
          item.oldOrderRate === null ? null : { key: `${item.key}-old-order-rate`, date: item.date, platform: item.platform, platformName: item.platformName, series: '老客下单率', value: roundMoney(item.oldOrderRate * 100) }
        ]).filter((item): item is { key: string; date: string; platform: Platform; platformName: string; series: string; value: number } => Boolean(item));
        const repeatRows = rows.flatMap(item => [
          item.repeatRate7d === null ? null : { key: `${item.key}-repeat-7d`, date: item.date, platform: item.platform, platformName: item.platformName, series: '近7日复购率', value: roundMoney(item.repeatRate7d * 100) },
          item.repeatRate30d === null ? null : { key: `${item.key}-repeat-30d`, date: item.date, platform: item.platform, platformName: item.platformName, series: '近30日复购率', value: roundMoney(item.repeatRate30d * 100) },
          item.platformRepeatRate === null ? null : { key: `${item.key}-repeat-platform`, date: item.date, platform: item.platform, platformName: item.platformName, series: '平台复购率', value: roundMoney(item.platformRepeatRate * 100) }
        ]).filter((item): item is { key: string; date: string; platform: Platform; platformName: string; series: string; value: number } => Boolean(item));
        return {
          platform,
          platformName: PLATFORM_NAMES[platform],
          row,
          rows,
          customerRows,
          orderRows,
          rateRows,
          repeatRows
        };
      })
      .filter(group => group.row && (group.rows.length || group.row.customerBreakdownProvided || group.row.repeatDataProvided));
    const businessMemoNotes = businessNotes.filter(row => row.kind === 'memo');
    const businessMemoNotesForRecord = (row: BusinessDailyRecord) => (
      businessMemoNotes.filter(note => businessNoteMatchesRecord(note, row))
    );
    const businessMemoNotesForDate = (date: string) => (
      businessMemoNotes.filter(note => businessNoteContainsDate(note, date) && businessNoteMatchesPlatformFilter(note, businessAnalysisPlatform))
    );
    const renderBusinessNoteTags = (notes: BusinessAnalysisNote[]) => {
      if (!notes.length) return <Text type="secondary">无</Text>;
      return (
        <Space wrap size={[4, 4]}>
          {notes.slice(0, 3).map(note => (
            <Tooltip key={note.id} title={businessNoteItemsText(note)}>
              <Tag color="purple">{note.title}</Tag>
            </Tooltip>
          ))}
          {notes.length > 3 ? <Tag>+{notes.length - 3}</Tag> : null}
        </Space>
      );
    };
    const businessTrendDatumMetricName = (row: BusinessTrendChartDatum, fallback: string) => (
      String(row.series || row.metric || fallback)
    );
    const businessTrendInflectionSourceKey = (chartTitle: string, row: BusinessTrendChartDatum) => (
      `${chartTitle}::${businessTrendDatumMetricName(row, chartTitle)}::${row.key}`
    );
    const businessTrendValueText = (unit: BusinessChartMemoUnit, value: number) => {
      if (unit === 'rate') return `${money(value)}%`;
      if (unit === 'money') return `¥${money(value)}`;
      return `${Math.round(value)}`;
    };
    const businessTrendChangeText = (row: BusinessTrendInflectionRow) => {
      const sign = row.changeValue > 0 ? '+' : '';
      const rateTextValue = row.changeRate === null ? '' : ` / ${row.changeRate > 0 ? '+' : ''}${money(row.changeRate * 100)}%`;
      if (row.unit === 'rate') return `${sign}${money(row.changeValue)}个百分点${rateTextValue}`;
      if (row.unit === 'money') return `${row.changeValue > 0 ? '+' : '-'}¥${money(Math.abs(row.changeValue))}${rateTextValue}`;
      return `${sign}${Math.round(row.changeValue)}${rateTextValue}`;
    };
    const businessTrendInflectionColor = (severity: BusinessTrendInflectionSeverity) => (
      severity === 'drop' ? 'red' : severity === 'rise' ? 'green' : 'orange'
    );
    const businessTrendInflectionText = (severity: BusinessTrendInflectionSeverity) => (
      severity === 'drop' ? '下降拐点' : severity === 'rise' ? '回升拐点' : '异常波动'
    );
    const businessTrendSeriesName = (text: string, platformName: string) => (
      text.startsWith(platformName) ? text.slice(platformName.length) || text : text
    );
    const businessTrendInflectionLabelText = (row: BusinessTrendInflectionRow) => {
      const direction = row.severity === 'drop' ? '下降' : row.severity === 'rise' ? '回升' : '波动';
      const sign = row.changeValue > 0 ? '+' : '';
      if (row.unit === 'rate') return `${direction} ${sign}${money(row.changeValue)}pp`;
      if (typeof row.changeRate === 'number' && Number.isFinite(row.changeRate)) {
        return `${direction} ${row.changeRate > 0 ? '+' : ''}${money(row.changeRate * 100)}%`;
      }
      if (row.unit === 'money') return `${direction} ${row.changeValue > 0 ? '+' : '-'}¥${money(Math.abs(row.changeValue))}`;
      return `${direction} ${sign}${Math.round(row.changeValue)}`;
    };
    const businessTrendDeltaText = (unit: BusinessChartMemoUnit, value: number) => {
      const sign = value > 0 ? '+' : '';
      if (unit === 'rate') return `${sign}${money(value)}pp`;
      if (unit === 'money') return `${value > 0 ? '+' : '-'}¥${money(Math.abs(value))}`;
      return `${sign}${Math.round(value)}`;
    };
    const businessTrendInvestigationText = (metricName: string, severity: BusinessTrendInflectionSeverity) => {
      const name = metricName.replace(/^美团|^饿了么/, '');
      if (/曝光/.test(name)) return '优先排查平台流量、搜索/推荐排名、营业时长、配送范围和平台活动入口变化。';
      if (/入店人数/.test(name)) return '优先排查曝光质量、门店首图、配送费、起送价、评分和活动吸引力。';
      if (/入店率/.test(name)) return '曝光存在但进店转弱，优先排查门店展示、活动标签、配送费和竞品对比。';
      if (/下单数|下单人数/.test(name)) return '优先拆成入店人数和下单率，排查价格、券、满减、缺货和主推商品结构。';
      if (/下单率|转化率/.test(name)) return '入店后的成交转化变化，优先排查活动力度、券配置、商品价格、套餐结构和缺货。';
      if (/复购/.test(name)) return '优先排查老客返券、会员触达、产品稳定性、履约体验和近期差评。';
      if (/实收|营业额|金额/.test(name)) return '先按曝光、入店率、下单率、客单价拆解，再判断是流量、转化还是商品结构问题。';
      if (/活动成本/.test(name)) return '活动成本异常时，排查满减、券、平台活动报名和低价商品成交占比。';
      return severity === 'drop'
        ? '优先查看同日漏斗、商品结构和备忘事件，确认是否存在活动、缺货或配送变化。'
        : '对照同日备忘和活动配置，确认回升是否来自活动调整、流量恢复或商品结构变化。';
    };
    const businessTrendSuggestionText = (row: BusinessTrendInflectionRow) => {
      if (row.memoCount > 0) return '已有备忘，先核对备忘事件是否能解释该变化；如不能解释，再补充排查结论。';
      return row.severity === 'drop'
        ? '当前范围暂无匹配备忘，建议补充当天或该周发生的活动、缺货、配送、竞品、天气等原因。'
        : '建议补充回升原因，后续可复用为有效动作或恢复路径。';
    };
    const businessTrendInflectionMeetsThreshold = (
      unit: BusinessChartMemoUnit,
      current: number,
      baseline: number,
      changeValue: number,
      changeRate: number | null
    ) => {
      const absChange = Math.abs(changeValue);
      const absRate = Math.abs(changeRate ?? 1);
      if (unit === 'rate') return absChange >= 2 && (absChange >= 3 || absRate >= 0.12);
      if (unit === 'money') return absChange >= 50 && absRate >= 0.12;
      const baseVolume = Math.max(Math.abs(current), Math.abs(baseline));
      if (baseVolume < 10) return absChange >= 5;
      return absChange >= 3 && absRate >= 0.15;
    };
    const collectBusinessTrendInflections = (
      rows: BusinessTrendChartDatum[],
      chartTitle: string,
      unit: BusinessChartMemoUnit
    ): BusinessTrendInflectionRow[] => {
      const groups = new Map<string, BusinessTrendChartDatum[]>();
      rows
        .filter(row => Number.isFinite(row.value))
        .forEach(row => {
          const groupKey = `${row.platform}::${businessTrendDatumMetricName(row, chartTitle)}`;
          groups.set(groupKey, [...(groups.get(groupKey) || []), row]);
        });
      const nextRows: BusinessTrendInflectionRow[] = [];
      groups.forEach(groupRows => {
        const sortedRows = groupRows.slice().sort((a, b) => (
          String(a.weekStart || a.date || '').localeCompare(String(b.weekStart || b.date || ''))
        ));
        sortedRows.forEach((row, index) => {
          const currentValue = Number(row.value);
          const date = normalizeBusinessDate(row.date);
          const weekStart = normalizeBusinessDate(row.weekStart);
          const sameWeekdayBaseline = date
            ? sortedRows.find(item => normalizeBusinessDate(item.date) === businessAddDays(date, -7))
            : null;
          const baselineRow = sameWeekdayBaseline || sortedRows[index - 1];
          if (!baselineRow) return;
          const baselineValue = Number(baselineRow.value);
          if (!Number.isFinite(currentValue) || !Number.isFinite(baselineValue) || currentValue === baselineValue) return;
          const changeValue = roundMoney(currentValue - baselineValue);
          const changeRate = baselineValue === 0 ? null : changeValue / Math.abs(baselineValue);
          if (!businessTrendInflectionMeetsThreshold(unit, currentValue, baselineValue, changeValue, changeRate)) return;
          const nextRow = sortedRows[index + 1];
          const nextValue = nextRow ? Number(nextRow.value) : null;
          const returnsNearBaseline = nextValue !== null
            && Number.isFinite(nextValue)
            && Math.abs(nextValue - baselineValue) <= Math.max(1, Math.abs(changeValue) * 0.35);
          const severity: BusinessTrendInflectionSeverity = returnsNearBaseline
            ? 'volatile'
            : changeValue < 0 ? 'drop' : 'rise';
          const dateStart = date || weekStart;
          const dateEnd = date || (weekStart ? businessAddDays(weekStart, 6) : dateStart);
          if (!dateStart || !dateEnd) return;
          const matchedNotes = businessMemoNotes.filter(note => (
            businessNoteMatchesPlatformFilter(note, row.platform)
            && businessNoteOverlapsDateRange(note, dateStart, dateEnd)
          ));
          const metricName = businessTrendDatumMetricName(row, chartTitle);
          nextRows.push({
            key: `${chartTitle}-${row.key}`,
            sourceKey: businessTrendInflectionSourceKey(chartTitle, row),
            dateStart,
            dateEnd,
            dateLabel: businessDateRangeText(dateStart, dateEnd),
            platform: row.platform,
            platformName: row.platformName,
            chartTitle,
            metricName,
            currentValue,
            baselineValue,
            changeValue,
            changeRate,
            unit,
            severity,
            chartLabel: severity === 'drop' ? '下降' : severity === 'rise' ? '回升' : '波动',
            reason: businessTrendInvestigationText(metricName, severity),
            suggestion: '',
            memoCount: matchedNotes.length,
            memoText: matchedNotes.map(note => `${note.title}：${businessNoteItemsText(note)}`).join('；')
          });
        });
      });
      return nextRows.map(row => ({
        ...row,
        suggestion: businessTrendSuggestionText(row)
      }));
    };
    const businessTrendAllInflectionRows = [
      ...collectBusinessTrendInflections(moneyTrendRows, '金额趋势（按平台）', 'money'),
      ...collectBusinessTrendInflections(visitRateTrendRows, '入店率趋势（按平台）', 'rate'),
      ...collectBusinessTrendInflections(orderRateTrendRows, '下单率趋势（按平台）', 'rate'),
      ...businessCustomerPlatformGroups.flatMap(group => [
        ...collectBusinessTrendInflections(group.orderRows, `${group.platformName}新老客下单人数趋势`, 'count'),
        ...collectBusinessTrendInflections(group.rateRows, `${group.platformName}新老客转化率趋势`, 'rate'),
        ...collectBusinessTrendInflections(group.repeatRows, `${group.platformName}复购率趋势`, 'rate')
      ]),
      ...weeklyTrendPlatformGroups.flatMap(group => {
        const exposureRows = group.rows.map(row => ({ ...row, value: row.exposureUsers }));
        const visitRows = group.rows.map(row => ({ ...row, value: row.visitUsers }));
        const orderUserRows = group.rows.map(row => ({ ...row, value: row.orderUsers }));
        return [
          ...collectBusinessTrendInflections(exposureRows, `${group.platformName}曝光人数${isBusinessShortTrendRange ? '按天变化' : '按周变化'}`, 'count'),
          ...collectBusinessTrendInflections(visitRows, `${group.platformName}入店人数${isBusinessShortTrendRange ? '按天变化' : '按周变化'}`, 'count'),
          ...collectBusinessTrendInflections(orderUserRows, `${group.platformName}下单数${isBusinessShortTrendRange ? '按天变化' : '按周变化'}`, 'count')
        ];
      })
    ]
      .sort((a, b) => {
        const severityWeight = (row: BusinessTrendInflectionRow) => row.severity === 'drop' ? 0 : row.severity === 'volatile' ? 1 : 2;
        const severityDiff = severityWeight(a) - severityWeight(b);
        if (severityDiff !== 0) return severityDiff;
        return Math.abs(b.changeRate ?? b.changeValue) - Math.abs(a.changeRate ?? a.changeValue);
      })
    const businessTrendInflectionRows = businessTrendAllInflectionRows.slice(0, 16);
    const businessTrendInflectionBySourceKey = new Map(businessTrendAllInflectionRows.map(row => [row.sourceKey, row]));
    type BusinessTimeSeriesAnomalyRow = BusinessTrendChartDatum & {
      series: string;
      xLabel: string;
      xKey: string;
      sourceTitle: string;
      anomalyLabel: string;
      anomalyDetail: string;
      anomalySeverityText: string;
      baselineValue: number | null;
      changeValue: number | null;
      changeRate: number | null;
      anomalySortWeight: number;
      pointSize: number;
    };
    type BusinessAnomalyDeltaRow = {
      key: string;
      xLabel: string;
      xKey: string;
      platform: Platform;
      platformName: string;
      series: string;
      value: number;
      baselineValue: number;
      currentValue: number;
      changeRate: number | null;
      anomalyLabel: string;
      anomalyDetail: string;
      anomalySeverityText: string;
      dateStart: string;
      dateEnd: string;
    };
    const buildBusinessTimeSeriesAnomalyRow = (
      row: BusinessTrendChartDatum,
      sourceTitle: string,
      displaySeries: string
    ): BusinessTimeSeriesAnomalyRow => {
      const inflection = businessTrendInflectionBySourceKey.get(businessTrendInflectionSourceKey(sourceTitle, row));
      const rawXLabel = String(row.date || row.weekLabel || row.weekStart || '');
      const series = businessTrendSeriesName(displaySeries, row.platformName);
      return {
        ...row,
        key: `${sourceTitle}-${series}-${row.key}`,
        series,
        metric: series,
        xLabel: rawXLabel,
        xKey: String(row.date || row.weekStart || rawXLabel),
        sourceTitle,
        anomalyLabel: inflection ? businessTrendInflectionLabelText(inflection) : '',
        anomalyDetail: inflection ? `${businessTrendInflectionText(inflection.severity)}，${businessTrendChangeText(inflection)}` : '',
        anomalySeverityText: inflection ? businessTrendInflectionText(inflection.severity) : '',
        baselineValue: inflection ? inflection.baselineValue : null,
        changeValue: inflection ? inflection.changeValue : null,
        changeRate: inflection ? inflection.changeRate : null,
        anomalySortWeight: inflection ? Math.abs(inflection.changeRate ?? inflection.changeValue) : 0,
        pointSize: inflection ? 5.5 : 0
      };
    };
    const businessVisitRateAnomalyRows: BusinessTimeSeriesAnomalyRow[] = [
      ...visitRateTrendRows.map(row => buildBusinessTimeSeriesAnomalyRow(row, '入店率趋势（按平台）', row.metric)),
      ...businessCustomerPlatformGroups.flatMap(group => (
        group.rateRows
          .filter(row => row.series.includes('入店率'))
          .map(row => buildBusinessTimeSeriesAnomalyRow(row, `${group.platformName}新老客转化率趋势`, `${group.platformName}${row.series}`))
      ))
    ].sort((a, b) => a.xLabel.localeCompare(b.xLabel) || a.series.localeCompare(b.series));
    const businessOrderRateAnomalyRows: BusinessTimeSeriesAnomalyRow[] = [
      ...orderRateTrendRows.map(row => buildBusinessTimeSeriesAnomalyRow(row, '下单率趋势（按平台）', row.metric)),
      ...businessCustomerPlatformGroups.flatMap(group => (
        group.rateRows
          .filter(row => row.series.includes('下单率'))
          .map(row => buildBusinessTimeSeriesAnomalyRow(row, `${group.platformName}新老客转化率趋势`, `${group.platformName}${row.series}`))
      ))
    ].sort((a, b) => a.xLabel.localeCompare(b.xLabel) || a.series.localeCompare(b.series));
    const businessCustomerOrderAnomalyRows: BusinessTimeSeriesAnomalyRow[] = businessCustomerPlatformGroups
      .flatMap(group => (
        group.orderRows.map(row => buildBusinessTimeSeriesAnomalyRow(row, `${group.platformName}新老客下单人数趋势`, `${group.platformName}${row.series}`))
      ))
      .sort((a, b) => a.xLabel.localeCompare(b.xLabel) || a.series.localeCompare(b.series));
    const businessRepeatRateAnomalyRows: BusinessTimeSeriesAnomalyRow[] = businessCustomerPlatformGroups
      .flatMap(group => (
        group.repeatRows.map(row => buildBusinessTimeSeriesAnomalyRow(row, `${group.platformName}复购率趋势`, `${group.platformName}${row.series}`))
      ))
      .sort((a, b) => a.xLabel.localeCompare(b.xLabel) || a.series.localeCompare(b.series));
    const businessTrendAnomalySourceGroups = [
      { key: 'visit-rate', title: '入店率时序异常（总/新客/老客）', yTitle: '入店率', unit: 'rate' as BusinessChartMemoUnit, rows: businessVisitRateAnomalyRows },
      { key: 'order-rate', title: '下单率时序异常（总/新客/老客）', yTitle: '下单率', unit: 'rate' as BusinessChartMemoUnit, rows: businessOrderRateAnomalyRows },
      { key: 'customer-order', title: '新老客下单人数时序异常', yTitle: '下单人数', unit: 'count' as BusinessChartMemoUnit, rows: businessCustomerOrderAnomalyRows },
      { key: 'repeat-rate', title: '复购率时序异常', yTitle: '复购率', unit: 'rate' as BusinessChartMemoUnit, rows: businessRepeatRateAnomalyRows }
    ];
    const buildBusinessAnomalyDeltaRows = (rows: BusinessTimeSeriesAnomalyRow[]): BusinessAnomalyDeltaRow[] => (
      rows
        .filter(row => row.anomalyLabel && row.baselineValue !== null && row.changeValue !== null)
        .map(row => ({
          key: `${row.key}-delta`,
          xLabel: row.xLabel,
          xKey: row.xKey,
          platform: row.platform,
          platformName: row.platformName,
          series: row.series,
          value: Number(row.changeValue || 0),
          baselineValue: Number(row.baselineValue || 0),
          currentValue: Number(row.value || 0),
          changeRate: row.changeRate,
          anomalyLabel: row.anomalyLabel,
          anomalyDetail: row.anomalyDetail,
          anomalySeverityText: row.anomalySeverityText,
          dateStart: normalizeBusinessDate(row.date) || normalizeBusinessDate(row.weekStart) || row.xKey,
          dateEnd: normalizeBusinessDate(row.date) || (normalizeBusinessDate(row.weekStart) ? businessAddDays(String(row.weekStart), 6) : row.xKey)
        }))
    );
    const businessTrendAnomalyChartGroups = businessTrendAnomalySourceGroups
      .flatMap(group => PLATFORMS.map(platform => {
        const rows = group.rows.filter(row => row.platform === platform);
        const anomalies = rows
          .filter(row => row.anomalyLabel)
          .sort((a, b) => (
            String(a.date || a.weekStart || '').localeCompare(String(b.date || b.weekStart || ''))
            || b.anomalySortWeight - a.anomalySortWeight
          ));
        return {
          ...group,
          key: `${group.key}-${platform}`,
          title: `${PLATFORM_NAMES[platform]}${group.title.replace('时序异常', '趋势诊断')}`,
          platform,
          platformName: PLATFORM_NAMES[platform],
          rows,
          anomalies,
          deltaRows: buildBusinessAnomalyDeltaRows(rows)
        };
      }))
      .filter(group => group.rows.length);
    const platformSummaryColumns: TableColumnsType<BusinessPlatformAggregate> = [
      { title: '平台', dataIndex: 'platformName', width: 100, fixed: 'left', render: value => <Tag>{value}</Tag> },
      { title: '日期范围', width: 210, render: (_, row) => businessDateRangeText(row.dateStart, row.dateEnd) },
      { title: '天数', dataIndex: 'dayCount', width: 80 },
      { title: '实收', dataIndex: 'actualReceipt', width: 110, render: value => `¥${money(value)}`, sorter: (a, b) => a.actualReceipt - b.actualReceipt },
      { title: '营业额', dataIndex: 'grossSales', width: 110, render: value => `¥${money(value)}` },
      { title: '有效订单', dataIndex: 'validOrders', width: 100, sorter: (a, b) => a.validOrders - b.validOrders },
      { title: '单均实付', dataIndex: 'averageReceipt', width: 100, render: value => `¥${money(value)}` },
      { title: '曝光人数', dataIndex: 'exposureUsers', width: 100 },
      { title: '入店率', dataIndex: 'visitRate', width: 100, render: value => value === null ? '-' : rateText(value) },
      { title: '下单率', dataIndex: 'orderRate', width: 100, render: value => value === null ? '-' : rateText(value) },
      { title: '商家活动成本', dataIndex: 'merchantActivityCost', width: 130, render: value => `¥${money(value)}` },
      { title: '活动成本率', dataIndex: 'activityCostRate', width: 110, render: value => value === null ? '-' : rateText(value) },
      { title: '平台补贴', dataIndex: 'platformSubsidy', width: 110, render: value => `¥${money(value)}` },
      { title: '动销率', dataIndex: 'tradedProductRate', width: 100, render: value => value === null ? '-' : rateText(value) }
    ];
    const customerSummaryColumns: TableColumnsType<BusinessPlatformAggregate> = [
      { title: '平台', dataIndex: 'platformName', width: 90, fixed: 'left', render: value => <Tag>{value}</Tag> },
      { title: '日期范围', width: 210, render: (_, row) => businessDateRangeText(row.dateStart, row.dateEnd) },
      { title: '新客曝光', dataIndex: 'newExposureUsers', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.newExposureUsers : '-' },
      { title: '新客入店', dataIndex: 'newVisitUsers', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.newVisitUsers : '-' },
      { title: '新客入店率', dataIndex: 'newVisitRate', width: 110, render: value => value === null ? '-' : rateText(value) },
      { title: '新客下单', dataIndex: 'newOrderUsers', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.newOrderUsers : '-' },
      { title: '新客下单率', dataIndex: 'newOrderRate', width: 110, render: value => value === null ? '-' : rateText(value) },
      { title: '新客下单占比', dataIndex: 'newOrderShare', width: 120, render: value => value === null ? '-' : rateText(value) },
      { title: '老客曝光', dataIndex: 'oldExposureUsers', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.oldExposureUsers : '-' },
      { title: '老客入店', dataIndex: 'oldVisitUsers', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.oldVisitUsers : '-' },
      { title: '老客入店率', dataIndex: 'oldVisitRate', width: 110, render: value => value === null ? '-' : rateText(value) },
      { title: '老客下单', dataIndex: 'oldOrderUsers', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.oldOrderUsers : '-' },
      { title: '老客下单率', dataIndex: 'oldOrderRate', width: 110, render: value => value === null ? '-' : rateText(value) },
      { title: '老客下单占比', dataIndex: 'oldOrderShare', width: 120, render: value => value === null ? '-' : rateText(value) },
      { title: '复购口径', width: 230, render: (_, row) => businessRepeatSummaryText(row) }
    ];
    const funnelSummaryColumns: TableColumnsType<BusinessPlatformAggregate> = [
      { title: '平台', dataIndex: 'platformName', width: 90, fixed: 'left', render: value => <Tag>{value}</Tag> },
      { title: '漏斗阶段', width: 320, render: (_, row) => businessFunnelStageText(row) },
      { title: '入店率', width: 100, render: (_, row) => businessFunnelMetrics(row).visitRate === null ? '-' : rateText(businessFunnelMetrics(row).visitRate) },
      { title: '曝光到入店流失', width: 150, render: (_, row) => {
        const funnel = businessFunnelMetrics(row);
        return `${funnel.exposureVisitLoss} / ${funnel.exposureVisitLossRate === null ? '-' : rateText(funnel.exposureVisitLossRate)}`;
      } },
      { title: '下单率', width: 100, render: (_, row) => businessFunnelMetrics(row).orderRate === null ? '-' : rateText(businessFunnelMetrics(row).orderRate) },
      { title: '入店到下单流失', width: 150, render: (_, row) => {
        const funnel = businessFunnelMetrics(row);
        return `${funnel.visitOrderLoss} / ${funnel.visitOrderLossRate === null ? '-' : rateText(funnel.visitOrderLossRate)}`;
      } },
      { title: '有效订单转化', width: 130, render: (_, row) => {
        const funnel = businessFunnelMetrics(row);
        return funnel.orderValidRate === null ? '-' : rateText(funnel.orderValidRate);
      } },
      { title: '全链路订单转化', width: 140, render: (_, row) => {
        const funnel = businessFunnelMetrics(row);
        return funnel.exposureValidRate === null ? '-' : rateText(funnel.exposureValidRate);
      } },
      { title: '主要断点', width: 120, render: (_, row) => <Tag color="orange">{businessFunnelMetrics(row).bottleneck}</Tag> }
    ];
    const dailyColumns: TableColumnsType<BusinessDailyAggregate> = [
      { title: '日期', dataIndex: 'date', width: 120, fixed: 'left' },
      { title: '备注', width: 180, render: (_, row) => renderBusinessNoteTags(businessMemoNotesForDate(row.date)) },
      { title: '实收', dataIndex: 'actualReceipt', width: 110, render: value => `¥${money(value)}`, sorter: (a, b) => a.actualReceipt - b.actualReceipt },
      { title: '营业额', dataIndex: 'grossSales', width: 110, render: value => `¥${money(value)}` },
      { title: '有效订单', dataIndex: 'validOrders', width: 100, sorter: (a, b) => a.validOrders - b.validOrders },
      { title: '单均实付', dataIndex: 'averageReceipt', width: 100, render: value => `¥${money(value)}` },
      { title: '曝光人数', dataIndex: 'exposureUsers', width: 100 },
      { title: '入店人数', dataIndex: 'visitUsers', width: 100 },
      { title: '入店率', dataIndex: 'visitRate', width: 100, render: value => value === null ? '-' : rateText(value) },
      { title: '下单人数', dataIndex: 'orderUsers', width: 100 },
      { title: '下单率', dataIndex: 'orderRate', width: 100, render: value => value === null ? '-' : rateText(value) },
      { title: '商家活动成本', dataIndex: 'merchantActivityCost', width: 130, render: value => `¥${money(value)}` },
      { title: '平台补贴', dataIndex: 'platformSubsidy', width: 110, render: value => `¥${money(value)}` },
      { title: '成本率', dataIndex: 'activityCostRate', width: 100, render: value => value === null ? '-' : rateText(value) }
    ];
    const detailColumns: TableColumnsType<BusinessDailyRecord> = [
      { title: '日期', dataIndex: 'date', width: 120, fixed: 'left' },
      { title: '平台', dataIndex: 'platformName', width: 90, render: value => <Tag>{value}</Tag> },
      { title: '备注', width: 180, render: (_, row) => renderBusinessNoteTags(businessMemoNotesForRecord(row)) },
      { title: '实收', dataIndex: 'actualReceipt', width: 110, render: value => `¥${money(value)}`, sorter: (a, b) => a.actualReceipt - b.actualReceipt },
      { title: '营业额', dataIndex: 'grossSales', width: 110, render: value => `¥${money(value)}` },
      { title: '有效订单', dataIndex: 'validOrders', width: 100 },
      { title: '无效订单', dataIndex: 'invalidOrders', width: 100 },
      { title: '单均实付', dataIndex: 'averageReceipt', width: 100, render: value => `¥${money(value)}` },
      { title: '曝光', dataIndex: 'exposureUsers', width: 90 },
      { title: '入店', dataIndex: 'visitUsers', width: 90 },
      { title: '入店率', dataIndex: 'visitRate', width: 100, render: value => value === null ? '-' : rateText(value) },
      { title: '下单', dataIndex: 'orderUsers', width: 90 },
      { title: '下单率', dataIndex: 'orderRate', width: 100, render: value => value === null ? '-' : rateText(value) },
      { title: '商家活动成本', dataIndex: 'merchantActivityCost', width: 130, render: value => `¥${money(value)}` },
      { title: '平台补贴', dataIndex: 'platformSubsidy', width: 110, render: value => `¥${money(value)}` },
      {
        title: '商品结构',
        width: 180,
        render: (_, row) => row.listedProducts > 0
          ? `${row.tradedProducts}/${row.listedProducts} 动销，缺货 ${row.outOfStockProducts}`
          : <Text type="secondary">日报未提供</Text>
      },
      { title: '来源', dataIndex: 'sourceFileName', width: 220, ellipsis: true }
    ];
    const dailyFunnelColumns: TableColumnsType<BusinessDailyRecord> = [
      { title: '日期', dataIndex: 'date', width: 120, fixed: 'left' },
      { title: '平台', dataIndex: 'platformName', width: 90, fixed: 'left', render: value => <Tag>{value}</Tag> },
      { title: '漏斗阶段', width: 320, render: (_, row) => businessFunnelStageText(row) },
      { title: '入店率', width: 100, render: (_, row) => businessFunnelMetrics(row).visitRate === null ? '-' : rateText(businessFunnelMetrics(row).visitRate) },
      { title: '曝光到入店流失', width: 150, render: (_, row) => {
        const funnel = businessFunnelMetrics(row);
        return `${funnel.exposureVisitLoss} / ${funnel.exposureVisitLossRate === null ? '-' : rateText(funnel.exposureVisitLossRate)}`;
      } },
      { title: '下单率', width: 100, render: (_, row) => businessFunnelMetrics(row).orderRate === null ? '-' : rateText(businessFunnelMetrics(row).orderRate) },
      { title: '入店到下单流失', width: 150, render: (_, row) => {
        const funnel = businessFunnelMetrics(row);
        return `${funnel.visitOrderLoss} / ${funnel.visitOrderLossRate === null ? '-' : rateText(funnel.visitOrderLossRate)}`;
      } },
      { title: '有效订单转化', width: 130, render: (_, row) => {
        const funnel = businessFunnelMetrics(row);
        return funnel.orderValidRate === null ? '-' : rateText(funnel.orderValidRate);
      } },
      { title: '全链路订单转化', width: 140, render: (_, row) => {
        const funnel = businessFunnelMetrics(row);
        return funnel.exposureValidRate === null ? '-' : rateText(funnel.exposureValidRate);
      } },
      { title: '主要断点', width: 120, render: (_, row) => <Tag color="orange">{businessFunnelMetrics(row).bottleneck}</Tag> }
    ];
    const customerDetailColumns: TableColumnsType<BusinessDailyRecord> = [
      { title: '日期', dataIndex: 'date', width: 120, fixed: 'left' },
      { title: '平台', dataIndex: 'platformName', width: 90, fixed: 'left', render: value => <Tag>{value}</Tag> },
      { title: '新客曝光', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.newExposureUsers : '-' },
      { title: '新客入店', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.newVisitUsers : '-' },
      { title: '新客入店率', width: 110, render: (_, row) => row.newVisitRate === null ? '-' : rateText(row.newVisitRate) },
      { title: '新客下单', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.newOrderUsers : '-' },
      { title: '新客下单率', width: 110, render: (_, row) => row.newOrderRate === null ? '-' : rateText(row.newOrderRate) },
      { title: '老客曝光', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.oldExposureUsers : '-' },
      { title: '老客入店', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.oldVisitUsers : '-' },
      { title: '老客入店率', width: 110, render: (_, row) => row.oldVisitRate === null ? '-' : rateText(row.oldVisitRate) },
      { title: '老客下单', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.oldOrderUsers : '-' },
      { title: '老客下单率', width: 110, render: (_, row) => row.oldOrderRate === null ? '-' : rateText(row.oldOrderRate) },
      { title: '复购', width: 230, render: (_, row) => row.repeatDataProvided ? businessRepeatSummaryText(row) : <Text type="secondary">日报未提供</Text> },
      { title: '来源', dataIndex: 'sourceFileName', width: 220, ellipsis: true }
    ];
    const diagnosticColumns: TableColumnsType<BusinessDiagnosticItem> = [
      {
        title: '等级',
        dataIndex: 'severity',
        width: 90,
        render: value => <Tag color={businessDiagnosticColor(value)}>{businessDiagnosticSeverityText(value)}</Tag>
      },
      { title: '问题', dataIndex: 'title', width: 180 },
      { title: '当前', dataIndex: 'currentText', width: 120 },
      { title: '对比', dataIndex: 'baselineText', width: 120 },
      { title: '判断', dataIndex: 'description', width: 360 },
      { title: '建议', dataIndex: 'suggestion', width: 360 }
    ];
    const trendInflectionColumns: TableColumnsType<BusinessTrendInflectionRow> = [
      { title: '范围', dataIndex: 'dateLabel', width: 200, fixed: 'left' },
      { title: '平台', dataIndex: 'platformName', width: 90, render: value => <Tag>{value}</Tag> },
      {
        title: '拐点',
        width: 180,
        render: (_, row) => (
          <Space direction="vertical" size={2}>
            <Tag color={businessTrendInflectionColor(row.severity)}>{businessTrendInflectionText(row.severity)}</Tag>
            <Text>{row.metricName}</Text>
          </Space>
        )
      },
      { title: '来源图表', dataIndex: 'chartTitle', width: 220, ellipsis: true },
      {
        title: '当前 / 对比',
        width: 170,
        render: (_, row) => `${businessTrendValueText(row.unit, row.currentValue)} / ${businessTrendValueText(row.unit, row.baselineValue)}`
      },
      {
        title: '变化',
        width: 150,
        render: (_, row) => (
          <Text type={row.severity === 'drop' ? 'danger' : row.severity === 'rise' ? 'success' : 'warning'}>
            {businessTrendChangeText(row)}
          </Text>
        )
      },
      { title: '排查方向', dataIndex: 'reason', width: 360 },
      { title: '备忘', width: 260, render: (_, row) => row.memoText || <Text type="secondary">暂无匹配备忘</Text> },
      {
        title: '操作',
        width: 100,
        render: (_, row) => (
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => openBusinessMemoNoteEditorWithContext({
              dateStart: row.dateStart,
              dateEnd: row.dateEnd,
              platform: row.platform,
              title: `${row.dateLabel} ${row.metricName}原因`,
              content: `拐点：${businessTrendInflectionText(row.severity)}；图表：${row.chartTitle}；指标：${row.metricName}；当前：${businessTrendValueText(row.unit, row.currentValue)}；对比：${businessTrendValueText(row.unit, row.baselineValue)}；变化：${businessTrendChangeText(row)}。原因：`
            })}
          >
            记原因
          </Button>
        )
      }
    ];
    const importColumns: TableColumnsType<BusinessDataImportBatch> = [
      { title: '导入时间', dataIndex: 'importedAt', width: 170, render: value => businessImportedAtText(String(value || '')) },
      { title: '平台', dataIndex: 'platformName', width: 90, render: value => <Tag>{value}</Tag> },
      { title: '日期范围', width: 210, render: (_, row) => businessDateRangeText(row.dateStart, row.dateEnd) },
      { title: '天数', dataIndex: 'rowCount', width: 80 },
      { title: '覆盖日期', width: 220, render: (_, row) => row.replacedDates.length ? row.replacedDates.join('、') : <Text type="secondary">无</Text> },
      { title: '文件', dataIndex: 'fileName', width: 260, ellipsis: true },
      { title: '提示', width: 260, render: (_, row) => row.warnings.length ? row.warnings.join('；') : <Text type="secondary">无</Text> }
    ];
    const noteColumns: TableColumnsType<BusinessAnalysisNote> = [
      { title: '保存时间', dataIndex: 'createdAt', width: 170, render: value => businessImportedAtText(String(value || '')) },
      { title: '类型', dataIndex: 'kind', width: 90, render: value => <Tag color={value === 'memo' ? 'purple' : 'blue'}>{value === 'memo' ? '备忘' : '诊断'}</Tag> },
      { title: '范围', width: 210, render: (_, row) => businessDateRangeText(row.dateStart, row.dateEnd) },
      { title: '平台', dataIndex: 'platform', width: 90, render: value => value === 'all' ? '全部' : PLATFORM_NAMES[value as Platform] },
      { title: '标题', dataIndex: 'title', width: 180, ellipsis: true },
      { title: '内容', render: (_, row) => row.items.length ? businessNoteItemsText(row) : <Text type="secondary">无</Text> },
      {
        title: '操作',
        width: 130,
        render: (_, row) => (
          <Space>
            {row.kind === 'memo' ? <Button size="small" icon={<EditOutlined />} onClick={() => openBusinessMemoNoteEditor(row)} /> : null}
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => deleteBusinessAnalysisNote(row)} />
          </Space>
        )
      }
    ];
    const renderBusinessMetric = (label: string, value: React.ReactNode, secondary?: string) => (
      <div className="field">
        <Text type="secondary">{label}</Text>
        <div className="field-value">{value}</div>
        {secondary ? <Text type="secondary">{secondary}</Text> : null}
      </div>
    );
    type BusinessChartDatum = Record<string, unknown>;
    type BusinessChartClickEvent = { data?: unknown };
    type BusinessChartReadyContext = {
      chart?: {
        on?: (eventName: string, handler: (event: BusinessChartClickEvent) => void) => void;
      };
    };
    const normalizeBusinessChartDatum = (value: unknown): BusinessChartDatum | null => {
      if (Array.isArray(value)) return normalizeBusinessChartDatum(value[0]);
      if (!value || typeof value !== 'object') return null;
      const row = value as BusinessChartDatum;
      if (row.data && typeof row.data === 'object' && row.data !== row) return normalizeBusinessChartDatum(row.data);
      return row;
    };
    const businessChartMemoValueText = (value: unknown, unit: BusinessChartMemoUnit) => {
      const amount = Number(value);
      if (!Number.isFinite(amount)) return '';
      if (unit === 'rate') return `${money(amount)}%`;
      if (unit === 'money') return `¥${money(amount)}`;
      return `${Math.round(amount)}`;
    };
    const openBusinessMemoFromChartDatum = (value: unknown, chartTitle: string, unit: BusinessChartMemoUnit) => {
      const datum = normalizeBusinessChartDatum(value);
      const date = normalizeBusinessDate(datum?.date);
      const weekStart = normalizeBusinessDate(datum?.weekStart);
      const dateStart = date || weekStart;
      const dateEnd = date || (weekStart ? businessAddDays(weekStart, 6) : dateStart);
      if (!dateStart || !dateEnd) {
        message.warning('没有识别到图表日期，无法新增备忘。');
        return;
      }
      const platform: Platform | 'all' = datum?.platform === 'meituan' || datum?.platform === 'eleme'
        ? datum.platform
        : businessAnalysisPlatform;
      const metricName = String(datum?.series || datum?.metric || chartTitle);
      const valueText = businessChartMemoValueText(datum?.value, unit);
      const rangeText = businessDateRangeText(dateStart, dateEnd);
      openBusinessMemoNoteEditorWithContext({
        dateStart,
        dateEnd,
        platform,
        title: `${rangeText} ${metricName}备忘`,
        content: `图表：${chartTitle}；指标：${metricName}${valueText ? `；数值：${valueText}` : ''}。原因：`
      });
    };
    const businessChartMemoOnReady = (chartTitle: string, unit: BusinessChartMemoUnit) => (
      ({ chart }: BusinessChartReadyContext) => {
        chart?.on?.('element:click', event => {
          const rawDatum = normalizeBusinessChartDatum(event.data);
          openBusinessMemoFromChartDatum(rawDatum, chartTitle, unit);
        });
      }
    );
    const renderBusinessLineChart = (
      rows: Array<BusinessTrendChartDatum & { series: string }>,
      xField: string,
      xTitle: string,
      yTitle: string,
      unit: BusinessChartMemoUnit,
      memoTitle = yTitle
    ) => {
      if (!rows.length) return <div className="chart-empty">暂无{yTitle}数据</div>;
      const seriesNames = Array.from(new Set(rows.map(row => row.series)));
      const isWeekdaySeries = seriesNames.some(series => BUSINESS_WEEKDAY_LABELS.includes(series) || series === BUSINESS_WEEK_TOTAL_LABEL);
      return (
        <div className="chart-frame">
          <AntvLine
            data={rows}
            height={260}
            autoFit
            xField={xField}
            yField="value"
            colorField="series"
            shapeField="smooth"
            axis={{
              x: { title: xTitle, labelAutoRotate: false },
              y: {
                title: yTitle,
                labelFormatter: (value: number | string) => (
                  unit === 'rate' ? `${money(value)}%` : unit === 'money' ? `¥${money(value)}` : `${Math.round(Number(value))}`
                )
              }
            }}
            scale={{
              color: {
                domain: isWeekdaySeries ? [...BUSINESS_WEEKDAY_LABELS, BUSINESS_WEEK_TOTAL_LABEL] : seriesNames,
                range: isWeekdaySeries ? BUSINESS_WEEKDAY_CHART_COLORS : BUSINESS_LINE_CHART_COLORS
              }
            }}
            style={{ lineWidth: 2.4 }}
            interaction={{
              tooltip: {
                marker: true
              }
            }}
            slider={{
              x: {
                labelFormatter: (value: number | string) => String(value)
              }
            }}
            onReady={businessChartMemoOnReady(memoTitle, unit)}
          />
        </div>
      );
    };
    const renderBusinessStackedColumnChart = (
      rows: Array<BusinessTrendChartDatum & { series: string }>,
      xField: string,
      xTitle: string,
      yTitle: string,
      unit: BusinessChartMemoUnit,
      memoTitle = yTitle
    ) => {
      if (!rows.length) return <div className="chart-empty">暂无{yTitle}数据</div>;
      const seriesNames = Array.from(new Set(rows.map(row => row.series)));
      return (
        <div className="chart-frame">
          <AntvColumn
            data={rows}
            height={260}
            autoFit
            xField={xField}
            yField="value"
            colorField="series"
            transform={[{ type: 'stackY' }]}
            axis={{
              x: { title: xTitle, labelAutoRotate: false },
              y: {
                title: yTitle,
                labelFormatter: (value: number | string) => (
                  unit === 'rate' ? `${money(value)}%` : unit === 'money' ? `¥${money(value)}` : `${Math.round(Number(value))}`
                )
              }
            }}
            scale={{
              color: {
                domain: seriesNames,
                range: BUSINESS_LINE_CHART_COLORS
              }
            }}
            style={{ insetRight: 2, stroke: '#fff', lineWidth: 1 }}
            tooltip={{
              title: (datum: BusinessTrendChartDatum) => String(datum.date || datum.weekLabel || ''),
              items: [
                (datum: BusinessTrendChartDatum) => ({
                  name: String(datum.series || ''),
                  value: businessTrendValueText(unit, Number(datum.value) || 0)
                })
              ]
            }}
            onReady={businessChartMemoOnReady(memoTitle, unit)}
          />
        </div>
      );
    };
    const renderBusinessTimeSeriesAnomalyChart = (
      rows: BusinessTimeSeriesAnomalyRow[],
      deltaRows: BusinessAnomalyDeltaRow[],
      title: string,
      yTitle: string,
      unit: BusinessChartMemoUnit
    ) => {
      if (!rows.length) return <div className="chart-empty">暂无{yTitle}时序数据</div>;
      const seriesNames = Array.from(new Set(rows.map(row => row.series)));
      const anomalySeriesNames = Array.from(new Set(deltaRows.map(row => row.series)));
      const seriesColorRange = [...BUSINESS_WEEKDAY_CHART_COLORS, ...BUSINESS_LINE_CHART_COLORS];
      return (
        <div className="business-anomaly-chart">
          <div className="chart-frame business-anomaly-trend">
            <AntvLine
              data={rows}
              height={300}
              autoFit
              xField="xLabel"
              yField="value"
              colorField="series"
              shapeField="smooth"
              axis={{
                x: { title: '日期', labelAutoRotate: false },
                y: {
                  title: yTitle,
                  labelFormatter: (value: number | string) => (
                    unit === 'rate' ? `${money(value)}%` : unit === 'money' ? `¥${money(value)}` : `${Math.round(Number(value))}`
                  )
                }
              }}
              scale={{
                color: {
                  domain: seriesNames,
                  range: seriesColorRange
                }
              }}
              style={{ lineWidth: 2.5, strokeOpacity: 0.92 }}
              point={{
                sizeField: 'pointSize',
                style: (datum: BusinessTimeSeriesAnomalyRow) => ({
                  fill: datum.anomalySeverityText === '下降拐点' ? '#cf1322' : datum.anomalySeverityText === '回升拐点' ? '#237804' : '#d48806',
                  stroke: '#fff',
                  lineWidth: 1.6
                })
              }}
              label={[
                {
                  text: (datum: BusinessTimeSeriesAnomalyRow) => datum.anomalyLabel,
                  position: 'top',
                  transform: [{ type: 'overlapHide' }],
                  style: { dy: -14, fill: '#111827', fontSize: 11, fontWeight: 700 }
                }
              ]}
              tooltip={{
                title: (datum: BusinessTimeSeriesAnomalyRow) => datum.xLabel,
                items: [
                  (datum: BusinessTimeSeriesAnomalyRow) => ({
                    name: datum.series,
                    value: `${businessTrendValueText(unit, Number(datum.value) || 0)}${datum.baselineValue !== null ? `；对比 ${businessTrendValueText(unit, datum.baselineValue)}` : ''}${datum.anomalyDetail ? `；${datum.anomalyDetail}` : ''}`
                  })
                ]
              }}
              interaction={{
                tooltip: {
                  marker: true
                }
              }}
              slider={{
                x: {
                  labelFormatter: (value: number | string) => String(value)
                }
              }}
              onReady={businessChartMemoOnReady(title, unit)}
            />
          </div>
          <div className="chart-frame business-anomaly-delta">
            {deltaRows.length ? (
              <AntvColumn
                data={deltaRows}
                height={176}
                autoFit
                xField="xLabel"
                yField="value"
                colorField="series"
                axis={{
                  x: { title: '异常日期', labelAutoRotate: false },
                  y: {
                    title: '相对对比值变化',
                    labelFormatter: (value: number | string) => businessTrendDeltaText(unit, Number(value))
                  }
                }}
                scale={{
                  color: {
                    domain: anomalySeriesNames,
                    range: seriesColorRange
                  }
                }}
                style={(datum: BusinessAnomalyDeltaRow) => ({
                  inset: 3,
                  radiusTopLeft: Number(datum.value) >= 0 ? 4 : 0,
                  radiusTopRight: Number(datum.value) >= 0 ? 4 : 0,
                  radiusBottomLeft: Number(datum.value) < 0 ? 4 : 0,
                  radiusBottomRight: Number(datum.value) < 0 ? 4 : 0,
                  fillOpacity: datum.anomalySeverityText === '异常波动' ? 0.72 : 0.88
                })}
                label={[
                  {
                    text: (datum: BusinessAnomalyDeltaRow) => businessTrendDeltaText(unit, Number(datum.value)),
                    position: (datum: BusinessAnomalyDeltaRow) => Number(datum.value) >= 0 ? 'top' : 'bottom',
                    transform: [{ type: 'overlapHide' }],
                    style: { fill: '#111827', fontSize: 11, fontWeight: 700 }
                  }
                ]}
                tooltip={{
                  title: (datum: BusinessAnomalyDeltaRow) => datum.xLabel,
                  items: [
                    (datum: BusinessAnomalyDeltaRow) => ({
                      name: datum.series,
                      value: `当前 ${businessTrendValueText(unit, datum.currentValue)}；对比 ${businessTrendValueText(unit, datum.baselineValue)}；变化 ${businessTrendDeltaText(unit, datum.value)}${datum.changeRate === null ? '' : ` / ${money(datum.changeRate * 100)}%`}`
                    })
                  ]
                }}
                onReady={businessChartMemoOnReady(`${title}异常偏离`, unit)}
              />
            ) : <div className="chart-empty business-anomaly-delta-empty">当前筛选范围没有达到阈值的异常偏离</div>}
          </div>
        </div>
      );
    };
    const renderBusinessFunnelChart = (
      rows: BusinessFunnelChartRow[],
      emptyText: string,
      colors: string[],
      height = 240
    ) => rows.length ? (
      <div className="chart-frame">
        <AntvFunnel
          data={rows}
          height={height}
          autoFit
          paddingRight={82}
          xField="stage"
          yField="value"
          label={[
            {
              text: (datum: BusinessFunnelChartRow) => datum.stage,
              position: 'inside',
              transform: [{ type: 'contrastReverse' }],
              style: { dy: -8, fontSize: 12, fontWeight: 600 }
            },
            {
              text: (datum: BusinessFunnelChartRow) => datum.valueText,
              position: 'inside',
              transform: [{ type: 'contrastReverse' }],
              style: { dy: 10, fontSize: 12 }
            },
            {
              text: (datum: BusinessFunnelChartRow) => datum.conversionTitleText,
              position: 'top-right',
              style: {
                dx: 36,
                dy: 8,
                fill: '#6b7280',
                fontSize: 11,
                textAlign: 'left',
                textBaseline: 'middle'
              }
            },
            {
              text: (datum: BusinessFunnelChartRow) => datum.conversionRateText,
              position: 'top-right',
              style: {
                dx: 36,
                dy: 24,
                fill: '#111827',
                fontSize: 12,
                fontWeight: 600,
                textAlign: 'left',
                textBaseline: 'middle'
              }
            }
          ]}
          tooltip={{
            title: false,
            items: [
              (datum: BusinessFunnelChartRow) => ({
                name: datum.stage,
                value: `${datum.valueText}；${datum.conversionText}；${datum.totalConversionText}`
              })
            ]
          }}
          scale={{ color: { range: colors } }}
          legend={false}
        />
      </div>
    ) : <div className="chart-empty">{emptyText}</div>;
    const businessNoteDateStartValue = businessNoteEditor ? businessDateToDayjs(businessNoteEditor.dateStart) : null;
    const businessNoteDateEndValue = businessNoteEditor ? businessDateToDayjs(businessNoteEditor.dateEnd) : null;
    const businessNoteDateRangeValue = businessNoteDateStartValue && businessNoteDateEndValue
      ? [businessNoteDateStartValue, businessNoteDateEndValue] as [Dayjs, Dayjs]
      : null;

    return (
      <>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Card
            title="经营数据分析"
            extra={
              <Space wrap>
                <Upload {...uploadProps(importBusinessReport)}><Button icon={<UploadOutlined />}>导入经营日报</Button></Upload>
                <Button icon={<PlusOutlined />} onClick={openBusinessMemoNoteEditorForCurrentRange}>新增备忘</Button>
                <Button icon={<DownloadOutlined />} onClick={exportCurrentBusinessAnalysis}>导出明细</Button>
                <Button icon={<SaveOutlined />} onClick={saveCurrentBusinessAnalysisNote}>保存诊断</Button>
              </Space>
            }
          >
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Space wrap>
              <Select
                style={{ width: 140 }}
                value={businessAnalysisPlatform}
                onChange={setBusinessAnalysisPlatform}
                options={[
                  { value: 'all', label: '全部平台' },
                  ...PLATFORMS.map(platform => ({ value: platform, label: PLATFORM_NAMES[platform] }))
                ]}
              />
              <RangePicker
                allowClear
                disabled={!businessStoreRecords.length}
                format="YYYY-MM-DD"
                placeholder={['开始日期', '结束日期']}
                presets={businessDateRangePresets}
                style={{ width: 360 }}
                value={businessDateRangePickerValue}
                onChange={(_, dateStrings) => updateBusinessAnalysisDateRange(Array.isArray(dateStrings) ? dateStrings : [])}
              />
              <Tag color="blue">{businessStoreRecords.length} 条日报</Tag>
              <Tag>数据范围：{businessDateRangeText(businessDataDateBounds.start, businessDataDateBounds.end)}</Tag>
              <Tag color="green">当前统计：{businessActiveDateRangeText}</Tag>
            </Space>
            <Text type="secondary">当前按订单日期和平台分别统计；日期选择器内可用预设范围选择全部数据、最近天数、自然周和月份，也可以直接自定义日期范围。</Text>
          </Space>
        </Card>

        <Card title="总计汇总（辅助）">
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Text type="secondary">这里用于快速看当前筛选范围的全店合计；经营判断和后续拆解以平台分开统计为准。</Text>
            <Row gutter={[12, 12]}>
              <Col xs={12} md={6}>{renderBusinessMetric('实收', `¥${money(businessSummary.actualReceipt)}`, `${businessSummary.validOrders} 单`)}</Col>
              <Col xs={12} md={6}>{renderBusinessMetric('入店率', businessSummary.visitRate === null ? '-' : rateText(businessSummary.visitRate), `${businessSummary.exposureUsers} 曝光`)}</Col>
              <Col xs={12} md={6}>{renderBusinessMetric('下单率', businessSummary.orderRate === null ? '-' : rateText(businessSummary.orderRate), `${businessSummary.visitUsers} 入店`)}</Col>
              <Col xs={12} md={6}>{renderBusinessMetric('单均实付', `¥${money(businessSummary.averageReceipt)}`, `${businessSummary.dayCount} 天`)}</Col>
              <Col xs={12} md={6}>{renderBusinessMetric('商家活动成本', `¥${money(businessSummary.merchantActivityCost)}`, businessSummary.merchantCostPerOrder === null ? undefined : `单均 ¥${money(businessSummary.merchantCostPerOrder)}`)}</Col>
              <Col xs={12} md={6}>{renderBusinessMetric('活动成本率', businessSummary.activityCostRate === null ? '-' : rateText(businessSummary.activityCostRate), '按营业额计算')}</Col>
              <Col xs={12} md={6}>{renderBusinessMetric('平台补贴', `¥${money(businessSummary.platformSubsidy)}`, '不计入成本')}</Col>
              <Col xs={12} md={6}>{renderBusinessMetric('动销率', businessSummary.tradedProductRate === null ? '-' : rateText(businessSummary.tradedProductRate), '按日报字段')}</Col>
            </Row>
          </Space>
        </Card>

        <Card title="平台汇总（主口径）" extra={<Tag color="green">{businessActiveDateRangeText}</Tag>}>
          <Table rowKey="key" size="small" columns={platformSummaryColumns} dataSource={businessPlatformRows} pagination={false} scroll={{ x: 1510 }} />
        </Card>

        <Card title="客户结构与复购（平台口径）" extra={<Tag color="green">{businessActiveDateRangeText}</Tag>}>
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <Text type="secondary">新客、老客直接使用平台日报字段汇总，算法和总漏斗一致：曝光、入店、下单人数求和，入店率和下单率按汇总后的分子/分母重新计算；不同平台的复购周期不强行合并。</Text>
            {businessCustomerPlatformGroups.length ? businessCustomerPlatformGroups.map(group => {
              const row = group.row;
              if (!row) return null;
              const primaryRepeat = businessPrimaryRepeatRate(row);
              return (
                <Space key={group.platform} direction="vertical" style={{ width: '100%' }} size="small">
                  <Space wrap>
                    <Tag color="blue">{group.platformName}</Tag>
                    <Text type="secondary">客户结构日报 {group.customerRows.length} 天，复购日报 {group.rows.filter(item => item.repeatDataProvided).length} 天。</Text>
                  </Space>
                  <Row gutter={[12, 12]}>
                    <Col xs={12} md={4}>{renderBusinessMetric('新客下单', row.customerBreakdownProvided ? row.newOrderUsers : '-', row.newOrderRate === null ? undefined : `下单率 ${rateText(row.newOrderRate)}`)}</Col>
                    <Col xs={12} md={4}>{renderBusinessMetric('老客下单', row.customerBreakdownProvided ? row.oldOrderUsers : '-', row.oldOrderRate === null ? undefined : `下单率 ${rateText(row.oldOrderRate)}`)}</Col>
                    <Col xs={12} md={4}>{renderBusinessMetric('新客入店率', row.newVisitRate === null ? '-' : rateText(row.newVisitRate), `${row.newExposureUsers} 曝光`)}</Col>
                    <Col xs={12} md={4}>{renderBusinessMetric('老客入店率', row.oldVisitRate === null ? '-' : rateText(row.oldVisitRate), `${row.oldExposureUsers} 曝光`)}</Col>
                    <Col xs={12} md={4}>{renderBusinessMetric('新客下单占比', row.newOrderShare === null ? '-' : rateText(row.newOrderShare), row.oldOrderShare === null ? undefined : `老客 ${rateText(row.oldOrderShare)}`)}</Col>
                    <Col xs={12} md={4}>{renderBusinessMetric(primaryRepeat.label, primaryRepeat.value === null ? '-' : rateText(primaryRepeat.value), businessRepeatSummaryText(row))}</Col>
                  </Row>
                  <Row gutter={[12, 12]}>
                    <Col xs={24} xl={8}>
                      <Space direction="vertical" style={{ width: '100%' }} size="small">
                        <Text strong>新老客下单人数</Text>
                        {renderBusinessStackedColumnChart(group.orderRows, 'date', '日期', '下单人数', 'count', `${group.platformName}新老客下单人数趋势`)}
                      </Space>
                    </Col>
                    <Col xs={24} xl={8}>
                      <Space direction="vertical" style={{ width: '100%' }} size="small">
                        <Text strong>新老客转化率</Text>
                        {renderBusinessLineChart(group.rateRows, 'date', '日期', '转化率', 'rate', `${group.platformName}新老客转化率趋势`)}
                      </Space>
                    </Col>
                    <Col xs={24} xl={8}>
                      <Space direction="vertical" style={{ width: '100%' }} size="small">
                        <Text strong>复购率趋势</Text>
                        {renderBusinessLineChart(group.repeatRows, 'date', '日期', '复购率', 'rate', `${group.platformName}复购率趋势`)}
                      </Space>
                    </Col>
                  </Row>
                </Space>
              );
            }) : <div className="chart-empty">当前筛选范围暂无新客、老客或复购字段</div>}
            <Table
              rowKey="key"
              size="small"
              columns={customerSummaryColumns}
              dataSource={businessPlatformRows.filter(row => row.customerBreakdownProvided || row.repeatDataProvided)}
              pagination={false}
              scroll={{ x: 1800 }}
            />
          </Space>
        </Card>

        <Card title="漏斗模型（平台对比）" extra={<Tag color="green">{businessActiveDateRangeText}</Tag>}>
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <Text type="secondary">按当前日期范围比较总、新客、老客从曝光到入店、入店到下单的转化链路；周、月和自定义日期筛选会同步影响漏斗图和明细表。</Text>
            <Space direction="vertical" style={{ width: '100%' }} size="large">
              {businessFunnelChartGroups.map(group => (
                <Space key={group.platform} direction="vertical" style={{ width: '100%' }} size="small">
                  <Space wrap>
                    <Tag color="blue">{group.platformName}</Tag>
                    {group.row ? <Text type="secondary">{businessFunnelStageText(group.row)}</Text> : <Text type="secondary">当前范围暂无数据</Text>}
                  </Space>
                  <Row gutter={[12, 12]}>
                    {group.funnels.map(funnel => (
                      <Col xs={24} lg={8} key={`${group.platform}-${funnel.key}`}>
                        <Space direction="vertical" style={{ width: '100%' }} size="small">
                          <Text strong>{funnel.title}</Text>
                          {renderBusinessFunnelChart(funnel.rows, funnel.emptyText, funnel.colors)}
                        </Space>
                      </Col>
                    ))}
                  </Row>
                </Space>
              ))}
            </Space>
            <Table rowKey="key" size="small" columns={funnelSummaryColumns} dataSource={businessPlatformRows} pagination={false} scroll={{ x: 1500 }} />
          </Space>
        </Card>

        <Card title="趋势拐点排查" extra={<Tag color="green">{businessActiveDateRangeText}</Tag>}>
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <Text type="secondary">系统按同平台、同指标、同曲线对比明显变化；长周期优先看同星期跨周变化，短周期按前序点辅助判断。每个平台单独展示趋势线，并在下方用异常偏离柱标出当前值相对对比值的变化幅度。</Text>
            {businessTrendAnomalyChartGroups.length ? (
              <Row gutter={[12, 12]}>
                {businessTrendAnomalyChartGroups.map(group => (
                  <Col xs={24} key={group.key}>
                    <Space direction="vertical" style={{ width: '100%' }} size="small">
                      <Text strong>{group.title}</Text>
                      {group.anomalies.length ? (
                        <Space wrap size={[4, 4]}>
                          {group.anomalies.slice(0, 6).map(row => (
                            <Tooltip key={`${group.key}-${row.key}-anomaly`} title={row.anomalyDetail}>
                              <Tag color={row.anomalySeverityText === '下降拐点' ? 'red' : row.anomalySeverityText === '回升拐点' ? 'green' : 'orange'}>
                                {row.xLabel} {row.series} {row.anomalyLabel}
                              </Tag>
                            </Tooltip>
                          ))}
                          {group.anomalies.length > 6 ? <Tag>+{group.anomalies.length - 6}</Tag> : null}
                        </Space>
                      ) : <Text type="secondary">该图没有达到阈值的异常点。</Text>}
                      {renderBusinessTimeSeriesAnomalyChart(group.rows, group.deltaRows, group.title, group.yTitle, group.unit)}
                    </Space>
                  </Col>
                ))}
              </Row>
            ) : <div className="chart-empty">当前筛选范围暂无可用于时序异常分析的趋势数据</div>}
            {businessTrendInflectionRows.length ? (
                <Table
                  rowKey="key"
                  size="small"
                  columns={trendInflectionColumns}
                  dataSource={businessTrendInflectionRows}
                  pagination={false}
                  scroll={{ x: 1730 }}
                />
            ) : <div className="chart-empty">当前筛选范围没有达到阈值的明显拐点</div>}
          </Space>
        </Card>

        <Card title={businessTrendCardTitle}>
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <Text type="secondary">{businessTrendDescription}</Text>
            {weeklyTrendPlatformGroups.length ? weeklyTrendPlatformGroups.map(group => {
              const exposureRows = group.rows.map(row => ({ ...row, value: row.exposureUsers }));
              const visitRows = group.rows.map(row => ({ ...row, value: row.visitUsers }));
              const orderUserRows = group.rows.map(row => ({ ...row, value: row.orderUsers }));
              return (
                <Space key={group.platform} direction="vertical" style={{ width: '100%' }} size="small">
                  <Space wrap>
                    <Tag color="blue">{group.platformName}</Tag>
                    <Text type="secondary">{businessTrendGroupDescription}</Text>
                  </Space>
                  <Row gutter={[12, 12]}>
                    <Col xs={24} xl={8}>
                      <Space direction="vertical" style={{ width: '100%' }} size="small">
                        <Text strong>曝光人数{isBusinessShortTrendRange ? '按天变化' : '按周变化'}</Text>
                        {renderBusinessLineChart(exposureRows, businessTrendXField, businessTrendXTitle, '曝光人数', 'count', `${group.platformName}曝光人数${isBusinessShortTrendRange ? '按天变化' : '按周变化'}`)}
                      </Space>
                    </Col>
                    <Col xs={24} xl={8}>
                      <Space direction="vertical" style={{ width: '100%' }} size="small">
                        <Text strong>入店人数{isBusinessShortTrendRange ? '按天变化' : '按周变化'}</Text>
                        {renderBusinessLineChart(visitRows, businessTrendXField, businessTrendXTitle, '入店人数', 'count', `${group.platformName}入店人数${isBusinessShortTrendRange ? '按天变化' : '按周变化'}`)}
                      </Space>
                    </Col>
                    <Col xs={24} xl={8}>
                      <Space direction="vertical" style={{ width: '100%' }} size="small">
                        <Text strong>下单数{isBusinessShortTrendRange ? '按天变化' : '按周变化'}</Text>
                        {renderBusinessLineChart(orderUserRows, businessTrendXField, businessTrendXTitle, '下单数', 'count', `${group.platformName}下单数${isBusinessShortTrendRange ? '按天变化' : '按周变化'}`)}
                      </Space>
                    </Col>
                  </Row>
                </Space>
              );
            }) : <div className="chart-empty">暂无{isBusinessShortTrendRange ? '按天' : '按周'}变化数据</div>}
          </Space>
        </Card>

        <Row gutter={[12, 12]}>
          <Col xs={24} xl={12}>
            <Card title="金额趋势（按平台）">
              {moneyTrendRows.length ? (
                <div className="chart-frame">
                  <AntvLine
                    data={moneyTrendRows}
                    height={260}
                    autoFit
                    xField="date"
                    yField="value"
                    colorField="metric"
                    shapeField="smooth"
                    axis={{
                      x: { title: '日期', labelAutoRotate: false },
                      y: { title: '金额', labelFormatter: (value: number | string) => `¥${money(value)}` }
                    }}
                    scale={{ color: { range: ['#496f5d', '#5b7c99', '#b85f32'] } }}
                    interaction={{ tooltip: { marker: true } }}
                    onReady={businessChartMemoOnReady('金额趋势（按平台）', 'money')}
                  />
                </div>
              ) : <div className="chart-empty">暂无金额趋势数据</div>}
            </Card>
          </Col>
          <Col xs={24} xl={12}>
            <Card title="入店率趋势（按平台）">
              {visitRateTrendRows.length ? (
                <div className="chart-frame">
                  <AntvLine
                    data={visitRateTrendRows}
                    height={260}
                    autoFit
                    xField="date"
                    yField="value"
                    colorField="platformName"
                    shapeField="smooth"
                    axis={{
                      x: { title: '日期', labelAutoRotate: false },
                      y: { title: '入店率', labelFormatter: (value: number | string) => `${money(value)}%` }
                    }}
                    scale={{ color: { range: ['#d95b18', '#6d6aa8'] } }}
                    interaction={{ tooltip: { marker: true } }}
                    onReady={businessChartMemoOnReady('入店率趋势（按平台）', 'rate')}
                  />
                </div>
              ) : <div className="chart-empty">暂无入店率趋势数据</div>}
            </Card>
          </Col>
          <Col xs={24} xl={12}>
            <Card title="下单率趋势（按平台）">
              {orderRateTrendRows.length ? (
                <div className="chart-frame">
                  <AntvLine
                    data={orderRateTrendRows}
                    height={260}
                    autoFit
                    xField="date"
                    yField="value"
                    colorField="platformName"
                    shapeField="smooth"
                    axis={{
                      x: { title: '日期', labelAutoRotate: false },
                      y: { title: '下单率', labelFormatter: (value: number | string) => `${money(value)}%` }
                    }}
                    scale={{ color: { range: ['#d95b18', '#6d6aa8'] } }}
                    interaction={{ tooltip: { marker: true } }}
                    onReady={businessChartMemoOnReady('下单率趋势（按平台）', 'rate')}
                  />
                </div>
              ) : <div className="chart-empty">暂无下单率趋势数据</div>}
            </Card>
          </Col>
        </Row>

        <Card title="诊断摘要">
          <Table rowKey="key" size="small" columns={diagnosticColumns} dataSource={businessDiagnostics} pagination={false} scroll={{ x: 1250 }} />
        </Card>

        <Card title="备忘录与诊断记录" extra={<Button icon={<PlusOutlined />} onClick={openBusinessMemoNoteEditorForCurrentRange}>新增备忘</Button>}>
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <Space wrap>
              <Tag color="green">{businessActiveDateRangeText}</Tag>
              <Tag color="purple">{businessVisibleNotes.length} 条记录</Tag>
            </Space>
            <Table rowKey="id" size="small" columns={noteColumns} dataSource={businessVisibleNotes} pagination={{ pageSize: 5 }} scroll={{ x: 980 }} />
          </Space>
        </Card>

        <Card title="每日总计（辅助）">
          <Table rowKey="key" size="small" columns={dailyColumns} dataSource={businessDailyRows} pagination={{ pageSize: 8 }} scroll={{ x: 1540 }} />
        </Card>

        <Card title="每日平台统计（主口径）">
          <Table rowKey="key" size="small" columns={detailColumns} dataSource={filteredBusinessRecords} pagination={{ pageSize: 8 }} scroll={{ x: 1820 }} />
        </Card>

        <Card title="每日漏斗明细（主口径）">
          <Table rowKey="key" size="small" columns={dailyFunnelColumns} dataSource={filteredBusinessRecords} pagination={{ pageSize: 8 }} scroll={{ x: 1500 }} />
        </Card>

        <Card title="每日客户结构明细（平台口径）">
          <Table
            rowKey="key"
            size="small"
            columns={customerDetailColumns}
            dataSource={filteredBusinessRecords.filter(row => row.customerBreakdownProvided || row.repeatDataProvided)}
            pagination={{ pageSize: 8 }}
            scroll={{ x: 1660 }}
          />
        </Card>

          <Card title="导入记录">
            <Table rowKey="id" size="small" columns={importColumns} dataSource={businessImportRows} pagination={{ pageSize: 6 }} scroll={{ x: 1270 }} />
          </Card>
        </Space>
        <BusinessNoteEditorModal
          editor={businessNoteEditor}
          dateRangeValue={businessNoteDateRangeValue}
          platforms={PLATFORMS}
          platformNames={PLATFORM_NAMES}
          onSave={saveBusinessMemoNote}
          onCancel={() => setBusinessNoteEditor(null)}
          onChangeDateRange={updateBusinessMemoNoteDateRange}
          onChange={mutator => setBusinessNoteEditor(prev => prev ? mutator(prev) : prev)}
        />
      </>
    );
  }
