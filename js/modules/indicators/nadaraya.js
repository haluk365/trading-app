/**
 * NADARAYA-WATSON ENVELOPE İNDİKATÖRÜ
 * Stratejimizdeki ana indikatör - bant taşmalarını hesaplar
 * Pine Script kodundan JavaScript'e çevrilmiş versiyon
 */

window.NadarayaWatson = (function() {
    'use strict';

    // Default parametreler (Config'den alınabilir)
    const DEFAULT_PARAMS = {
        bandwidth: 8.0,
        multiplier: 3.0,
        source: 'close',
        repainting: true
    };

    /**
     * Gaussian weight fonksiyonu
     */
    function gaussianWeight(x, h) {
        return Math.exp(-(Math.pow(x, 2) / (h * h * 2)));
    }

    /**
     * Non-repainting (endpoint) method ile Nadaraya-Watson hesapla
     */
    function calculateEndpoint(data, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        
        if (!data || data.length < 10) {
            Logger.warning(Logger.CATEGORIES.INDICATORS, 'Nadaraya-Watson: Yetersiz veri');
            return { upper: [], lower: [], center: [] };
        }

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'Nadaraya-Watson endpoint hesaplanıyor', {
            dataLength: data.length,
            bandwidth: p.bandwidth,
            multiplier: p.multiplier
        });

        const sourceValues = extractSource(data, p.source);
        const result = {
            upper: [],
            lower: [],
            center: []
        };

        // Coefficient'leri önceden hesapla
        const maxPoints = Math.min(500, data.length);
        const coefs = [];
        let denominator = 0;

        for (let i = 0; i < maxPoints; i++) {
            const weight = gaussianWeight(i, p.bandwidth);
            coefs.push(weight);
            denominator += weight;
        }

        // Her nokta için hesaplama
        for (let i = maxPoints - 1; i < sourceValues.length; i++) {
            let weightedSum = 0;
            let errorSum = 0;

            // Weighted mean hesapla
            for (let j = 0; j < maxPoints; j++) {
                const dataIndex = i - j;
                if (dataIndex >= 0) {
                    weightedSum += sourceValues[dataIndex] * coefs[j];
                }
            }

            const centerValue = weightedSum / denominator;

            // Mean Absolute Error hesapla
            for (let j = 0; j < maxPoints; j++) {
                const dataIndex = i - j;
                if (dataIndex >= 0) {
                    errorSum += Math.abs(sourceValues[dataIndex] - centerValue);
                }
            }

            const mae = (errorSum / maxPoints) * p.multiplier;

            result.center.push(centerValue);
            result.upper.push(centerValue + mae);
            result.lower.push(centerValue - mae);
        }

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'Nadaraya-Watson endpoint hesaplandı', {
            resultLength: result.center.length
        });

        return result;
    }

    /**
     * Repainting method ile Nadaraya-Watson hesapla
     */
    function calculateRepainting(data, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        
        if (!data || data.length < 10) {
            Logger.warning(Logger.CATEGORIES.INDICATORS, 'Nadaraya-Watson: Yetersiz veri');
            return { upper: [], lower: [], center: [], signals: [] };
        }

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'Nadaraya-Watson repainting hesaplanıyor', {
            dataLength: data.length,
            bandwidth: p.bandwidth,
            multiplier: p.multiplier
        });

        const sourceValues = extractSource(data, p.source);
        const n = sourceValues.length;
        const maxPoints = Math.min(500, n);
        
        const result = {
            upper: [],
            lower: [],
            center: [],
            signals: []
        };

        let totalError = 0;
        const centerValues = [];

        // Her nokta için Nadaraya-Watson estimate hesapla
        for (let i = 0; i < maxPoints; i++) {
            let sum = 0;
            let sumWeights = 0;

            // Weighted mean hesapla
            for (let j = 0; j < maxPoints; j++) {
                const weight = gaussianWeight(i - j, p.bandwidth);
                const dataIndex = n - maxPoints + j;
                
                if (dataIndex >= 0 && dataIndex < n) {
                    sum += sourceValues[dataIndex] * weight;
                    sumWeights += weight;
                }
            }

            const centerValue = sumWeights > 0 ? sum / sumWeights : sourceValues[n - maxPoints + i];
            centerValues.push(centerValue);

            // Error hesapla
            const actualIndex = n - maxPoints + i;
            if (actualIndex >= 0 && actualIndex < n) {
                totalError += Math.abs(sourceValues[actualIndex] - centerValue);
            }
        }

        // Standard Absolute Error
        const sae = (totalError / maxPoints) * p.multiplier;

        // Sonuçları oluştur
        for (let i = 0; i < centerValues.length; i++) {
            const center = centerValues[i];
            const upper = center + sae;
            const lower = center - sae;

            result.center.push(center);
            result.upper.push(upper);
            result.lower.push(lower);

            // Sinyal kontrolü
            const dataIndex = n - maxPoints + i;
            if (dataIndex >= 0 && dataIndex < n) {
                const currentPrice = sourceValues[dataIndex];
                let signal = null;

                if (currentPrice > upper) {
                    signal = { type: 'sell', price: currentPrice, level: upper, timestamp: data[dataIndex].timestamp };
                } else if (currentPrice < lower) {
                    signal = { type: 'buy', price: currentPrice, level: lower, timestamp: data[dataIndex].timestamp };
                }

                result.signals.push(signal);
            }
        }

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'Nadaraya-Watson repainting hesaplandı', {
            resultLength: result.center.length,
            signalCount: result.signals.filter(s => s !== null).length
        });

        return result;
    }

    /**
     * Bant taşma yüzdesini hesapla
     */
    function calculateBandOverflow(price, upper, lower) {
        if (price > upper) {
            // Üst bant taşması
            const overflow = ((price - upper) / upper) * 100;
            return { direction: 'upper', percentage: overflow };
        } else if (price < lower) {
            // Alt bant taşması  
            const overflow = ((lower - price) / lower) * 100;
            return { direction: 'lower', percentage: overflow };
        }
        
        return { direction: 'none', percentage: 0 };
    }

    /**
     * Multi-timeframe Nadaraya-Watson analizi
     */
    function analyzeMultiTimeframe(multiData, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        const timeframes = ['4h', '1h', '15m'];
        const results = {};

        Logger.info(Logger.CATEGORIES.INDICATORS, 'Multi-timeframe Nadaraya-Watson analizi başlatılıyor');

        for (const tf of timeframes) {
            if (multiData[tf] && multiData[tf].length > 0) {
                try {
                    const nwResult = calculate(multiData[tf], { ...p, repainting: false });
                    const lastIndex = nwResult.center.length - 1;
                    
                    if (lastIndex >= 0) {
                        const lastPrice = extractSource(multiData[tf], p.source);
                        const currentPrice = lastPrice[lastPrice.length - 1];
                        
                        const overflow = calculateBandOverflow(
                            currentPrice,
                            nwResult.upper[lastIndex],
                            nwResult.lower[lastIndex]
                        );

                        results[tf] = {
                            upper: nwResult.upper[lastIndex],
                            lower: nwResult.lower[lastIndex],
                            center: nwResult.center[lastIndex],
                            currentPrice: currentPrice,
                            overflow: overflow,
                            timestamp: multiData[tf][multiData[tf].length - 1].timestamp
                        };

                        Logger.debug(Logger.CATEGORIES.INDICATORS, `Nadaraya-Watson ${tf}:`, {
                            price: currentPrice.toFixed(2),
                            upper: nwResult.upper[lastIndex].toFixed(2),
                            lower: nwResult.lower[lastIndex].toFixed(2),
                            overflow: overflow.percentage.toFixed(2) + '%'
                        });
                    }
                } catch (error) {
                    Logger.error(Logger.CATEGORIES.INDICATORS, `Nadaraya-Watson ${tf} hatası`, error);
                    results[tf] = null;
                }
            }
        }

        return results;
    }

    /**
     * Strateji sinyal kontrolü
     */
    function checkStrategySignals(multiResults) {
        const thresholds = Config.get('STRATEGY.nadaraya.thresholds', {
            '4h': 0.5,
            '1h': 1.0,
            '15m': 2.0
        });

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'Nadaraya-Watson strateji sinyalleri kontrol ediliyor');

        const signals = {
            '4h': null,
            '1h': null,
            '15m': null,
            overall: null
        };

        // Her timeframe için sinyal kontrolü
        for (const [tf, result] of Object.entries(multiResults)) {
            if (result && result.overflow) {
                const threshold = thresholds[tf] || 1.0;
                const overflowPct = result.overflow.percentage;

                if (overflowPct >= threshold) {
                    signals[tf] = {
                        type: result.overflow.direction === 'upper' ? 'short' : 'long',
                        strength: overflowPct,
                        threshold: threshold,
                        timestamp: result.timestamp,
                        price: result.currentPrice,
                        level: result.overflow.direction === 'upper' ? result.upper : result.lower
                    };

                    Logger.info(Logger.CATEGORIES.INDICATORS, `Nadaraya-Watson sinyal: ${tf}`, {
                        type: signals[tf].type,
                        strength: overflowPct.toFixed(2) + '%',
                        threshold: threshold + '%'
                    });
                }
            }
        }

        // Overall sinyal değerlendirmesi
        const validSignals = Object.values(signals).filter(s => s !== null);
        
        if (validSignals.length >= 2) {
            // En az 2 timeframe'de aynı yönde sinyal varsa
            const signalTypes = validSignals.map(s => s.type);
            const longCount = signalTypes.filter(t => t === 'long').length;
            const shortCount = signalTypes.filter(t => t === 'short').length;

            if (longCount > shortCount) {
                signals.overall = {
                    type: 'long',
                    confidence: longCount / validSignals.length,
                    supportingTimeframes: validSignals.filter(s => s.type === 'long').length
                };
            } else if (shortCount > longCount) {
                signals.overall = {
                    type: 'short',
                    confidence: shortCount / validSignals.length,
                    supportingTimeframes: validSignals.filter(s => s.type === 'short').length
                };
            }
        }

        return signals;
    }

    /**
     * Source değerlerini extract et
     */
    function extractSource(data, source) {
        return data.map(candle => {
            switch (source) {
                case 'open': return candle.open;
                case 'high': return candle.high;
                case 'low': return candle.low;
                case 'close': return candle.close;
                case 'hl2': return (candle.high + candle.low) / 2;
                case 'hlc3': return (candle.high + candle.low + candle.close) / 3;
                case 'ohlc4': return (candle.open + candle.high + candle.low + candle.close) / 4;
                default: return candle.close;
            }
        });
    }

    /**
     * Ana hesaplama fonksiyonu
     */
    function calculate(data, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };

        if (p.repainting) {
            return calculateRepainting(data, p);
        } else {
            return calculateEndpoint(data, p);
        }
    }

    /**
     * Crossover/Crossunder sinyalleri
     */
    function detectCrossSignals(data, nwResult, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        const sourceValues = extractSource(data, p.source);
        const signals = [];

        for (let i = 1; i < sourceValues.length && i < nwResult.upper.length; i++) {
            const prevPrice = sourceValues[i - 1];
            const currPrice = sourceValues[i];
            const prevUpper = nwResult.upper[i - 1];
            const currUpper = nwResult.upper[i];
            const prevLower = nwResult.lower[i - 1];
            const currLower = nwResult.lower[i];

            // Crossover (fiyat üst bandı yukarı kırması)
            if (prevPrice <= prevUpper && currPrice > currUpper) {
                signals.push({
                    type: 'crossover',
                    direction: 'short',
                    timestamp: data[i].timestamp,
                    price: currPrice,
                    level: currUpper,
                    index: i
                });
            }

            // Crossunder (fiyat alt bandı aşağı kırması)
            if (prevPrice >= prevLower && currPrice < currLower) {
                signals.push({
                    type: 'crossunder',
                    direction: 'long',
                    timestamp: data[i].timestamp,
                    price: currPrice,
                    level: currLower,
                    index: i
                });
            }
        }

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'Nadaraya-Watson cross signals', {
            signals: signals.length
        });

        return signals;
    }

    /**
     * Real-time hesaplama için optimize edilmiş fonksiyon
     */
    function calculateLive(historicalData, newCandle, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        
        // Son veriyi ekle
        const data = [...historicalData, newCandle];
        
        // Sadece son değeri hesapla (performans için)
        const sourceValues = extractSource(data, p.source);
        const n = sourceValues.length;
        const maxPoints = Math.min(500, n);

        if (n < maxPoints) {
            return null;
        }

        // Son nokta için hesaplama
        const coefs = [];
        let denominator = 0;

        for (let i = 0; i < maxPoints; i++) {
            const weight = gaussianWeight(i, p.bandwidth);
            coefs.push(weight);
            denominator += weight;
        }

        let weightedSum = 0;
        let errorSum = 0;
        const lastIndex = n - 1;

        // Weighted mean
        for (let j = 0; j < maxPoints; j++) {
            const dataIndex = lastIndex - j;
            if (dataIndex >= 0) {
                weightedSum += sourceValues[dataIndex] * coefs[j];
            }
        }

        const centerValue = weightedSum / denominator;

        // MAE
        for (let j = 0; j < maxPoints; j++) {
            const dataIndex = lastIndex - j;
            if (dataIndex >= 0) {
                errorSum += Math.abs(sourceValues[dataIndex] - centerValue);
            }
        }

        const mae = (errorSum / maxPoints) * p.multiplier;

        const result = {
            upper: centerValue + mae,
            lower: centerValue - mae,
            center: centerValue,
            timestamp: newCandle.timestamp
        };

        // Overflow kontrolü
        const currentPrice = sourceValues[lastIndex];
        result.overflow = calculateBandOverflow(currentPrice, result.upper, result.lower);

        return result;
    }

    // Public API
    return {
        // Ana hesaplama fonksiyonları
        calculate: calculate,
        calculateEndpoint: calculateEndpoint,
        calculateRepainting: calculateRepainting,
        calculateLive: calculateLive,

        // Analiz fonksiyonları
        analyzeMultiTimeframe: analyzeMultiTimeframe,
        checkStrategySignals: checkStrategySignals,
        calculateBandOverflow: calculateBandOverflow,
        detectCrossSignals: detectCrossSignals,

        // Utility fonksiyonları
        extractSource: extractSource,
        gaussianWeight: gaussianWeight,

        // Sabitler
        DEFAULT_PARAMS: DEFAULT_PARAMS
    };

})();

// Initialize
if (window.Logger) {
    Logger.info(Logger.CATEGORIES.INDICATORS, 'Nadaraya-Watson indikatörü yüklendi', {
        defaultParams: NadarayaWatson.DEFAULT_PARAMS
    });
}
