import type { Platform } from '../../domain/types';

export type ActivityDesignStage = 'priceScan' | 'routeDesign' | 'payValidation';

export type ActivityDesignSelectedBand = {
  platform: Platform;
  payBandKey: string;
};

export type ActivityDesignPayBandKeyByPlatform = Record<Platform, string>;

