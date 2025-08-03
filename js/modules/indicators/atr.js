/**
 * ATR (AVERAGE TRUE RANGE) İNDİKATÖRÜ
 * Stop-loss hesaplama için kullanılır
 * True Range hesaplama ve smoothing
 */

window.ATR = (function() {
    'use strict';

    // Default parametreler
    const DEFAULT_PARAMS = {
        period: 14,
        smoothing: 'RMA', // RMA, SMA, EMA, WMA
        multiplier: 1.5
    };

    /**
     * True Range hesaplama
     */
    function calculateTrueRange(high, low, previousClose) {
        const tr1 = high - low;
        const tr2 = Math.abs(high - previousClose);
        const tr3 = Math.abs(low - previousClose);
        
        return Math.max(tr1, tr2, tr3);
    }

    /**
     * ATR hesaplama
     */
    function calculate(data, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        
        if (!data || data.length < p.period + 1) {
            Logger.warning(Logger.CATEGORIES.INDICATORS, 'ATR: Yetersiz veri', {
                required: p.period + 1,
                available: data ? data.length : 0
            });
            return [];
        }

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'ATR hesaplanıyor', {
            dataLength: data.length,
            period: p.period,
            smoothing: p.smoothing
        });

        const trueRanges = [];
        
        // True Range değerlerini hesapla
        for (let i = 1; i < data.length; i++) {
            const high = parseFloat(data[i].high);
            const low = parseFloat(data[i].low);
            const prevClose = parseFloat(data[i - 1].close);
            
            const tr = calculateTrueRange(high, low, prevClose);
            trueRanges.push(tr);
        }

        if (trueRanges.length < p.period) {
            Logger.warning(Logger.CATEGORIES.INDICATORS, 'ATR: TR verisi yetersiz');
            return [];
        }

        // ATR smoothing
        let atrValues = [];
        
        switch (p.smoothing.toUpperCase()) {
            case 'SMA':
                atrValues = Utils.sma(trueRanges, p.period);
                break;
            case 'EMA':
                atrValues = Utils.ema(trueRanges, p.period);
                break;
            case 'WMA':
                atrValues = calculateWMA(trueRanges, p.period);
                break;
            case 'RMA':
            default:
                atrValues = Utils.Math.rma(trueRanges, p.period);
                break;
        }

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'ATR hesaplandı', {
            resultLength: atrValues.length,
            lastValue: atrValues[atrValues.length - 1]?.toFixed(4)
        });

        return atrValues;
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
     * Stop-loss seviyeleri hesaplama
     */
    function calculateStopLoss(data, atrValues, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        
        if (!data || !atrValues || data.length === 0 || atrValues.length === 0) {
            Logger.warning(Logger.CATEGORIES.INDICATORS, 'ATR Stop-Loss: Eksik veri');
            return { long: [], short: [] };
        }

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'ATR Stop-Loss hesaplanıyor', {
            multiplier: p.multiplier
        });

        const result = {
            long: [],    // Long stop-loss (Low - ATR * multiplier)
            short: [],   // Short stop-loss (High + ATR * multiplier)
            levels: []   // Detaylı bilgi
        };

        // ATR değerleri data'dan 1 index geride olduğu için hizalama
        const startIndex = data.length - atrValues.length;
        
        for (let i = 0; i < atrValues.length; i++) {
            const dataIndex = startIndex + i;
            if (dataIndex >= 0 && dataIndex < data.length) {
                const candle = data[dataIndex];
                const atr = atrValues[i];
                const atrDistance = atr * p.multiplier;
                
                const longStopLoss = parseFloat(candle.low) - atrDistance;
                const shortStopLoss = parseFloat(candle.high) + atrDistance;
                
                result.long.push(longStopLoss);
                result.short.push(shortStopLoss);
                result.levels.push({
                    timestamp: candle.timestamp,
                    high: parseFloat(candle.high),
                    low: parseFloat(candle.low),
                    close: parseFloat(candle.close),
                    atr: atr,
                    atrDistance: atrDistance,
                    longStopLoss: longStopLoss,
                    shortStopLoss: shortStopLoss
                });
            }
        }

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'ATR Stop-Loss hesaplandı', {
            resultLength: result.long.length,
            lastLong: result.long[result.long.length - 1]?.toFixed(2),
            lastShort: result.short[result.short.length - 1]?.toFixed(2)
        });

        return result;
    }

    /**
     * Dinamik stop-loss hesaplama (pozisyon açıldıktan sonra)
     */
    function calculateDynamicStopLoss(entryPrice, currentPrice, currentATR, direction, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        
        if (!entryPrice || !currentPrice || !currentATR) {
            Logger.warning(Logger.CATEGORIES.INDICATORS, 'Dynamic Stop-Loss: Eksik parametreler');
            return null;
        }

        const atrDistance = currentATR * p.multiplier;
        let stopLoss;
        
        if (direction === 'long') {
            // Long position: stop-loss altında
            stopLoss = currentPrice - atrDistance;
        } else if (direction === 'short') {
            // Short position: stop-loss üstte
            stopLoss = currentPrice + atrDistance;
        } else {
            Logger.error(Logger.CATEGORIES.INDICATORS, 'Dynamic Stop-Loss: Geçersiz direction', { direction });
            return null;
        }

        const result = {
            entryPrice: entryPrice,
            currentPrice: currentPrice,
            atr: currentATR,
            atrDistance: atrDistance,
            stopLoss: stopLoss,
            direction: direction,
            riskAmount: Math.abs(entryPrice - stopLoss),
            riskPercentage: (Math.abs(entryPrice - stopLoss) / entryPrice) * 100
        };

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'Dynamic Stop-Loss hesaplandı', {
            direction: direction,
            entry: entryPrice.toFixed(2),
            current: currentPrice.toFixed(2),
            stopLoss: stopLoss.toFixed(2),
            risk: result.riskPercentage.toFixed(2) + '%'
        });

        return result;
    }

    /**
     * Trailing stop-loss hesaplama
     */
    function calculateTrailingStopLoss(entryPrice, currentPrice, highestProfit, currentStopLoss, currentATR, direction, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        const trailingPercent = Config.get('STRATEGY.risk.trailingStopPercentage', 30.0);
        
        if (!entryPrice || !currentPrice || !currentATR || !direction) {
            Logger.warning(Logger.CATEGORIES.INDICATORS, 'Trailing Stop-Loss: Eksik parametreler');
            return null;
        }

        // Mevcut kar/zarar hesapla
        let currentPnL;
        if (direction === 'long') {
            currentPnL = currentPrice - entryPrice;
        } else {
            currentPnL = entryPrice - currentPrice;
        }

        const currentPnLPercentage = (currentPnL / entryPrice) * 100;
        const initialRisk = Math.abs(entryPrice - currentStopLoss);
        const triggerPoint = initialRisk * 2; // 2x kar etince trailing başlat

        let newStopLoss = currentStopLoss;
        let isTrailingActive = false;

        // Trailing stop aktif mi kontrolü
        if (Math.abs(currentPnL) >= triggerPoint) {
            isTrailingActive = true;
            
            // Trailing distance hesapla
            const profitFromEntry = Math.abs(currentPnL);
            const trailingDistance = profitFromEntry * (trailingPercent / 100);
            
            if (direction === 'long') {
                const proposedStopLoss = currentPrice - trailingDistance;
                newStopLoss = Math.max(proposedStopLoss, currentStopLoss);
            } else {
                const proposedStopLoss = currentPrice + trailingDistance;
                newStopLoss = Math.min(proposedStopLoss, currentStopLoss);
            }
        }

        const result = {
            entryPrice: entryPrice,
            currentPrice: currentPrice,
            currentStopLoss: currentStopLoss,
            newStopLoss: newStopLoss,
            direction: direction,
            currentPnL: currentPnL,
            currentPnLPercentage: currentPnLPercentage,
            isTrailingActive: isTrailingActive,
            triggerPoint: triggerPoint,
            stopLossUpdated: newStopLoss !== currentStopLoss,
            atr: currentATR
        };

        if (result.stopLossUpdated) {
            Logger.info(Logger.CATEGORIES.INDICATORS, 'Trailing Stop-Loss güncellendi', {
                direction: direction,
                oldSL: currentStopLoss.toFixed(2),
                newSL: newStopLoss.toFixed(2),
                pnl: currentPnLPercentage.toFixed(2) + '%'
            });
        }

        return result;
    }

    /**
     * Multi-timeframe ATR analizi
     */
    function analyzeMultiTimeframe(multiData, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        const timeframes = ['4h', '1h', '15m'];
        const results = {};

        Logger.info(Logger.CATEGORIES.INDICATORS, 'Multi-timeframe ATR analizi başlatılıyor');

        for (const tf of timeframes) {
            if (multiData[tf] && multiData[tf].length > p.period + 1) {
                try {
                    const atrValues = calculate(multiData[tf], p);
                    const stopLossLevels = calculateStopLoss(multiData[tf], atrValues, p);
                    
                    const lastATR = atrValues[atrValues.length - 1];
                    const lastCandle = multiData[tf][multiData[tf].length - 1];
                    const lastLongSL = stopLossLevels.long[stopLossLevels.long.length - 1];
                    const lastShortSL = stopLossLevels.short[stopLossLevels.short.length - 1];

                    // ATR volatilite seviyesi
                    const priceLevel = parseFloat(lastCandle.close);
                    const atrPercentage = (lastATR / priceLevel) * 100;
                    
                    let volatilityLevel;
                    if (atrPercentage < 1) volatilityLevel = 'low';
                    else if (atrPercentage < 2) volatilityLevel = 'normal';
                    else if (atrPercentage < 4) volatilityLevel = 'high';
                    else volatilityLevel = 'extreme';

                    results[tf] = {
                        atr: lastATR,
                        atrPercentage: atrPercentage,
                        volatilityLevel: volatilityLevel,
                        longStopLoss: lastLongSL,
                        shortStopLoss: lastShortSL,
                        stopLossDistance: lastATR * p.multiplier,
                        currentPrice: priceLevel,
                        timestamp: lastCandle.timestamp
                    };

                    Logger.debug(Logger.CATEGORIES.INDICATORS, `ATR ${tf}:`, {
                        atr: lastATR.toFixed(4),
                        percentage: atrPercentage.toFixed(2) + '%',
                        volatility: volatilityLevel,
                        longSL: lastLongSL.toFixed(2),
                        shortSL: lastShortSL.toFixed(2)
                    });

                } catch (error) {
                    Logger.error(Logger.CATEGORIES.INDICATORS, `ATR ${tf} hatası`, error);
                    results[tf] = null;
                }
            }
        }

        return results;
    }

    /**
     * Pozisyon büyüklüğü hesaplama (ATR bazlı risk)
     */
    function calculatePositionSize(accountBalance, riskPercentage, entryPrice, atrStopLoss) {
        if (!accountBalance || !riskPercentage || !entryPrice || !atrStopLoss) {
            Logger.warning(Logger.CATEGORIES.INDICATORS, 'Position Size: Eksik parametreler');
            return null;
        }

        const riskAmount = accountBalance * (riskPercentage / 100);
        const priceRisk = Math.abs(entryPrice - atrStopLoss);
        
        if (priceRisk === 0) {
            Logger.warning(Logger.CATEGORIES.INDICATORS, 'Position Size: Sıfır risk mesafesi');
            return null;
        }

        const positionSize = riskAmount / priceRisk;
        const positionValue = positionSize * entryPrice;
        const maxLeverage = Math.floor(accountBalance / positionValue);

        const result = {
            accountBalance: accountBalance,
            riskAmount: riskAmount,
            riskPercentage: riskPercentage,
            entryPrice: entryPrice,
            stopLoss: atrStopLoss,
            priceRisk: priceRisk,
            priceRiskPercentage: (priceRisk / entryPrice) * 100,
            positionSize: positionSize,
            positionValue: positionValue,
            suggestedLeverage: Math.min(maxLeverage, 10), // Max 10x
            marginRequired: positionValue / Math.min(maxLeverage, 10)
        };

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'Position Size hesaplandı', {
            size: positionSize.toFixed(6),
            value: positionValue.toFixed(2),
            leverage: result.suggestedLeverage + 'x',
            risk: result.priceRiskPercentage.toFixed(2) + '%'
        });

        return result;
    }

    /**
     * Real-time ATR hesaplama
     */
    function calculateLive(historicalData, newCandle, atrHistory, params = {}) {
        const p = { ...DEFAULT_PARAMS, ...params };
        
        if (historicalData.length === 0) {
            Logger.warning(Logger.CATEGORIES.INDICATORS, 'ATR Live: Geçmiş veri yok');
            return null;
        }

        // Yeni True Range hesapla
        const lastCandle = historicalData[historicalData.length - 1];
        const newTR = calculateTrueRange(
            parseFloat(newCandle.high),
            parseFloat(newCandle.low),
            parseFloat(lastCandle.close)
        );

        if (!atrHistory || atrHistory.length === 0) {
            // İlk hesaplama
            const data = [...historicalData, newCandle];
            const atr = calculate(data, p);
            return atr[atr.length - 1];
        }

        // Incremental update (RMA için)
        const lastATR = atrHistory[atrHistory.length - 1];
        const newATR = ((lastATR * (p.period - 1)) + newTR) / p.period;

        Logger.debug(Logger.CATEGORIES.INDICATORS, 'ATR Live güncellendi', {
            newTR: newTR.toFixed(4),
            newATR: newATR.toFixed(4)
        });

        return newATR;
    }

    /**
     * ATR trend analizi
     */
    function analyzeTrend(atrValues, prices) {
        if (!atrValues || !prices || atrValues.length < 20) {
            return null;
        }

        const recentATR = atrValues.slice(-10);
        const oldATR = atrValues.slice(-20, -10);
        
        const recentAvg = recentATR.reduce((a, b) => a + b) / recentATR.length;
        const oldAvg = oldATR.reduce((a, b) => a + b) / oldATR.length;
        
        const atrTrend = (recentAvg - oldAvg) / oldAvg * 100;
        
        let trendDirection;
        if (atrTrend > 10) trendDirection = 'increasing';
        else if (atrTrend < -10) trendDirection = 'decreasing';
        else trendDirection = 'stable';

        return {
            atrTrend: atrTrend,
            trendDirection: trendDirection,
            recentATR: recentAvg,
            oldATR: oldAvg,
            interpretation: getTrendInterpretation(trendDirection)
        };
    }

    /**
     * ATR trend yorumu
     */
    function getTrendInterpretation(trendDirection) {
        switch (trendDirection) {
            case 'increasing':
                return 'Volatilite artıyor - Büyük fiyat hareketleri beklenir';
            case 'decreasing':
                return 'Volatilite azalıyor - Daha sakin piyasa beklenir';
            case 'stable':
                return 'Volatilite stabil - Normal fiyat hareketleri';
            default:
                return 'Belirlenemeyen trend';
        }
    }

    // Public API
    return {
        // Ana hesaplama fonksiyonları
        calculate: calculate,
        calculateLive: calculateLive,
        calculateTrueRange: calculateTrueRange,
        
        // Stop-loss fonksiyonları
        calculateStopLoss: calculateStopLoss,
        calculateDynamicStopLoss: calculateDynamicStopLoss,
        calculateTrailingStopLoss: calculateTrailingStopLoss,
        
        // Position management
        calculatePositionSize: calculatePositionSize,
        
        // Multi-timeframe analiz
        analyzeMultiTimeframe: analyzeMultiTimeframe,
        
        // Trend analizi
        analyzeTrend: analyzeTrend,
        getTrendInterpretation: getTrendInterpretation,
        
        // Utility fonksiyonları
        calculateWMA: calculateWMA,
        
        // Sabitler
        DEFAULT_PARAMS: DEFAULT_PARAMS
    };

})();

// Initialize
if (window.Logger) {
    Logger.info(Logger.CATEGORIES.INDICATORS, 'ATR indikatörü yüklendi', {
        defaultParams: ATR.DEFAULT_PARAMS
    });
}
