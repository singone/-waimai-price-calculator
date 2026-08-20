import React from 'react';
import { DEFAULT_ACTIVITY_DESIGN_PAGE_FILTERS } from '../../config/activity';
import type {
  ActivityDesignResult,
  ActivityPriceBucketRow,
  ActivityRecommendationRow,
  Platform
} from '../../domain/types';
import type {
  ActivityDesignPayBandKeyByPlatform,
  ActivityDesignSelectedBand,
  ActivityDesignStage
} from './activityDesignPageTypes';

const DEFAULT_ACTIVITY_DESIGN_PAY_BAND_KEYS: ActivityDesignPayBandKeyByPlatform = {
  meituan: 'all',
  eleme: 'all'
};

type UseActivityDesignPageStateParams = {
  storeId: string;
  activityDesign: ActivityDesignResult | null | undefined;
  onRunActivityDesign?: () => Promise<unknown> | unknown;
  onRunActivityRouteDesign?: () => Promise<unknown> | unknown;
  onRunActivityDesignRouteValidation?: (recommendationKey: string, recommendationSnapshot?: ActivityRecommendationRow | null) => Promise<unknown> | unknown;
};

export function useActivityDesignPageState({
  storeId,
  activityDesign,
  onRunActivityDesign,
  onRunActivityRouteDesign,
  onRunActivityDesignRouteValidation
}: UseActivityDesignPageStateParams) {
  const [activityDesignPlatformTab, setActivityDesignPlatformTab] = React.useState<Platform>('meituan');
  const [activityDesignFilters, setActivityDesignFilters] = React.useState(DEFAULT_ACTIVITY_DESIGN_PAGE_FILTERS);
  const [activityDesignStage, setActivityDesignStage] = React.useState<ActivityDesignStage>('priceScan');
  const [selectedActivityDesignBand, setSelectedActivityDesignBand] = React.useState<ActivityDesignSelectedBand | null>(null);
  const [selectedActivityDesignPayBandKeyByPlatform, setSelectedActivityDesignPayBandKeyByPlatform] = React.useState<ActivityDesignPayBandKeyByPlatform>(() => ({ ...DEFAULT_ACTIVITY_DESIGN_PAY_BAND_KEYS }));
  const [selectedActivityDesignRouteKey, setSelectedActivityDesignRouteKey] = React.useState('');
  const [selectedActivityCouponRoute, setSelectedActivityCouponRoute] = React.useState<ActivityRecommendationRow | null>(null);
  const [selectedActivityFullReductionLogRoute, setSelectedActivityFullReductionLogRoute] = React.useState<ActivityRecommendationRow | null>(null);
  const [selectedActivityOriginalBucket, setSelectedActivityOriginalBucket] = React.useState<ActivityPriceBucketRow | null>(null);
  const [activityDesignDetailSearchText, setActivityDesignDetailSearchText] = React.useState('');
  const [isActivityDesignLoading, setIsActivityDesignLoading] = React.useState(false);

  const resetActivityDesignDetailSelection = React.useCallback(() => {
    setSelectedActivityDesignBand(null);
    setSelectedActivityDesignPayBandKeyByPlatform({ ...DEFAULT_ACTIVITY_DESIGN_PAY_BAND_KEYS });
    setSelectedActivityOriginalBucket(null);
    setActivityDesignDetailSearchText('');
  }, []);

  const resetActivityDesignRouteSelection = React.useCallback(() => {
    setSelectedActivityDesignRouteKey('');
    setSelectedActivityCouponRoute(null);
    setSelectedActivityFullReductionLogRoute(null);
  }, []);

  React.useEffect(() => {
    resetActivityDesignRouteSelection();
    resetActivityDesignDetailSelection();
    setActivityDesignStage('priceScan');
    setActivityDesignPlatformTab('meituan');
    setActivityDesignFilters(DEFAULT_ACTIVITY_DESIGN_PAGE_FILTERS);
  }, [resetActivityDesignDetailSelection, resetActivityDesignRouteSelection, storeId]);

  React.useEffect(() => {
    if (activityDesign) return;
    resetActivityDesignRouteSelection();
    resetActivityDesignDetailSelection();
    setActivityDesignStage('priceScan');
  }, [activityDesign, resetActivityDesignDetailSelection, resetActivityDesignRouteSelection]);

  const runActivityDesign = React.useCallback(async () => {
    if (isActivityDesignLoading) return;
    resetActivityDesignRouteSelection();
    resetActivityDesignDetailSelection();
    setActivityDesignStage('priceScan');
    setIsActivityDesignLoading(true);
    try {
      await onRunActivityDesign?.();
    } finally {
      setIsActivityDesignLoading(false);
    }
  }, [isActivityDesignLoading, onRunActivityDesign, resetActivityDesignDetailSelection, resetActivityDesignRouteSelection]);

  const runActivityRouteDesign = React.useCallback(async () => {
    if (isActivityDesignLoading) return;
    const routeBucketCount = (activityDesign?.originalPriceBuckets || []).filter(row => row.comboCount > 0).length;
    if (!routeBucketCount) {
      await onRunActivityRouteDesign?.();
      return;
    }
    resetActivityDesignRouteSelection();
    resetActivityDesignDetailSelection();
    setActivityDesignStage('routeDesign');
    setIsActivityDesignLoading(true);
    try {
      await onRunActivityRouteDesign?.();
    } finally {
      setIsActivityDesignLoading(false);
    }
  }, [activityDesign, isActivityDesignLoading, onRunActivityRouteDesign, resetActivityDesignDetailSelection, resetActivityDesignRouteSelection]);

  const runActivityDesignRouteValidation = React.useCallback(async (recommendationKey: string, recommendationSnapshot?: ActivityRecommendationRow | null) => {
    if (isActivityDesignLoading || !recommendationKey) return;
    setSelectedActivityDesignRouteKey(recommendationKey);
    resetActivityDesignDetailSelection();
    setActivityDesignStage('payValidation');
    setIsActivityDesignLoading(true);
    try {
      await onRunActivityDesignRouteValidation?.(recommendationKey, recommendationSnapshot);
    } finally {
      setIsActivityDesignLoading(false);
    }
  }, [isActivityDesignLoading, onRunActivityDesignRouteValidation, resetActivityDesignDetailSelection]);

  const changeActivityDesignStep = React.useCallback((current: number) => {
    const nextStage: ActivityDesignStage = current === 2 ? 'payValidation' : current === 1 ? 'routeDesign' : 'priceScan';
    setActivityDesignStage(nextStage);
  }, []);

  const updateActivityDesignPayBandKey = React.useCallback((platform: Platform, key: string) => {
    setSelectedActivityDesignPayBandKeyByPlatform(prev => ({ ...prev, [platform]: key }));
  }, []);

  return {
    activityDesignPlatformTab,
    setActivityDesignPlatformTab,
    activityDesignFilters,
    setActivityDesignFilters,
    activityDesignStage,
    setActivityDesignStage,
    selectedActivityDesignBand,
    setSelectedActivityDesignBand,
    selectedActivityDesignPayBandKeyByPlatform,
    selectedActivityDesignRouteKey,
    selectedActivityCouponRoute,
    setSelectedActivityCouponRoute,
    selectedActivityFullReductionLogRoute,
    setSelectedActivityFullReductionLogRoute,
    selectedActivityOriginalBucket,
    setSelectedActivityOriginalBucket,
    activityDesignDetailSearchText,
    setActivityDesignDetailSearchText,
    isActivityDesignLoading,
    runActivityDesign,
    runActivityRouteDesign,
    runActivityDesignRouteValidation,
    changeActivityDesignStep,
    updateActivityDesignPayBandKey,
    resetActivityDesignDetailSelection
  };
}
