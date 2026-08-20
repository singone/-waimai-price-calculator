import type { Platform, Product } from './types';
import { roundMoney } from './money';

export class PlatformUtils {
  static readonly MEITUAN: Platform = 'meituan';
  static readonly ELEME: Platform = 'eleme';
  static readonly PLATFORMS: Platform[] = [PlatformUtils.MEITUAN, PlatformUtils.ELEME];
  static readonly NAMES: Record<Platform, string> = {
    meituan: '美团',
    eleme: '饿了么'
  };

  static price(product: Product, platform: Platform) {
    const platformValue = platform === PlatformUtils.ELEME ? product.elemePrice : product.meituanPrice;
    const value = Number(platformValue);
    return value > 0 ? value : Number(product.price) || 0;
  }

  static packageFee(product: Product, platform: Platform) {
    const platformValue = platform === PlatformUtils.ELEME ? product.elemePackageFee : product.meituanPackageFee;
    if (platformValue !== '') return Math.max(0, Number(platformValue) || 0);
    return Math.max(0, Number(product.packageFee) || 0);
  }

  static originalUnitPrice(product: Product, platform: Platform) {
    return roundMoney(PlatformUtils.price(product, platform) + PlatformUtils.packageFee(product, platform));
  }

  static priceField(platform: Platform): 'meituanPrice' | 'elemePrice' {
    return platform === PlatformUtils.ELEME ? 'elemePrice' : 'meituanPrice';
  }

  static packageFeeField(platform: Platform): 'meituanPackageFee' | 'elemePackageFee' {
    return platform === PlatformUtils.ELEME ? 'elemePackageFee' : 'meituanPackageFee';
  }

  static isListed(product: Product, platform: Platform) {
    return platform === PlatformUtils.MEITUAN
      ? product.meituanEnabled !== false
      : product.elemeEnabled !== false;
  }
}
