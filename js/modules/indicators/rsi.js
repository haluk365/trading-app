/**
 * RSI (RELATIVE STRENGTH INDEX) İNDİKATÖRÜ
 * Backup doğrulama indikatörü - 20 altı/80 üstü threshold'ları
 * Divergence detection ve multi-timeframe analizi
 */

window.RSI = (function() {
    'use strict';

    // Default parametreler
    const DEFAULT_PARAMS = {
        period: 14,
        source: 'close',
        overbought: 80,
        oversold: 20,
        smoothing: 'RMA' // RMA, SMA, EMA
    };

    /**
     * Temel RSI hesaplama (Wilder's method)
     */
    function calculate(data, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        
        if (!data || data.length < p.period + 1) {
            Logger.warning(Logger.CATEGORIES.INDICATORS, 'RSI: Yetersiz veri', {
                required: p.period + 1,
                available: data ? data.length : 0
            });
            return [];
        }

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'RSI hesaplanıyor', {
            dataLength: data.length,
            period: p.period,
            source: p.source
        });

        const sourceValues = extractSource(data, p.source);
        const changes = [];
        const gains = [];
        const losses = [];

        // Fiyat değişimlerini hesapla
        for (let i = 1; i < sourceValues.length; i++) {
            const change = sourceValues[i] - sourceValues[i - 1];
            changes.push(change);
            gains.push(change > 0 ? change : 0);
            losses.push(change < 0 ? Math.abs(change) : 0);
        }

        if (gains.length < p.period) {
            Logger.warning(Logger.CATEGORIES.INDICATORS, 'RSI: Gain/Loss verisi yetersiz');
            return [];
        }

        const rsiValues = [];
        
        // İlk RSI hesaplama (basit ortalama)
        let avgGain = gains.slice(0, p.period).reduce((a, b) => a + b) / p.period;
        let avgLoss = losses.slice(0, p.period).reduce((a, b) => a + b) / p.period;
        
        let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        let rsi = 100 - (100 / (1 + rs));
        rsiValues.push(rsi);

        // Sonraki RSI değerleri (Wilder's smoothing)
        for (let i = p.period; i < gains.length; i++) {
            avgGain = ((avgGain * (p.period - 1)) + gains[i]) / p.period;
            avgLoss = ((avgLoss * (p.period - 1)) + losses[i]) / p.period;
            
            rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            rsi = 100 - (100 / (1 + rs));
            rsiValues.push(rsi);
        }

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'RSI hesaplandı', {
            resultLength: rsiValues.length,
            lastValue: rsiValues[rsiValues.length - 1]?.toFixed(2)
        });

        return rsiValues;
    }

    /**
     * RSI + Moving Average (smoothing)
     */
    function calculateWithMA(data, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        const basicRSI = calculate(data, p);
        
        if (!basicRSI.length || !p.maLength) {
            return { rsi: basicRSI, ma: [] };
        }

        let smoothedRSI = [];
        
        switch (p.smoothing) {
            case 'SMA':
                smoothedRSI = Utils.sma(basicRSI, p.maLength);
                break;
            case 'EMA':
                smoothedRSI = Utils.ema(basicRSI, p.maLength);
                break;
            case 'RMA':
                smoothedRSI = Utils.Math.rma(basicRSI, p.maLength);
                break;
            default:
                smoothedRSI = basicRSI;
        }

        return {
            rsi: basicRSI,
            ma: smoothedRSI
        };
    }

    /**
     * RSI Divergence detection
     */
    function detectDivergence(priceData, rsiValues, params = {}) {
        const p = {
            lookbackLeft: 5,
            lookbackRight: 5,
            rangeUpper: 60,
            rangeLower: 5,
            ...params
        };

        if (!priceData || !rsiValues || priceData.length !== rsiValues.length + DEFAULT_PARAMS.period) {
            Logger.warning(Logger.CATEGORIES.INDICATORS, 'RSI Divergence: Veri uyumsuzluğu');
            return { bullish: [], bearish: [] };
        }

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'RSI Divergence tespit ediliyor');

        const highs = priceData.map(c => c.high);
        const lows = priceData.map(c => c.low);
        
        // Adjustment for RSI data offset
        const adjustedHighs = highs.slice(DEFAULT_PARAMS.period);
        const adjustedLows = lows.slice(DEFAULT_PARAMS.period);

        const pivotHighs = findPivotHighs(rsiValues, p.lookbackLeft, p.lookbackRight);
        const pivotLows = findPivotLows(rsiValues, p.lookbackLeft, p.lookbackRight);
        
        const pricePivotHighs = findPivotHighs(adjustedHighs, p.lookbackLeft, p.lookbackRight);
        const pricePivotLows = findPivotLows(adjustedLows, p.lookbackLeft, p.lookbackRight);

        const bullishDivergences = [];
        const bearishDivergences = [];

        // Bullish divergence (RSI higher low, price lower low)
        for (let i = 1; i < pivotLows.length; i++) {
            const currentRSILow = pivotLows[i];
            const prevRSILow = pivotLows[i - 1];
            
            if (currentRSILow && prevRSILow) {
                const timeDiff = currentRSILow.index - prevRSILow.index;
                
                if (timeDiff >= p.rangeLower && timeDiff <= p.rangeUpper) {
                    // RSI higher low
                    if (currentRSILow.value > prevRSILow.value) {
                        // Find corresponding price lows
                        const currentPriceLow = findNearestPivot(pricePivotLows, currentRSILow.index);
                        const prevPriceLow = findNearestPivot(pricePivotLows, prevRSILow.index);
                        
                        // Price lower low
                        if (currentPriceLow && prevPriceLow && currentPriceLow.value < prevPriceLow.value) {
                            bullishDivergences.push({
                                type: 'bullish',
                                rsiPoints: [prevRSILow, currentRSILow],
                                pricePoints: [prevPriceLow, currentPriceLow],
                                timestamp: priceData[currentRSILow.index + DEFAULT_PARAMS.period]?.timestamp,
                                strength: calculateDivergenceStrength(currentRSILow.value - prevRSILow.value, 
                                                                   prevPriceLow.value - currentPriceLow.value)
                            });
                        }
                    }
                }
            }
        }

        // Bearish divergence (RSI lower high, price higher high)
        for (let i = 1; i < pivotHighs.length; i++) {
            const currentRSIHigh = pivotHighs[i];
            const prevRSIHigh = pivotHighs[i - 1];
            
            if (currentRSIHigh && prevRSIHigh) {
                const timeDiff = currentRSIHigh.index - prevRSIHigh.index;
                
                if (timeDiff >= p.rangeLower && timeDiff <= p.rangeUpper) {
                    // RSI lower high
                    if (currentRSIHigh.value < prevRSIHigh.value) {
                        // Find corresponding price highs
                        const currentPriceHigh = findNearestPivot(pricePivotHighs, currentRSIHigh.index);
                        const prevPriceHigh = findNearestPivot(pricePivotHighs, prevRSIHigh.index);
                        
                        // Price higher high
                        if (currentPriceHigh && prevPriceHigh && currentPriceHigh.value > prevPriceHigh.value) {
                            bearishDivergences.push({
                                type: 'bearish',
                                rsiPoints: [prevRSIHigh, currentRSIHigh],
                                pricePoints: [prevPriceHigh, currentPriceHigh],
                                timestamp: priceData[currentRSIHigh.index + DEFAULT_PARAMS.period]?.timestamp,
                                strength: calculateDivergenceStrength(prevRSIHigh.value - currentRSIHigh.value,
                                                                   currentPriceHigh.value - prevPriceHigh.value)
                            });
                        }
                    }
                }
            }
        }

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'RSI Divergence tespit edildi', {
            bullish: bullishDivergences.length,
            bearish: bearishDivergences.length
        });

        return {
            bullish: bullishDivergences,
            bearish: bearishDivergences
        };
    }

    /**
     * Multi-timeframe RSI analizi
     */
    function analyzeMultiTimeframe(multiData, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        const timeframes = ['4h', '1h', '15m'];
        const results = {};

        Logger.info(Logger.CATEGORIES.INDICATORS, 'Multi-timeframe RSI analizi başlatılıyor');

        for (const tf of timeframes) {
            if (multiData[tf] && multiData[tf].length > p.period + 1) {
                try {
                    const rsiValues = calculate(multiData[tf], p);
                    const lastRSI = rsiValues[rsiValues.length - 1];
                    
                    // Divergence analysis
                    const divergence = detectDivergence(multiData[tf], rsiValues, p);
                    
                    // Recent divergences (son 20 bar)
                    const recentBullish = divergence.bullish.filter(d => 
                        d.rsiPoints[1].index >= rsiValues.length - 20
                    );
                    const recentBearish = divergence.bearish.filter(d => 
                        d.rsiPoints[1].index >= rsiValues.length - 20
                    );

                    results[tf] = {
                        value: lastRSI,
                        level: classifyRSILevel(lastRSI, p),
                        signal: generateRSISignal(lastRSI, p),
                        divergence: {
                            bullish: recentBullish,
                            bearish: recentBearish,
                            hasRecent: recentBullish.length > 0 || recentBearish.length > 0
                        },
                        timestamp: multiData[tf][multiData[tf].length - 1].timestamp
                    };

                    Logger.debug(Logger.CATEGORIES.INDICATORS, `RSI ${tf}:`, {
                        value: lastRSI.toFixed(2),
                        level: results[tf].level,
                        divergences: `${recentBullish.length}B/${recentBearish.length}Bear`
                    });

                } catch (error) {
                    Logger.error(Logger.CATEGORIES.INDICATORS, `RSI ${tf} hatası`, error);
                    results[tf] = null;
                }
            }
        }

        return results;
    }

    /**
     * Strateji backup doğrulama kontrolü
     */
    function checkBackupConfirmation(multiResults) {
        const confirmations = {
            '4h': null,
            '1h': null,
            '15m': null,
            overall: null
        };

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'RSI backup confirmation kontrol ediliyor');

        let longConfirmations = 0;
        let shortConfirmations = 0;

        for (const [tf, result] of Object.entries(multiResults)) {
            if (result && result.signal) {
                confirmations[tf] = {
                    signal: result.signal,
                    value: result.value,
                    level: result.level,
                    hasDivergence: result.divergence.hasRecent,
                    timestamp: result.timestamp
                };

                if (result.signal === 'oversold') {
                    longConfirmations++;
                } else if (result.signal === 'overbought') {
                    shortConfirmations++;
                }

                Logger.debug(Logger.CATEGORIES.INDICATORS, `RSI backup ${tf}:`, {
                    signal: result.signal,
                    value: result.value.toFixed(2),
                    divergence: result.divergence.hasRecent
                });
            }
        }

        // Overall confirmation
        if (longConfirmations >= 2) {
            confirmations.overall = {
                type: 'long',
                strength: longConfirmations,
                confidence: longConfirmations / 3
            };
        } else if (shortConfirmations >= 2) {
            confirmations.overall = {
                type: 'short',
                strength: shortConfirmations,
                confidence: shortConfirmations / 3
            };
        }

        return confirmations;
    }

    /**
     * RSI seviyesini sınıflandır
     */
    function classifyRSILevel(rsi, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        
        if (rsi >= p.overbought) return 'overbought';
        if (rsi <= p.oversold) return 'oversold';
        if (rsi > 70) return 'high';
        if (rsi < 30) return 'low';
        if (rsi > 50) return 'bullish';
        return 'bearish';
    }

    /**
     * RSI sinyali üret
     */
    function generateRSISignal(rsi, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        
        if (rsi <= p.oversold) return 'oversold';
        if (rsi >= p.overbought) return 'overbought';
        return 'neutral';
    }

    /**
     * Pivot high'ları bul
     */
    function findPivotHighs(data, leftBars, rightBars) {
        const pivots = [];
        
        for (let i = leftBars; i < data.length - rightBars; i++) {
            let isPivot = true;
            const centerValue = data[i];
            
            // Sol taraf kontrolü
            for (let j = i - leftBars; j < i; j++) {
                if (data[j] >= centerValue) {
                    isPivot = false;
                    break;
                }
            }
            
            // Sağ taraf kontrolü
            if (isPivot) {
                for (let j = i + 1; j <= i + rightBars; j++) {
                    if (data[j] >= centerValue) {
                        isPivot = false;
                        break;
                    }
                }
            }
            
            if (isPivot) {
                pivots.push({
                    index: i,
                    value: centerValue
                });
            }
        }
        
        return pivots;
    }

    /**
     * Pivot low'ları bul
     */
    function findPivotLows(data, leftBars, rightBars) {
        const pivots = [];
        
        for (let i = leftBars; i < data.length - rightBars; i++) {
            let isPivot = true;
            const centerValue = data[i];
            
            // Sol taraf kontrolü
            for (let j = i - leftBars; j < i; j++) {
                if (data[j] <= centerValue) {
                    isPivot = false;
                    break;
                }
            }
            
            // Sağ taraf kontrolü
            if (isPivot) {
                for (let j = i + 1; j <= i + rightBars; j++) {
                    if (data[j] <= centerValue) {
                        isPivot = false;
                        break;
                    }
                }
            }
            
            if (isPivot) {
                pivots.push({
                    index: i,
                    value: centerValue
                });
            }
        }
        
        return pivots;
    }

    /**
     * En yakın pivot'u bul
     */
    function findNearestPivot(pivots, targetIndex) {
        let nearest = null;
        let minDistance = Infinity;
        
        for (const pivot of pivots) {
            const distance = Math.abs(pivot.index - targetIndex);
            if (distance < minDistance && distance <= 5) { // Max 5 bar tolerance
                minDistance = distance;
                nearest = pivot;
            }
        }
        
        return nearest;
    }

    /**
     * Divergence strength hesapla
     */
    function calculateDivergenceStrength(rsiDiff, priceDiff) {
        // Normalize edilmiş divergence strength (0-1)
        const rsiNorm = Math.abs(rsiDiff) / 100;
        const priceNorm = Math.min(Math.abs(priceDiff) / 1000, 1); // Assuming max 1000 price units
        
        return (rsiNorm + priceNorm) / 2;
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
     * Real-time RSI hesaplama
     */
    function calculateLive(historicalData, newCandle, rsiHistory, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        
        if (!rsiHistory || rsiHistory.length < 1) {
            // İlk hesaplama
            const data = [...historicalData, newCandle];
            const rsi = calculate(data, p);
            return rsi[rsi.length - 1];
        }
        
        // Incremental update
        const lastPrice = extractSource([historicalData[historicalData.length - 1]], p.source)[0];
        const currentPrice = extractSource([newCandle], p.source)[0];
        
        const change = currentPrice - lastPrice;
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;
        
        // Son avgGain ve avgLoss değerlerini al (aproximation)
        const lastRSI = rsiHistory[rsiHistory.length - 1];
        const rs = (100 - lastRSI) / lastRSI * 100;
        
        let avgGain = rs / (1 + rs);
        let avgLoss = 1 / (1 + rs);
        
        // Wilder's smoothing
        avgGain = ((avgGain * (p.period - 1)) + gain) / p.period;
        avgLoss = ((avgLoss * (p.period - 1)) + loss) / p.period;
        
        const newRS = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const newRSI = 100 - (100 / (1 + newRS));
        
        return newRSI;
    }

    // Public API
    return {
        // Ana hesaplama fonksiyonları
        calculate: calculate,
        calculateWithMA: calculateWithMA,
        calculateLive: calculateLive,
        
        // Divergence analizi
        detectDivergence: detectDivergence,
        
        // Multi-timeframe analiz
        analyzeMultiTimeframe: analyzeMultiTimeframe,
        checkBackupConfirmation: checkBackupConfirmation,
        
        // Utility fonksiyonları
        classifyRSILevel: classifyRSILevel,
        generateRSISignal: generateRSISignal,
        extractSource: extractSource,
        
        // Pivot fonksiyonları
        findPivotHighs: findPivotHighs,
        findPivotLows: findPivotLows,
        
        // Sabitler
        DEFAULT_PARAMS: DEFAULT_PARAMS
    };

})();

// Initialize
if (window.Logger) {
    Logger.info(Logger.CATEGORIES.INDICATORS, 'RSI indikatörü yüklendi', {
        defaultParams: RSI.DEFAULT_PARAMS
    });
}
