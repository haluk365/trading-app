/**
 * HESAPLAMA UTILITY FONKSIYONLARI
 * Matematiksel hesaplamalar ve veri işleme fonksiyonları
 */

window.Utils = (function() {
    'use strict';

    /**
     * MATEMATIKSEL FONKSIYONLAR
     */
    const Math = {
        
        /**
         * Basit Moving Average hesapla
         */
        sma: function(data, period) {
            if (!data || data.length < period) {
                return [];
            }

            const result = [];
            
            for (let i = period - 1; i < data.length; i++) {
                let sum = 0;
                for (let j = 0; j < period; j++) {
                    sum += parseFloat(data[i - j]);
                }
                result.push(sum / period);
            }
            
            return result;
        },

        /**
         * Exponential Moving Average hesapla
         */
        ema: function(data, period) {
            if (!data || data.length < period) {
                return [];
            }

            const result = [];
            const multiplier = 2 / (period + 1);
            
            // İlk EMA değeri = SMA
            let sum = 0;
            for (let i = 0; i < period; i++) {
                sum += parseFloat(data[i]);
            }
            result.push(sum / period);
            
            // Sonraki EMA değerleri
            for (let i = period; i < data.length; i++) {
                const ema = (parseFloat(data[i]) * multiplier) + (result[result.length - 1] * (1 - multiplier));
                result.push(ema);
            }
            
            return result;
        },

        /**
         * Relative Strength Index hesapla
         */
        rsi: function(data, period = 14) {
            if (!data || data.length < period + 1) {
                return [];
            }

            const gains = [];
            const losses = [];
            
            // İlk değişimleri hesapla
            for (let i = 1; i < data.length; i++) {
                const change = parseFloat(data[i]) - parseFloat(data[i - 1]);
                gains.push(change > 0 ? change : 0);
                losses.push(change < 0 ? Math.abs(change) : 0);
            }
            
            if (gains.length < period) {
                return [];
            }
            
            const result = [];
            
            // İlk RSI için basit ortalama
            let avgGain = gains.slice(0, period).reduce((a, b) => a + b) / period;
            let avgLoss = losses.slice(0, period).reduce((a, b) => a + b) / period;
            
            let rs = avgGain / avgLoss;
            result.push(100 - (100 / (1 + rs)));
            
            // Sonraki RSI değerleri için Wilder's smoothing
            for (let i = period; i < gains.length; i++) {
                avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
                avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
                
                rs = avgGain / avgLoss;
                result.push(100 - (100 / (1 + rs)));
            }
            
            return result;
        },

        /**
         * Average True Range hesapla
         */
        atr: function(highs, lows, closes, period = 14) {
            if (!highs || !lows || !closes || highs.length < period + 1) {
                return [];
            }

            const trueRanges = [];
            
            // True Range değerlerini hesapla
            for (let i = 1; i < highs.length; i++) {
                const high = parseFloat(highs[i]);
                const low = parseFloat(lows[i]);
                const prevClose = parseFloat(closes[i - 1]);
                
                const tr1 = high - low;
                const tr2 = Math.abs(high - prevClose);
                const tr3 = Math.abs(low - prevClose);
                
                trueRanges.push(Math.max(tr1, tr2, tr3));
            }
            
            // ATR hesapla (RMA - Wilder's smoothing)
            return this.rma(trueRanges, period);
        },

        /**
         * RMA (Wilder's Moving Average) hesapla
         */
        rma: function(data, period) {
            if (!data || data.length < period) {
                return [];
            }

            const result = [];
            
            // İlk RMA değeri = SMA
            let sum = 0;
            for (let i = 0; i < period; i++) {
                sum += parseFloat(data[i]);
            }
            result.push(sum / period);
            
            // Sonraki RMA değerleri
            for (let i = period; i < data.length; i++) {
                const rma = (result[result.length - 1] * (period - 1) + parseFloat(data[i])) / period;
                result.push(rma);
            }
            
            return result;
        },

        /**
         * Standard Deviation hesapla
         */
        stdDev: function(data, period) {
            if (!data || data.length < period) {
                return [];
            }

            const result = [];
            
            for (let i = period - 1; i < data.length; i++) {
                const slice = data.slice(i - period + 1, i + 1).map(x => parseFloat(x));
                const mean = slice.reduce((a, b) => a + b) / slice.length;
                
                const variance = slice.reduce((sum, value) => {
                    return sum + Math.pow(value - mean, 2);
                }, 0) / slice.length;
                
                result.push(Math.sqrt(variance));
            }
            
            return result;
        },

        /**
         * Nadaraya-Watson Estimator için Gaussian weight
         */
        gaussianWeight: function(x, h) {
            return Math.exp(-(Math.pow(x, 2) / (h * h * 2)));
        },

        /**
         * Yüzdelik değişim hesapla
         */
        percentChange: function(oldValue, newValue) {
            if (oldValue === 0) return 0;
            return ((newValue - oldValue) / oldValue) * 100;
        },

        /**
         * İki değer arasındaki yüzdelik fark
         */
        percentDifference: function(value1, value2) {
            if (value1 === 0) return 0;
            return Math.abs((value2 - value1) / value1) * 100;
        },

        /**
         * Min-Max normalizasyon
         */
        normalize: function(data, min = 0, max = 1) {
            const dataMin = Math.min(...data);
            const dataMax = Math.max(...data);
            const range = dataMax - dataMin;
            
            if (range === 0) return data.map(() => min);
            
            return data.map(value => 
                min + ((value - dataMin) / range) * (max - min)
            );
        },

        /**
         * Correlation coefficient hesapla
         */
        correlation: function(x, y) {
            if (!x || !y || x.length !== y.length || x.length < 2) {
                return 0;
            }

            const n = x.length;
            const sumX = x.reduce((a, b) => a + b);
            const sumY = y.reduce((a, b) => a + b);
            const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
            const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
            const sumYY = y.reduce((sum, yi) => sum + yi * yi, 0);

            const numerator = n * sumXY - sumX * sumY;
            const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));

            return denominator === 0 ? 0 : numerator / denominator;
        }
    };

    /**
     * FİYAT HESAPLAMA FONKSIYONLARI
     */
    const Price = {
        
        /**
         * Pip değeri hesapla
         */
        calculatePipValue: function(price, digits = 2) {
            return 1 / Math.pow(10, digits);
        },

        /**
         * Pozisyon büyüklüğü hesapla
         */
        calculatePositionSize: function(accountBalance, riskPercentage, entryPrice, stopLoss) {
            const riskAmount = accountBalance * (riskPercentage / 100);
            const priceRisk = Math.abs(entryPrice - stopLoss);
            
            if (priceRisk === 0) return 0;
            
            return riskAmount / priceRisk;
        },

        /**
         * Stop loss seviyesi hesapla (ATR bazlı)
         */
        calculateStopLoss: function(entryPrice, atrValue, multiplier, direction) {
            if (direction === 'long') {
                return entryPrice - (atrValue * multiplier);
            } else {
                return entryPrice + (atrValue * multiplier);
            }
        },

        /**
         * Take profit seviyesi hesapla
         */
        calculateTakeProfit: function(entryPrice, stopLoss, riskRewardRatio) {
            const risk = Math.abs(entryPrice - stopLoss);
            const reward = risk * riskRewardRatio;
            
            if (entryPrice > stopLoss) {
                // Long position
                return entryPrice + reward;
            } else {
                // Short position
                return entryPrice - reward;
            }
        },

        /**
         * P&L hesapla
         */
        calculatePnL: function(entryPrice, currentPrice, quantity, direction) {
            let pnl;
            
            if (direction === 'long') {
                pnl = (currentPrice - entryPrice) * quantity;
            } else {
                pnl = (entryPrice - currentPrice) * quantity;
            }
            
            return pnl;
        },

        /**
         * P&L yüzdesi hesapla
         */
        calculatePnLPercentage: function(entryPrice, currentPrice, direction) {
            if (direction === 'long') {
                return ((currentPrice - entryPrice) / entryPrice) * 100;
            } else {
                return ((entryPrice - currentPrice) / entryPrice) * 100;
            }
        },

        /**
         * Trailing stop seviyesi hesapla
         */
        calculateTrailingStop: function(entryPrice, currentPrice, currentStopLoss, trailingPercentage, direction) {
            const profit = Math.abs(currentPrice - entryPrice);
            const newStopDistance = profit * (trailingPercentage / 100);
            
            let newStopLoss;
            
            if (direction === 'long') {
                newStopLoss = currentPrice - newStopDistance;
                return Math.max(newStopLoss, currentStopLoss);
            } else {
                newStopLoss = currentPrice + newStopDistance;
                return Math.min(newStopLoss, currentStopLoss);
            }
        }
    };

    /**
     * VERİ İŞLEME FONKSIYONLARI
     */
    const Data = {
        
        /**
         * OHLCV verilerini parse et
         */
        parseOHLCV: function(klineData) {
            return klineData.map(candle => ({
                timestamp: parseInt(candle[0]),
                open: parseFloat(candle[1]),
                high: parseFloat(candle[2]),
                low: parseFloat(candle[3]),
                close: parseFloat(candle[4]),
                volume: parseFloat(candle[5]),
                closeTime: parseInt(candle[6])
            }));
        },

        /**
         * Zaman serisi verilerini birleştir
         */
        mergeTimeSeries: function(series1, series2, timestampKey = 'timestamp') {
            const merged = [];
            let i = 0, j = 0;
            
            while (i < series1.length && j < series2.length) {
                const ts1 = series1[i][timestampKey];
                const ts2 = series2[j][timestampKey];
                
                if (ts1 === ts2) {
                    merged.push({ ...series1[i], ...series2[j] });
                    i++;
                    j++;
                } else if (ts1 < ts2) {
                    i++;
                } else {
                    j++;
                }
            }
            
            return merged;
        },

        /**
         * Veri eksiklerini doldur (interpolation)
         */
        interpolate: function(data, valueKey) {
            const result = [...data];
            
            for (let i = 1; i < result.length - 1; i++) {
                if (result[i][valueKey] === null || result[i][valueKey] === undefined) {
                    const prevValue = result[i - 1][valueKey];
                    const nextValue = result[i + 1][valueKey];
                    
                    if (prevValue !== null && nextValue !== null) {
                        result[i][valueKey] = (prevValue + nextValue) / 2;
                    }
                }
            }
            
            return result;
        },

        /**
         * Outlier'ları temizle (IQR method)
         */
        removeOutliers: function(data, valueKey, multiplier = 1.5) {
            const values = data.map(item => item[valueKey]).filter(v => v !== null);
            values.sort((a, b) => a - b);
            
            const q1 = values[Math.floor(values.length * 0.25)];
            const q3 = values[Math.floor(values.length * 0.75)];
            const iqr = q3 - q1;
            
            const lowerBound = q1 - (iqr * multiplier);
            const upperBound = q3 + (iqr * multiplier);
            
            return data.filter(item => {
                const value = item[valueKey];
                return value >= lowerBound && value <= upperBound;
            });
        },

        /**
         * Veriyi resample et (timeframe değiştir)
         */
        resample: function(data, newTimeframe) {
            // Basit implementation - gerçek kullanımda daha karmaşık olmalı
            const intervals = {
                '1m': 60 * 1000,
                '5m': 5 * 60 * 1000,
                '15m': 15 * 60 * 1000,
                '1h': 60 * 60 * 1000,
                '4h': 4 * 60 * 60 * 1000,
                '1d': 24 * 60 * 60 * 1000
            };
            
            const interval = intervals[newTimeframe];
            if (!interval) return data;
            
            const result = [];
            let currentGroup = [];
            let currentTime = null;
            
            data.forEach(candle => {
                const candleTime = Math.floor(candle.timestamp / interval) * interval;
                
                if (currentTime === null) {
                    currentTime = candleTime;
                }
                
                if (candleTime === currentTime) {
                    currentGroup.push(candle);
                } else {
                    if (currentGroup.length > 0) {
                        result.push(this.aggregateCandles(currentGroup, currentTime));
                    }
                    currentGroup = [candle];
                    currentTime = candleTime;
                }
            });
            
            if (currentGroup.length > 0) {
                result.push(this.aggregateCandles(currentGroup, currentTime));
            }
            
            return result;
        },

        /**
         * Mum verilerini birleştir
         */
        aggregateCandles: function(candles, timestamp) {
            if (candles.length === 0) return null;
            
            return {
                timestamp: timestamp,
                open: candles[0].open,
                high: Math.max(...candles.map(c => c.high)),
                low: Math.min(...candles.map(c => c.low)),
                close: candles[candles.length - 1].close,
                volume: candles.reduce((sum, c) => sum + c.volume, 0)
            };
        }
    };

    /**
     * VALIDATION FONKSIYONLARI
     */
    const Validation = {
        
        /**
         * Sayı doğrulama
         */
        isValidNumber: function(value, min = null, max = null) {
            const num = parseFloat(value);
            
            if (isNaN(num) || !isFinite(num)) {
                return false;
            }
            
            if (min !== null && num < min) {
                return false;
            }
            
            if (max !== null && num > max) {
                return false;
            }
            
            return true;
        },

        /**
         * Pozitif sayı kontrolü
         */
        isPositive: function(value) {
            const num = parseFloat(value);
            return !isNaN(num) && num > 0;
        },

        /**
         * Yüzde doğrulama
         */
        isValidPercentage: function(value, min = 0, max = 100) {
            return this.isValidNumber(value, min, max);
        },

        /**
         * Dizi doğrulama
         */
        isValidArray: function(arr, minLength = 0) {
            return Array.isArray(arr) && arr.length >= minLength;
        },

        /**
         * OHLC verisi doğrulama
         */
        isValidOHLC: function(candle) {
            return candle &&
                   this.isPositive(candle.open) &&
                   this.isPositive(candle.high) &&
                   this.isPositive(candle.low) &&
                   this.isPositive(candle.close) &&
                   candle.high >= candle.low &&
                   candle.high >= Math.max(candle.open, candle.close) &&
                   candle.low <= Math.min(candle.open, candle.close);
        }
    };

    /**
     * FORMAT FONKSIYONLARI
     */
    const Format = {
        
        /**
         * Sayıyı formatla
         */
        number: function(value, decimals = 2, thousandsSep = ',') {
            const num = parseFloat(value);
            if (isNaN(num)) return '0';
            
            const parts = num.toFixed(decimals).split('.');
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSep);
            
            return parts.join('.');
        },

        /**
         * Yüzdeyi formatla
         */
        percentage: function(value, decimals = 2) {
            return this.number(value, decimals) + '%';
        },

        /**
         * Para birimi formatla
         */
        currency: function(value, symbol = '$', decimals = 2) {
            return symbol + this.number(value, decimals);
        },

        /**
         * Tarihi formatla
         */
        date: function(timestamp, format = 'DD/MM/YYYY HH:mm') {
            const date = new Date(timestamp);
            
            const day = date.getDate().toString().padStart(2, '0');
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const year = date.getFullYear();
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            const seconds = date.getSeconds().toString().padStart(2, '0');
            
            return format
                .replace('DD', day)
                .replace('MM', month)
                .replace('YYYY', year)
                .replace('HH', hours)
                .replace('mm', minutes)
                .replace('ss', seconds);
        },

        /**
         * Süreyi formatla
         */
        duration: function(milliseconds) {
            const seconds = Math.floor(milliseconds / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);
            
            if (days > 0) {
                return `${days}d ${hours % 24}h`;
            } else if (hours > 0) {
                return `${hours}h ${minutes % 60}m`;
            } else if (minutes > 0) {
                return `${minutes}m ${seconds % 60}s`;
            } else {
                return `${seconds}s`;
            }
        }
    };

    // Public API
    return {
        Math: Math,
        Price: Price,
        Data: Data,
        Validation: Validation,
        Format: Format,

        // Quick access functions
        sma: Math.sma,
        ema: Math.ema,
        rsi: Math.rsi,
        atr: Math.atr,
        
        // Utility functions
        clamp: function(value, min, max) {
            return Math.min(Math.max(value, min), max);
        },
        
        deepClone: function(obj) {
            return JSON.parse(JSON.stringify(obj));
        },
        
        debounce: function(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        },
        
        throttle: function(func, limit) {
            let inThrottle;
            return function(...args) {
                if (!inThrottle) {
                    func.apply(this, args);
                    inThrottle = true;
                    setTimeout(() => inThrottle = false, limit);
                }
            };
        }
    };

})();

// Initialize
if (window.Logger) {
    Logger.info(Logger.CATEGORIES.APP, 'Utils modülü yüklendi');
}
