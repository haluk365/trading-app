/**
 * TIMEFRAME VALIDATOR MODÜLÜ
 * Multi-timeframe koordinasyon ve sıralı doğrulama sistemi
 * 4H → 1H → 15M kademeli kontrol mekanizması
 */

window.TimeframeValidator = (function() {
    'use strict';

    let isInitialized = false;
    let validationCache = new Map();
    let validationHistory = [];

    const TIMEFRAMES = ['4h', '1h', '15m'];
    const VALIDATION_STATES = {
        PENDING: 'pending',
        VALIDATING: 'validating', 
        CONFIRMED: 'confirmed',
        REJECTED: 'rejected',
        EXPIRED: 'expired'
    };

    const VALIDATION_RULES = {
        SEQUENTIAL: 'sequential',    // 4H→1H→15M sıralı
        CONSENSUS: 'consensus',      // En az 2 timeframe uyumu
        WEIGHTED: 'weighted',        // Ağırlıklı scoring
        STRICT: 'strict'            // Tüm timeframe'ler gerekli
    };

    /**
     * Timeframe Validator'ı başlat
     */
    function init() {
        if (isInitialized) {
            Logger.warning(Logger.CATEGORIES.TRADING, 'TimeframeValidator zaten başlatılmış');
            return true;
        }

        try {
            // Cache cleanup scheduler başlat
            startCacheCleanup();

            isInitialized = true;
            Logger.success(Logger.CATEGORIES.TRADING, 'TimeframeValidator başlatıldı');
            return true;
            
        } catch (error) {
            Logger.error(Logger.CATEGORIES.TRADING, 'TimeframeValidator başlatma hatası', error);
            return false;
        }
    }

    /**
     * Cache cleanup scheduler başlat
     */
    function startCacheCleanup() {
        setInterval(() => {
            cleanupValidationCache();
        }, 5 * 60 * 1000); // Her 5 dakika
    }

    /**
     * Validation cache temizliği
     */
    function cleanupValidationCache() {
        const now = Date.now();
        const maxAge = 60 * 60 * 1000; // 1 saat
        let cleanedCount = 0;

        for (const [key, validation] of validationCache.entries()) {
            if (now - validation.startTime > maxAge) {
                validationCache.delete(key);
                cleanedCount++;
            }
        }

        // History temizliği (son 1000 validation)
        if (validationHistory.length > 1000) {
            validationHistory = validationHistory.slice(-1000);
        }

        if (cleanedCount > 0) {
            Logger.debug(Logger.CATEGORIES.TRADING, `Validation cache temizlendi: ${cleanedCount} item`);
        }
    }

    /**
     * Kademeli timeframe validation başlat
     */
    async function startSequentialValidation(symbol, initialSignal, options = {}) {
        const validationId = generateValidationId(symbol);
        
        Logger.info(Logger.CATEGORIES.TRADING, `Kademeli validation başlatılıyor: ${symbol}`, {
            validationId: validationId,
            initialSignal: initialSignal
        });

        const validation = {
            id: validationId,
            symbol: symbol,
            state: VALIDATION_STATES.PENDING,
            startTime: Date.now(),
            currentTimeframe: '4h',
            targetSignal: initialSignal,
            timeframeResults: {},
            waitingPeriods: {},
            options: {
                maxWaitTime: options.maxWaitTime || 4 * 60 * 60 * 1000, // 4 saat
                rule: options.rule || VALIDATION_RULES.SEQUENTIAL,
                requiredConfirmations: options.requiredConfirmations || 2,
                ...options
            }
        };

        validationCache.set(validationId, validation);

        try {
            const result = await executeSequentialValidation(validationId);
            return result;
        } catch (error) {
            validation.state = VALIDATION_STATES.REJECTED;
            validation.error = error.message;
            Logger.error(Logger.CATEGORIES.TRADING, `Sequential validation hatası: ${symbol}`, error);
            throw error;
        }
    }

    /**
     * Sequential validation execute
     */
    async function executeSequentialValidation(validationId) {
        const validation = validationCache.get(validationId);
        if (!validation) {
            throw new Error('Validation bulunamadı: ' + validationId);
        }

        validation.state = VALIDATION_STATES.VALIDATING;
        
        Logger.debug(Logger.CATEGORIES.TRADING, `Sequential validation başlatıldı: ${validation.symbol}`);

        // 1. AŞAMA: 4H Doğrulama
        const step1Result = await validateTimeframe(validationId, '4h');
        if (!step1Result.isValid) {
            return finalizeValidation(validationId, false, 'İlk timeframe (4H) doğrulaması başarısız');
        }

        Logger.info(Logger.CATEGORIES.TRADING, `4H doğrulama başarılı: ${validation.symbol}`);

        // 2. AŞAMA: 1H İzleme Döngüsü (4 saat boyunca)
        const step2Result = await monitorTimeframeWindow(validationId, '1h', 4 * 60 * 60 * 1000);
        if (!step2Result.isValid) {
            return finalizeValidation(validationId, false, '1H doğrulama window\'unda sinyal alınamadı');
        }

        Logger.info(Logger.CATEGORIES.TRADING, `1H doğrulama başarılı: ${validation.symbol}`);

        // 3. AŞAMA: 15M İzleme Döngüsü (1 saat boyunca)
        const step3Result = await monitorTimeframeWindow(validationId, '15m', 60 * 60 * 1000);
        if (!step3Result.isValid) {
            return finalizeValidation(validationId, false, '15M doğrulama window\'unda sinyal alınamadı');
        }

        Logger.success(Logger.CATEGORIES.TRADING, `Tüm timeframe doğrulamaları başarılı: ${validation.symbol}`);

        return finalizeValidation(validationId, true, 'Sequential validation başarılı');
    }

    /**
     * Timeframe doğrulama
     */
    async function validateTimeframe(validationId, timeframe) {
        const validation = validationCache.get(validationId);
        if (!validation) {
            throw new Error('Validation bulunamadı: ' + validationId);
        }

        Logger.debug(Logger.CATEGORIES.TRADING, `Timeframe doğrulaması: ${validation.symbol} ${timeframe}`);

        try {
            // Multi-timeframe data al
            const multiData = await DataProcessor.getMultiTimeframeData(validation.symbol, [timeframe]);
            
            if (!multiData[timeframe] || multiData[timeframe].length === 0) {
                throw new Error(`${timeframe} verisi bulunamadı`);
            }

            // İndikatör analizleri
            const indicators = await analyzeTimeframeIndicators(multiData, timeframe);
            
            // Sinyal kontrolü
            const signalCheck = checkTimeframeSignal(indicators, timeframe, validation.targetSignal);
            
            // Threshold kontrolü
            const thresholdCheck = checkTimeframeThresholds(indicators, timeframe);
            
            const result = {
                timeframe: timeframe,
                isValid: signalCheck.isValid && thresholdCheck.isValid,
                confidence: calculateTimeframeConfidence(signalCheck, thresholdCheck),
                indicators: indicators,
                signalCheck: signalCheck,
                thresholdCheck: thresholdCheck,
                timestamp: Date.now()
            };

            // Sonucu validation'a kaydet
            validation.timeframeResults[timeframe] = result;

            Logger.debug(Logger.CATEGORIES.TRADING, `Timeframe doğrulama sonucu: ${timeframe}`, {
                isValid: result.isValid,
                confidence: (result.confidence * 100).toFixed(1) + '%',
                signal: signalCheck.detectedSignal,
                thresholds: thresholdCheck.passedThresholds
            });

            return result;

        } catch (error) {
            Logger.error(Logger.CATEGORIES.TRADING, `Timeframe doğrulama hatası: ${timeframe}`, error);
            throw error;
        }
    }

    /**
     * Timeframe window monitoring
     */
    async function monitorTimeframeWindow(validationId, timeframe, windowDuration) {
        const validation = validationCache.get(validationId);
        if (!validation) {
            throw new Error('Validation bulunamadı: ' + validationId);
        }

        Logger.info(Logger.CATEGORIES.TRADING, `Timeframe window monitoring başlatıldı: ${timeframe}`, {
            symbol: validation.symbol,
            duration: `${windowDuration / (60 * 1000)} dakika`
        });

        const startTime = Date.now();
        const endTime = startTime + windowDuration;
        const checkInterval = getTimeframeCheckInterval(timeframe);

        validation.waitingPeriods[timeframe] = {
            startTime: startTime,
            endTime: endTime,
            checks: 0,
            lastCheck: null
        };

        // Monitoring loop
        while (Date.now() < endTime) {
            validation.waitingPeriods[timeframe].checks++;
            validation.waitingPeriods[timeframe].lastCheck = Date.now();

            try {
                const result = await validateTimeframe(validationId, timeframe);
                
                if (result.isValid) {
                    Logger.success(Logger.CATEGORIES.TRADING, `Timeframe sinyal tespit edildi: ${timeframe}`, {
                        symbol: validation.symbol,
                        elapsedTime: `${(Date.now() - startTime) / (60 * 1000)} dakika`,
                        confidence: (result.confidence * 100).toFixed(1) + '%'
                    });

                    return { isValid: true, result: result };
                }

                // Bir sonraki kontrole kadar bekle
                await new Promise(resolve => setTimeout(resolve, checkInterval));

            } catch (error) {
                Logger.warning(Logger.CATEGORIES.TRADING, `Monitoring check hatası: ${timeframe}`, error);
                
                // Hata durumunda kısa bekleme
                await new Promise(resolve => setTimeout(resolve, 30000)); // 30 saniye
            }

            // Validation iptal edilmişse dur
            const currentValidation = validationCache.get(validationId);
            if (!currentValidation || currentValidation.state === VALIDATION_STATES.REJECTED) {
                Logger.warning(Logger.CATEGORIES.TRADING, `Monitoring iptal edildi: ${timeframe}`);
                return { isValid: false, reason: 'Validation iptal edildi' };
            }
        }

        Logger.warning(Logger.CATEGORIES.TRADING, `Timeframe window timeout: ${timeframe}`, {
            symbol: validation.symbol,
            duration: `${windowDuration / (60 * 1000)} dakika`,
            checks: validation.waitingPeriods[timeframe].checks
        });

        return { isValid: false, reason: 'Window timeout' };
    }

    /**
     * Timeframe check interval belirleme
     */
    function getTimeframeCheckInterval(timeframe) {
        const intervals = {
            '4h': 15 * 60 * 1000,  // 15 dakika
            '1h': 5 * 60 * 1000,   // 5 dakika
            '15m': 1 * 60 * 1000,  // 1 dakika
            '5m': 30 * 1000,       // 30 saniye
            '1m': 10 * 1000        // 10 saniye
        };
        
        return intervals[timeframe] || 60 * 1000; // Default 1 dakika
    }

    /**
     * Timeframe indikatör analizi
     */
    async function analyzeTimeframeIndicators(multiData, timeframe) {
        const indicators = {};

        try {
            // Her indikatör için analiz
            if (window.NadarayaWatson) {
                indicators.nadaraya = NadarayaWatson.analyzeMultiTimeframe(multiData)[timeframe];
            }

            if (window.RSI) {
                indicators.rsi = RSI.analyzeMultiTimeframe(multiData)[timeframe];
            }

            if (window.MovingAverages) {
                indicators.movingAverages = MovingAverages.analyzeMultiTimeframe(multiData)[timeframe];
            }

            if (window.ATR) {
                indicators.atr = ATR.analyzeMultiTimeframe(multiData)[timeframe];
            }

            Logger.debug(Logger.CATEGORIES.TRADING, `Timeframe indikatörleri analiz edildi: ${timeframe}`, {
                available: Object.keys(indicators).length
            });

        } catch (error) {
            Logger.error(Logger.CATEGORIES.TRADING, `Timeframe indikatör analiz hatası: ${timeframe}`, error);
        }

        return indicators;
    }

    /**
     * Timeframe sinyal kontrolü
     */
    function checkTimeframeSignal(indicators, timeframe, targetSignal) {
        const check = {
            isValid: false,
            detectedSignal: null,
            confidence: 0,
            details: {}
        };

        let signalScore = 0;
        let maxScore = 0;

        // Nadaraya-Watson kontrolü
        if (indicators.nadaraya && indicators.nadaraya.overflow) {
            const thresholds = Config.get('STRATEGY.nadaraya.thresholds', {});
            const threshold = thresholds[timeframe] || 1.0;
            
            if (indicators.nadaraya.overflow.percentage >= threshold) {
                const nadarayaSignal = indicators.nadaraya.overflow.direction === 'upper' ? 'short' : 'long';
                
                if (nadarayaSignal === targetSignal) {
                    signalScore += 3; // En yüksek ağırlık
                    check.details.nadaraya = {
                        signal: nadarayaSignal,
                        strength: indicators.nadaraya.overflow.percentage / threshold,
                        valid: true
                    };
                }
            }
            maxScore += 3;
        }

        // RSI backup kontrolü
        if (indicators.rsi && indicators.rsi.signal !== 'neutral') {
            const rsiSignal = indicators.rsi.signal === 'oversold' ? 'long' : 'short';
            
            if (rsiSignal === targetSignal) {
                signalScore += indicators.rsi.divergence.hasRecent ? 2 : 1;
                check.details.rsi = {
                    signal: rsiSignal,
                    value: indicators.rsi.value,
                    divergence: indicators.rsi.divergence.hasRecent,
                    valid: true
                };
            }
            maxScore += 2;
        }

        // MA reversal kontrolü
        if (indicators.movingAverages && indicators.movingAverages.reversal && indicators.movingAverages.reversal.isValid) {
            const maSignal = indicators.movingAverages.reversal.direction === 'bullish' ? 'long' : 'short';
            
            if (maSignal === targetSignal) {
                signalScore += Math.round(indicators.movingAverages.reversal.confidence * 2);
                check.details.movingAverages = {
                    signal: maSignal,
                    confidence: indicators.movingAverages.reversal.confidence,
                    valid: true
                };
            }
            maxScore += 2;
        }

        // Sonuç hesaplama
        if (maxScore > 0) {
            check.confidence = signalScore / maxScore;
            check.isValid = check.confidence >= 0.5; // En az %50 confidence gerekli
            
            if (check.isValid) {
                check.detectedSignal = targetSignal;
            }
        }

        return check;
    }

    /**
     * Timeframe threshold kontrolü
     */
    function checkTimeframeThresholds(indicators, timeframe) {
        const check = {
            isValid: false,
            passedThresholds: 0,
            totalThresholds: 0,
            details: {}
        };

        const thresholds = Config.get('STRATEGY.nadaraya.thresholds', {});
        const threshold = thresholds[timeframe] || 1.0;

        // Ana threshold (Nadaraya-Watson)
        if (indicators.nadaraya && indicators.nadaraya.overflow) {
            check.totalThresholds++;
            
            if (indicators.nadaraya.overflow.percentage >= threshold) {
                check.passedThresholds++;
                check.details.nadaraya = {
                    required: threshold,
                    actual: indicators.nadaraya.overflow.percentage,
                    passed: true
                };
            } else {
                check.details.nadaraya = {
                    required: threshold,
                    actual: indicators.nadaraya.overflow.percentage,
                    passed: false
                };
            }
        }

        // Ek threshold'lar (gelecekte eklenebilir)
        // RSI extreme levels, volatility filters vs.

        // Sonuç
        check.isValid = check.totalThresholds > 0 && 
                       (check.passedThresholds / check.totalThresholds) >= 0.8; // %80 threshold geçme

        return check;
    }

    /**
     * Timeframe confidence hesaplama
     */
    function calculateTimeframeConfidence(signalCheck, thresholdCheck) {
        const signalWeight = 0.7;  // %70
        const thresholdWeight = 0.3; // %30

        return (signalCheck.confidence * signalWeight) + 
               ((thresholdCheck.passedThresholds / Math.max(thresholdCheck.totalThresholds, 1)) * thresholdWeight);
    }

    /**
     * Validation sonuçlandırma
     */
    function finalizeValidation(validationId, isSuccessful, reason) {
        const validation = validationCache.get(validationId);
        if (!validation) {
            throw new Error('Validation bulunamadı: ' + validationId);
        }

        validation.state = isSuccessful ? VALIDATION_STATES.CONFIRMED : VALIDATION_STATES.REJECTED;
        validation.endTime = Date.now();
        validation.duration = validation.endTime - validation.startTime;
        validation.finalReason = reason;

        // History'ye ekle
        validationHistory.push({
            id: validationId,
            symbol: validation.symbol,
            targetSignal: validation.targetSignal,
            state: validation.state,
            duration: validation.duration,
            timeframeResults: Object.keys(validation.timeframeResults),
            finalReason: reason,
            timestamp: validation.endTime
        });

        const result = {
            validationId: validationId,
            symbol: validation.symbol,
            isSuccessful: isSuccessful,
            state: validation.state,
            duration: validation.duration,
            reason: reason,
            timeframeResults: validation.timeframeResults,
            waitingPeriods: validation.waitingPeriods
        };

        Logger.info(Logger.CATEGORIES.TRADING, `Validation sonuçlandı: ${validation.symbol}`, {
            success: isSuccessful,
            duration: `${validation.duration / (60 * 1000)} dakika`,
            reason: reason
        });

        // Event trigger
        triggerValidationEvent('validation_completed', result);

        return result;
    }

    /**
     * Consensus validation (alternatif method)
     */
    async function validateConsensus(symbol, targetSignal, options = {}) {
        Logger.info(Logger.CATEGORIES.TRADING, `Consensus validation başlatılıyor: ${symbol}`);

        const requiredConfirmations = options.requiredConfirmations || 2;
        const multiData = await DataProcessor.getMultiTimeframeData(symbol, TIMEFRAMES);
        
        const results = {};
        let confirmations = 0;

        for (const timeframe of TIMEFRAMES) {
            const indicators = await analyzeTimeframeIndicators({ [timeframe]: multiData[timeframe] }, timeframe);
            const signalCheck = checkTimeframeSignal(indicators, timeframe, targetSignal);
            const thresholdCheck = checkTimeframeThresholds(indicators, timeframe);

            results[timeframe] = {
                isValid: signalCheck.isValid && thresholdCheck.isValid,
                confidence: calculateTimeframeConfidence(signalCheck, thresholdCheck),
                signalCheck: signalCheck,
                thresholdCheck: thresholdCheck
            };

            if (results[timeframe].isValid) {
                confirmations++;
            }
        }

        const isSuccessful = confirmations >= requiredConfirmations;
        
        Logger.info(Logger.CATEGORIES.TRADING, `Consensus validation tamamlandı: ${symbol}`, {
            success: isSuccessful,
            confirmations: `${confirmations}/${TIMEFRAMES.length}`,
            required: requiredConfirmations
        });

        return {
            symbol: symbol,
            targetSignal: targetSignal,
            method: 'consensus',
            isSuccessful: isSuccessful,
            confirmations: confirmations,
            requiredConfirmations: requiredConfirmations,
            results: results,
            timestamp: Date.now()
        };
    }

    /**
     * Validation event trigger
     */
    function triggerValidationEvent(eventType, eventData) {
        const event = new CustomEvent(`timeframeValidator.${eventType}`, {
            detail: eventData
        });
        
        document.dispatchEvent(event);
        Logger.debug(Logger.CATEGORIES.TRADING, `Validation event triggered: ${eventType}`);
    }

    /**
     * Validation ID oluştur
     */
    function generateValidationId(symbol) {
        return `validation_${symbol}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    // Public API
    return {
        // Initialization
        init: init,
        isInitialized: function() { return isInitialized; },

        // Ana validation fonksiyonları
        startSequentialValidation: startSequentialValidation,
        validateConsensus: validateConsensus,
        validateTimeframe: validateTimeframe,

        // Monitoring
        monitorTimeframeWindow: monitorTimeframeWindow,

        // Validation management
        getActiveValidations: function() {
            const active = [];
            for (const [id, validation] of validationCache.entries()) {
                if (validation.state === VALIDATION_STATES.VALIDATING || 
                    validation.state === VALIDATION_STATES.PENDING) {
                    active.push({
                        id: id,
                        symbol: validation.symbol,
                        state: validation.state,
                        currentTimeframe: validation.currentTimeframe,
                        elapsed: Date.now() - validation.startTime
                    });
                }
            }
            return active;
        },

        getValidationById: function(validationId) {
            return validationCache.get(validationId);
        },

        cancelValidation: function(validationId) {
            const validation = validationCache.get(validationId);
            if (validation) {
                validation.state = VALIDATION_STATES.REJECTED;
                validation.finalReason = 'Manuel iptal';
                
                Logger.info(Logger.CATEGORIES.TRADING, `Validation iptal edildi: ${validationId}`);
                return true;
            }
            return false;
        },

        // History ve statistics
        getValidationHistory: function(symbol = null, limit = 100) {
            let history = symbol ? 
                validationHistory.filter(v => v.symbol === symbol) : 
                validationHistory;
            
            return history.slice(-limit);
        },

        getValidationStats: function() {
            const recent24h = validationHistory.filter(v => Date.now() - v.timestamp < 24 * 60 * 60 * 1000);
            const successful = recent24h.filter(v => v.state === VALIDATION_STATES.CONFIRMED);
            
            return {
                activeValidations: this.getActiveValidations().length,
                total24h: recent24h.length,
                successful24h: successful.length,
                successRate24h: recent24h.length > 0 ? successful.length / recent24h.length : 0,
                averageDuration: successful.length > 0 ? 
                    successful.reduce((sum, v) => sum + v.duration, 0) / successful.length : 0
            };
        },

        // Event management
        addEventListener: function(eventType, callback) {
            document.addEventListener(`timeframeValidator.${eventType}`, callback);
        },

        removeEventListener: function(eventType, callback) {
            document.removeEventListener(`timeframeValidator.${eventType}`, callback);
        },

        // Constants
        VALIDATION_STATES: VALIDATION_STATES,
        VALIDATION_RULES: VALIDATION_RULES,
        TIMEFRAMES: TIMEFRAMES
    };

})();

// Auto-initialize
if (window.Config && window.Logger && window.ErrorHandler && window.DataProcessor && 
    window.NadarayaWatson && window.RSI && window.MovingAverages && window.ATR) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            TimeframeValidator.init();
        });
    } else {
        TimeframeValidator.init();
    }
} else {
    console.warn('TimeframeValidator: Gerekli modüller bulunamadı');
}
