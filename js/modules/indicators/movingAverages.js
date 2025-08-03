/**
 * MOVING AVERAGES İNDİKATÖRÜ
 * MA7, MA25, MA99 - Aralık kontrolü ve sıralama analizi
 * Reversal detection ve trend confirmation
 */

window.MovingAverages = (function() {
    'use strict';

    // Default parametreler
    const DEFAULT_PARAMS = {
        periods: [7, 25, 99],
        type: 'SMA', // SMA, EMA, WMA, RMA
        source: 'close',
        gapThresholds: {
            'ma99_ma25': 5.0,  // %5
            'ma25_ma7': 5.0,   // %5
            'ma7_price': 3.0   // %3
        }
    };

    /**
     * Multiple Moving Averages hesaplama
     */
    function calculate(data, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        
        if (!data || data.length < Math.max(...p.periods)) {
            Logger.warning(Logger.CATEGORIES.INDICATORS, 'MA: Yetersiz veri', {
                required: Math.max(...p.periods),
                available: data ? data.length : 0
            });
            return {};
        }

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'Moving Averages hesaplanıyor', {
            dataLength: data.length,
            periods: p.periods,
            type: p.type
        });

        const sourceValues = extractSource(data, p.source);
        const results = {};

        for (const period of p.periods) {
            const maKey = `ma${period}`;
            
            switch (p.type.toUpperCase()) {
                case 'SMA':
                    results[maKey] = Utils.sma(sourceValues, period);
                    break;
                case 'EMA':
                    results[maKey] = Utils.ema(sourceValues, period);
                    break;
                case 'WMA':
                    results[maKey] = calculateWMA(sourceValues, period);
                    break;
                case 'RMA':
                    results[maKey] = Utils.Math.rma(sourceValues, period);
                    break;
                default:
                    results[maKey] = Utils.sma(sourceValues, period);
            }

            Logger.debug(Logger.CATEGORIES.INDICATORS, `${p.type}${period} hesaplandı`, {
                length: results[maKey].length,
                lastValue: results[maKey][results[maKey].length - 1]?.toFixed(2)
            });
        }

        // Alignment için en kısa array uzunluğunu bul
        const minLength = Math.min(...Object.values(results).map(arr => arr.length));
        
        // Tüm MA'ları aynı uzunlukta hizala
        for (const key of Object.keys(results)) {
            results[key] = results[key].slice(-minLength);
        }

        return results;
    }

    /**
     * Weighted Moving Average hesaplama
     */
    function calculateWMA(data, period) {
        if (data.length < period) return [];
        
        const result = [];
        const weight = period * (period + 1) / 2;
        
        for (let i = period - 1; i < data.length; i++) {
            let sum = 0;
            for (let j = 0; j < period; j++) {
                sum += data[i - j] * (period - j);
            }
            result.push(sum / weight);
        }
        
        return result;
    }

    /**
     * MA aralıklarını (gap'leri) hesapla
     */
    function calculateGaps(maData, currentPrice, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        
        if (!maData.ma7 || !maData.ma25 || !maData.ma99) {
            Logger.warning(Logger.CATEGORIES.INDICATORS, 'MA Gap: Eksik MA verisi');
            return null;
        }

        const lastIndex = maData.ma7.length - 1;
        if (lastIndex < 0) return null;

        const ma7 = maData.ma7[lastIndex];
        const ma25 = maData.ma25[lastIndex];
        const ma99 = maData.ma99[lastIndex];

        // Yüzdelik gap'leri hesapla
        const gaps = {
            ma99_ma25: calculatePercentageGap(ma99, ma25),
            ma25_ma7: calculatePercentageGap(ma25, ma7),
            ma7_price: calculatePercentageGap(ma7, currentPrice),
            overall: 0
        };

        // Overall gap (total separation)
        gaps.overall = Math.abs(ma99 - currentPrice) / Math.min(ma99, currentPrice) * 100;

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'MA Gaps hesaplandı', {
            ma99_ma25: gaps.ma99_ma25.toFixed(2) + '%',
            ma25_ma7: gaps.ma25_ma7.toFixed(2) + '%',
            ma7_price: gaps.ma7_price.toFixed(2) + '%',
            overall: gaps.overall.toFixed(2) + '%'
        });

        return gaps;
    }

    /**
     * MA sıralamasını kontrol et
     */
    function checkAlignment(maData, currentPrice, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        
        if (!maData.ma7 || !maData.ma25 || !maData.ma99) {
            return null;
        }

        const lastIndex = maData.ma7.length - 1;
        if (lastIndex < 0) return null;

        const ma7 = maData.ma7[lastIndex];
        const ma25 = maData.ma25[lastIndex];
        const ma99 = maData.ma99[lastIndex];

        // Mevcut sıralama
        const values = [
            { name: 'price', value: currentPrice },
            { name: 'ma7', value: ma7 },
            { name: 'ma25', value: ma25 },
            { name: 'ma99', value: ma99 }
        ];

        // Büyükten küçüğe sırala
        values.sort((a, b) => b.value - a.value);
        const currentOrder = values.map(v => v.name);

        // İdeal sıralamalar
        const bullishOrder = ['ma7', 'ma25', 'ma99', 'price'];  // MA7 > MA25 > MA99 > Price
        const bearishOrder = ['price', 'ma7', 'ma25', 'ma99'];  // Price > MA7 > MA25 > MA99

        const alignment = {
            current: currentOrder,
            isBullish: arraysEqual(currentOrder, bullishOrder),
            isBearish: arraysEqual(currentOrder, bearishOrder),
            isNeutral: false,
            score: 0
        };

        // Alignment score hesapla (0-100)
        alignment.score = calculateAlignmentScore(currentOrder, bullishOrder, bearishOrder);
        alignment.isNeutral = !alignment.isBullish && !alignment.isBearish && alignment.score < 50;

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'MA Alignment kontrol edildi', {
            order: currentOrder.join(' > '),
            bullish: alignment.isBullish,
            bearish: alignment.isBearish,
            score: alignment.score
        });

        return alignment;
    }

    /**
     * Reversal sinyali kontrolü
     */
    function checkReversalSignal(maData, currentPrice, gaps, alignment, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        
        if (!gaps || !alignment) {
            return null;
        }

        const thresholds = p.gapThresholds;
        
        // Gap kontrolü - tüm gap'ler threshold'u geçiyor mu?
        const gapConditions = {
            ma99_ma25: gaps.ma99_ma25 >= thresholds.ma99_ma25,
            ma25_ma7: gaps.ma25_ma7 >= thresholds.ma25_ma7,
            ma7_price: gaps.ma7_price >= thresholds.ma7_price
        };

        const allGapsValid = Object.values(gapConditions).every(condition => condition);

        // Sıralama kontrolü
        const hasCorrectAlignment = alignment.isBullish || alignment.isBearish;

        const reversal = {
            isValid: allGapsValid && hasCorrectAlignment,
            direction: null,
            strength: 0,
            gapConditions: gapConditions,
            alignment: alignment.current,
            confidence: 0
        };

        if (reversal.isValid) {
            // Reversal yönünü belirle
            if (alignment.isBullish) {
                reversal.direction = 'bearish'; // Bullish alignment = bearish reversal beklentisi
            } else if (alignment.isBearish) {
                reversal.direction = 'bullish'; // Bearish alignment = bullish reversal beklentisi
            }

            // Strength hesapla (gap büyüklüğü + alignment score)
            const avgGap = (gaps.ma99_ma25 + gaps.ma25_ma7 + gaps.ma7_price) / 3;
            reversal.strength = Math.min(avgGap / 10, 10); // 0-10 scale

            // Confidence hesapla
            const gapScore = Object.values(gapConditions).filter(c => c).length / 3;
            const alignmentScore = alignment.score / 100;
            reversal.confidence = (gapScore + alignmentScore) / 2;

            Logger.info(Logger.CATEGORIES.INDICATORS, 'MA Reversal sinyali tespit edildi', {
                direction: reversal.direction,
                strength: reversal.strength.toFixed(2),
                confidence: (reversal.confidence * 100).toFixed(1) + '%'
            });
        }

        return reversal;
    }

    /**
     * Multi-timeframe MA analizi
     */
    function analyzeMultiTimeframe(multiData, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        const timeframes = ['4h', '1h', '15m'];
        const results = {};

        Logger.info(Logger.CATEGORIES.INDICATORS, 'Multi-timeframe MA analizi başlatılıyor');

        for (const tf of timeframes) {
            if (multiData[tf] && multiData[tf].length > Math.max(...p.periods)) {
                try {
                    const maData = calculate(multiData[tf], p);
                    const lastPrice = extractSource(multiData[tf], p.source);
                    const currentPrice = lastPrice[lastPrice.length - 1];
                    
                    const gaps = calculateGaps(maData, currentPrice, p);
                    const alignment = checkAlignment(maData, currentPrice, p);
                    const reversal = checkReversalSignal(maData, currentPrice, gaps, alignment, p);

                    results[tf] = {
                        ma7: maData.ma7[maData.ma7.length - 1],
                        ma25: maData.ma25[maData.ma25.length - 1],
                        ma99: maData.ma99[maData.ma99.length - 1],
                        currentPrice: currentPrice,
                        gaps: gaps,
                        alignment: alignment,
                        reversal: reversal,
                        timestamp: multiData[tf][multiData[tf].length - 1].timestamp
                    };

                    Logger.debug(Logger.CATEGORIES.INDICATORS, `MA ${tf}:`, {
                        ma7: maData.ma7[maData.ma7.length - 1].toFixed(2),
                        ma25: maData.ma25[maData.ma25.length - 1].toFixed(2),
                        ma99: maData.ma99[maData.ma99.length - 1].toFixed(2),
                        alignment: alignment ? alignment.current.join('>') : 'none'
                    });

                } catch (error) {
                    Logger.error(Logger.CATEGORIES.INDICATORS, `MA ${tf} hatası`, error);
                    results[tf] = null;
                }
            }
        }

        return results;
    }

    /**
     * Strateji doğrulama kontrolü
     */
    function checkStrategyConfirmation(multiResults) {
        const confirmations = {
            '4h': null,
            '1h': null,
            '15m': null,
            overall: null
        };

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'MA strateji doğrulaması kontrol ediliyor');

        let bullishReversals = 0;
        let bearishReversals = 0;
        let totalConfidence = 0;
        let validResults = 0;

        for (const [tf, result] of Object.entries(multiResults)) {
            if (result && result.reversal && result.reversal.isValid) {
                confirmations[tf] = {
                    direction: result.reversal.direction,
                    strength: result.reversal.strength,
                    confidence: result.reversal.confidence,
                    gaps: result.gaps,
                    alignment: result.alignment.current,
                    timestamp: result.timestamp
                };

                if (result.reversal.direction === 'bullish') {
                    bullishReversals++;
                } else if (result.reversal.direction === 'bearish') {
                    bearishReversals++;
                }

                totalConfidence += result.reversal.confidence;
                validResults++;

                Logger.debug(Logger.CATEGORIES.INDICATORS, `MA confirmation ${tf}:`, {
                    direction: result.reversal.direction,
                    confidence: (result.reversal.confidence * 100).toFixed(1) + '%'
                });
            }
        }

        // Overall confirmation
        if (validResults >= 2) {
            const avgConfidence = totalConfidence / validResults;
            
            if (bullishReversals > bearishReversals) {
                confirmations.overall = {
                    type: 'bullish',
                    strength: bullishReversals,
                    confidence: avgConfidence,
                    supportingTimeframes: bullishReversals
                };
            } else if (bearishReversals > bullishReversals) {
                confirmations.overall = {
                    type: 'bearish',
                    strength: bearishReversals,
                    confidence: avgConfidence,
                    supportingTimeframes: bearishReversals
                };
            }
        }

        return confirmations;
    }

    /**
     * Trend direction belirleme
     */
    function getTrendDirection(maData, currentPrice, params = {}) {
        if (!maData.ma7 || !maData.ma25 || !maData.ma99) {
            return 'neutral';
        }

        const lastIndex = maData.ma7.length - 1;
        if (lastIndex < 2) return 'neutral';

        const ma7Current = maData.ma7[lastIndex];
        const ma25Current = maData.ma25[lastIndex];
        const ma99Current = maData.ma99[lastIndex];

        const ma7Prev = maData.ma7[lastIndex - 1];
        const ma25Prev = maData.ma25[lastIndex - 1];
        const ma99Prev = maData.ma99[lastIndex - 1];

        // MA yönleri
        const ma7Rising = ma7Current > ma7Prev;
        const ma25Rising = ma25Current > ma25Prev;
        const ma99Rising = ma99Current > ma99Prev;

        // Price position
        const priceAboveMA99 = currentPrice > ma99Current;
        const priceAboveMA25 = currentPrice > ma25Current;
        const priceAboveMA7 = currentPrice > ma7Current;

        // Trend score calculation
        let trendScore = 0;
        
        if (ma7Rising) trendScore += 1;
        if (ma25Rising) trendScore += 2;
        if (ma99Rising) trendScore += 3;
        if (priceAboveMA7) trendScore += 1;
        if (priceAboveMA25) trendScore += 2;
        if (priceAboveMA99) trendScore += 3;

        // Total possible score: 12
        if (trendScore >= 9) return 'strong_bullish';
        if (trendScore >= 6) return 'bullish';
        if (trendScore >= 4) return 'weak_bullish';
        if (trendScore >= -3) return 'neutral';
        if (trendScore >= -6) return 'weak_bearish';
        if (trendScore >= -9) return 'bearish';
        return 'strong_bearish';
    }

    /**
     * Yüzdelik gap hesaplama
     */
    function calculatePercentageGap(value1, value2) {
        const reference = Math.min(value1, value2);
        return Math.abs(value1 - value2) / reference * 100;
    }

    /**
     * Array eşitlik kontrolü
     */
    function arraysEqual(arr1, arr2) {
        return arr1.length === arr2.length && arr1.every((val, i) => val === arr2[i]);
    }

    /**
     * Alignment score hesaplama
     */
    function calculateAlignmentScore(current, bullish, bearish) {
        const bullishMatches = current.filter((item, index) => item === bullish[index]).length;
        const bearishMatches = current.filter((item, index) => item === bearish[index]).length;
        
        const maxMatches = Math.max(bullishMatches, bearishMatches);
        return (maxMatches / current.length) * 100;
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
     * Real-time MA hesaplama
     */
    function calculateLive(historicalData, newCandle, maHistory, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        
        // Yeni veriyi ekle
        const data = [...historicalData, newCandle];
        const sourceValues = extractSource(data, p.source);
        
        const results = {};
        
        for (const period of p.periods) {
            const maKey = `ma${period}`;
            
            if (maHistory && maHistory[maKey] && maHistory[maKey].length > 0) {
                // Incremental update
                let newMA;
                const lastMA = maHistory[maKey][maHistory[maKey].length - 1];
                const currentPrice = sourceValues[sourceValues.length - 1];
                const oldPrice = sourceValues[sourceValues.length - period - 1];
                
                switch (p.type.toUpperCase()) {
                    case 'SMA':
                        newMA = lastMA + (currentPrice - oldPrice) / period;
                        break;
                    case 'EMA':
                        const multiplier = 2 / (period + 1);
                        newMA = (currentPrice * multiplier) + (lastMA * (1 - multiplier));
                        break;
                    default:
                        // Fallback to full calculation
                        const fullMA = calculate(data, { ...p, periods: [period] });
                        newMA = fullMA[maKey][fullMA[maKey].length - 1];
                }
                
                results[maKey] = newMA;
            } else {
                // Full calculation
                const fullMA = calculate(data, { ...p, periods: [period] });
                results[maKey] = fullMA[maKey][fullMA[maKey].length - 1];
            }
        }
        
        return results;
    }

    // Public API
    return {
        // Ana hesaplama fonksiyonları
        calculate: calculate,
        calculateLive: calculateLive,
        calculateWMA: calculateWMA,
        
        // Analiz fonksiyonları
        calculateGaps: calculateGaps,
        checkAlignment: checkAlignment,
        checkReversalSignal: checkReversalSignal,
        getTrendDirection: getTrendDirection,
        
        // Multi-timeframe analiz
        analyzeMultiTimeframe: analyzeMultiTimeframe,
        checkStrategyConfirmation: checkStrategyConfirmation,
        
        // Utility fonksiyonları
        extractSource: extractSource,
        calculatePercentageGap: calculatePercentageGap,
        
        // Sabitler
        DEFAULT_PARAMS: DEFAULT_PARAMS
    };

})();

// Initialize
if (window.Logger) {
    Logger.info(Logger.CATEGORIES.INDICATORS, 'Moving Averages indikatörü yüklendi', {
        defaultParams: MovingAverages.DEFAULT_PARAMS
    });
}
