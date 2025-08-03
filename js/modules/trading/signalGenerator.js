/**
 * SIGNAL GENERATOR MODÜLÜ
 * 4 indikatörü birleştirerek strateji sinyalleri üretir
 * Multi-timeframe koordinasyon ve sinyal validasyonu
 */

window.SignalGenerator = (function() {
    'use strict';

    let isInitialized = false;
    let activeSignals = new Map();
    let signalHistory = [];
    let lastAnalysis = null;

    const SIGNAL_TYPES = {
        LONG: 'long',
        SHORT: 'short',
        NEUTRAL: 'neutral'
    };

    const SIGNAL_STRENGTH = {
        WEAK: 'weak',
        MODERATE: 'moderate', 
        STRONG: 'strong',
        VERY_STRONG: 'very_strong'
    };

    /**
     * Signal Generator'ı başlat
     */
    function init() {
        if (isInitialized) {
            Logger.warning(Logger.CATEGORIES.TRADING, 'SignalGenerator zaten başlatılmış');
            return true;
        }

        try {
            // Cleanup scheduler başlat
            startSignalCleanup();

            isInitialized = true;
            Logger.success(Logger.CATEGORIES.TRADING, 'SignalGenerator başlatıldı');
            return true;
            
        } catch (error) {
            Logger.error(Logger.CATEGORIES.TRADING, 'SignalGenerator başlatma hatası', error);
            return false;
        }
    }

    /**
     * Signal cleanup scheduler başlat
     */
    function startSignalCleanup() {
        setInterval(() => {
            cleanupOldSignals();
        }, 5 * 60 * 1000); // Her 5 dakika
    }

    /**
     * Eski sinyalleri temizle
     */
    function cleanupOldSignals() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 saat
        let cleanedCount = 0;

        for (const [key, signal] of activeSignals.entries()) {
            if (now - signal.timestamp > maxAge) {
                activeSignals.delete(key);
                cleanedCount++;
            }
        }

        // Signal history temizliği
        signalHistory = signalHistory.filter(signal => now - signal.timestamp < 7 * 24 * 60 * 60 * 1000); // 7 gün

        if (cleanedCount > 0) {
            Logger.debug(Logger.CATEGORIES.TRADING, `Signal cleanup: ${cleanedCount} eski sinyal temizlendi`);
        }
    }

    /**
     * Ana sinyal analizi
     */
    async function analyzeSymbol(symbol, multiData, options = {}) {
        if (!symbol || !multiData) {
            Logger.warning(Logger.CATEGORIES.TRADING, 'Signal Analysis: Eksik parametreler');
            return null;
        }

        return ErrorHandler.safeAsync(async function() {
            Logger.info(Logger.CATEGORIES.TRADING, `Signal analizi başlatılıyor: ${symbol}`);

            const analysis = {
                symbol: symbol,
                timestamp: Date.now(),
                timeframes: {},
                overall: null,
                indicators: {},
                signals: [],
                confidence: 0,
                recommendation: SIGNAL_TYPES.NEUTRAL
            };

            // Her indikatör için multi-timeframe analiz
            analysis.indicators.nadaraya = NadarayaWatson.analyzeMultiTimeframe(multiData);
            analysis.indicators.rsi = RSI.analyzeMultiTimeframe(multiData);
            analysis.indicators.movingAverages = MovingAverages.analyzeMultiTimeframe(multiData);
            analysis.indicators.atr = ATR.analyzeMultiTimeframe(multiData);

            // Timeframe bazlı sinyal kontrolü
            const timeframes = ['4h', '1h', '15m'];
            for (const tf of timeframes) {
                analysis.timeframes[tf] = analyzeTimeframe(tf, analysis.indicators, multiData[tf]);
            }

            // Overall sinyal hesaplama
            analysis.overall = calculateOverallSignal(analysis.timeframes);
            analysis.confidence = calculateConfidence(analysis.timeframes, analysis.indicators);
            analysis.recommendation = analysis.overall.signal;

            // Sinyal listesi oluştur
            analysis.signals = generateSignalList(analysis);

            // Son analizi kaydet
            lastAnalysis = analysis;

            Logger.success(Logger.CATEGORIES.TRADING, `Signal analizi tamamlandı: ${symbol}`, {
                recommendation: analysis.recommendation,
                confidence: (analysis.confidence * 100).toFixed(1) + '%',
                signals: analysis.signals.length
            });

            return analysis;

        }, `Signal Analysis: ${symbol}`)();
    }

    /**
     * Tek timeframe analizi
     */
    function analyzeTimeframe(timeframe, indicators, candleData) {
        const tf = timeframe;
        const analysis = {
            timeframe: tf,
            signals: {},
            score: 0,
            signal: SIGNAL_TYPES.NEUTRAL,
            strength: SIGNAL_STRENGTH.WEAK,
            reasons: []
        };

        // Nadaraya-Watson sinyali
        const nadarayaResult = indicators.nadaraya[tf];
        if (nadarayaResult && nadarayaResult.overflow) {
            const thresholds = Config.get('STRATEGY.nadaraya.thresholds', {});
            const threshold = thresholds[tf] || 1.0;

            if (nadarayaResult.overflow.percentage >= threshold) {
                const signal = nadarayaResult.overflow.direction === 'upper' ? SIGNAL_TYPES.SHORT : SIGNAL_TYPES.LONG;
                const strength = Math.min(nadarayaResult.overflow.percentage / threshold, 3); // Max 3x threshold

                analysis.signals.nadaraya = {
                    signal: signal,
                    strength: strength,
                    percentage: nadarayaResult.overflow.percentage,
                    threshold: threshold,
                    direction: nadarayaResult.overflow.direction
                };

                analysis.score += signal === SIGNAL_TYPES.LONG ? 3 : -3;
                analysis.reasons.push(`Nadaraya ${tf}: ${nadarayaResult.overflow.direction} taşma %${nadarayaResult.overflow.percentage.toFixed(2)}`);

                Logger.debug(Logger.CATEGORIES.TRADING, `Nadaraya sinyal ${tf}:`, {
                    signal: signal,
                    strength: strength.toFixed(2),
                    percentage: nadarayaResult.overflow.percentage.toFixed(2)
                });
            }
        }

        // RSI backup doğrulama
        const rsiResult = indicators.rsi[tf];
        if (rsiResult && rsiResult.signal !== 'neutral') {
            const rsiSignal = rsiResult.signal === 'oversold' ? SIGNAL_TYPES.LONG : SIGNAL_TYPES.SHORT;
            const divergenceBonus = rsiResult.divergence.hasRecent ? 1.5 : 1.0;

            analysis.signals.rsi = {
                signal: rsiSignal,
                value: rsiResult.value,
                level: rsiResult.level,
                hasDivergence: rsiResult.divergence.hasRecent,
                bonus: divergenceBonus
            };

            const rsiScore = (rsiSignal === SIGNAL_TYPES.LONG ? 1 : -1) * divergenceBonus;
            analysis.score += rsiScore;
            analysis.reasons.push(`RSI ${tf}: ${rsiResult.level} (${rsiResult.value.toFixed(1)})`);

            if (rsiResult.divergence.hasRecent) {
                analysis.reasons.push(`RSI ${tf}: Divergence tespit edildi`);
            }
        }

        // Moving Averages doğrulama
        const maResult = indicators.movingAverages[tf];
        if (maResult && maResult.reversal && maResult.reversal.isValid) {
            const maSignal = maResult.reversal.direction === 'bullish' ? SIGNAL_TYPES.LONG : SIGNAL_TYPES.SHORT;
            const maStrength = maResult.reversal.confidence;

            analysis.signals.movingAverages = {
                signal: maSignal,
                direction: maResult.reversal.direction,
                strength: maResult.reversal.strength,
                confidence: maResult.reversal.confidence,
                gaps: maResult.gaps
            };

            const maScore = (maSignal === SIGNAL_TYPES.LONG ? 2 : -2) * maStrength;
            analysis.score += maScore;
            analysis.reasons.push(`MA ${tf}: ${maResult.reversal.direction} reversal (güven: %${(maStrength * 100).toFixed(1)})`);
        }

        // Overall timeframe sinyali
        if (analysis.score > 2) {
            analysis.signal = SIGNAL_TYPES.LONG;
        } else if (analysis.score < -2) {
            analysis.signal = SIGNAL_TYPES.SHORT;
        } else {
            analysis.signal = SIGNAL_TYPES.NEUTRAL;
        }

        // Strength hesaplama
        const absScore = Math.abs(analysis.score);
        if (absScore >= 6) analysis.strength = SIGNAL_STRENGTH.VERY_STRONG;
        else if (absScore >= 4) analysis.strength = SIGNAL_STRENGTH.STRONG;
        else if (absScore >= 2) analysis.strength = SIGNAL_STRENGTH.MODERATE;
        else analysis.strength = SIGNAL_STRENGTH.WEAK;

        Logger.debug(Logger.CATEGORIES.TRADING, `Timeframe analizi ${tf}:`, {
            signal: analysis.signal,
            strength: analysis.strength,
            score: analysis.score,
            reasons: analysis.reasons.length
        });

        return analysis;
    }

    /**
     * Overall sinyal hesaplama
     */
    function calculateOverallSignal(timeframeAnalysis) {
        const timeframes = ['4h', '1h', '15m'];
        const weights = { '4h': 3, '1h': 2, '15m': 1 }; // Ağırlıklar
        
        let totalScore = 0;
        let totalWeight = 0;
        let activeTimeframes = 0;

        const overall = {
            signal: SIGNAL_TYPES.NEUTRAL,
            strength: SIGNAL_STRENGTH.WEAK,
            score: 0,
            supportingTimeframes: [],
            conflictingTimeframes: [],
            reasons: []
        };

        // Her timeframe'in katkısını hesapla
        for (const tf of timeframes) {
            const analysis = timeframeAnalysis[tf];
            if (analysis && analysis.signal !== SIGNAL_TYPES.NEUTRAL) {
                const weight = weights[tf];
                const scoreContribution = analysis.score * weight;
                
                totalScore += scoreContribution;
                totalWeight += weight;
                activeTimeframes++;

                overall.supportingTimeframes.push({
                    timeframe: tf,
                    signal: analysis.signal,
                    strength: analysis.strength,
                    score: analysis.score,
                    weight: weight,
                    contribution: scoreContribution
                });

                overall.reasons.push(`${tf}: ${analysis.signal} (${analysis.strength})`);
            }
        }

        // Overall sinyal belirleme
        if (activeTimeframes === 0) {
            overall.signal = SIGNAL_TYPES.NEUTRAL;
            overall.strength = SIGNAL_STRENGTH.WEAK;
        } else {
            const avgScore = totalScore / totalWeight;
            overall.score = avgScore;

            if (avgScore > 1) {
                overall.signal = SIGNAL_TYPES.LONG;
            } else if (avgScore < -1) {
                overall.signal = SIGNAL_TYPES.SHORT;
            } else {
                overall.signal = SIGNAL_TYPES.NEUTRAL;
            }

            // Strength belirleme
            const absAvgScore = Math.abs(avgScore);
            if (absAvgScore >= 4) overall.strength = SIGNAL_STRENGTH.VERY_STRONG;
            else if (absAvgScore >= 3) overall.strength = SIGNAL_STRENGTH.STRONG;
            else if (absAvgScore >= 2) overall.strength = SIGNAL_STRENGTH.MODERATE;
            else overall.strength = SIGNAL_STRENGTH.WEAK;
        }

        // Çelişkili timeframe'leri tespit et
        const longTimeframes = overall.supportingTimeframes.filter(tf => tf.signal === SIGNAL_TYPES.LONG);
        const shortTimeframes = overall.supportingTimeframes.filter(tf => tf.signal === SIGNAL_TYPES.SHORT);

        if (longTimeframes.length > 0 && shortTimeframes.length > 0) {
            overall.conflictingTimeframes = shortTimeframes.length < longTimeframes.length ? shortTimeframes : longTimeframes;
            overall.reasons.push(`Çelişki: ${overall.conflictingTimeframes.map(tf => tf.timeframe).join(', ')}`);
        }

        Logger.info(Logger.CATEGORIES.TRADING, 'Overall sinyal hesaplandı', {
            signal: overall.signal,
            strength: overall.strength,
            score: overall.score.toFixed(2),
            activeTimeframes: activeTimeframes,
            conflicts: overall.conflictingTimeframes.length
        });

        return overall;
    }

    /**
     * Confidence hesaplama
     */
    function calculateConfidence(timeframeAnalysis, indicators) {
        let confidenceScore = 0;
        let factors = 0;

        // Timeframe uyumu
        const timeframes = ['4h', '1h', '15m'];
        const signals = timeframes.map(tf => timeframeAnalysis[tf]?.signal).filter(s => s !== SIGNAL_TYPES.NEUTRAL);
        
        if (signals.length > 0) {
            const longCount = signals.filter(s => s === SIGNAL_TYPES.LONG).length;
            const shortCount = signals.filter(s => s === SIGNAL_TYPES.SHORT).length;
            const consensus = Math.max(longCount, shortCount) / signals.length;
            
            confidenceScore += consensus * 0.4; // %40 ağırlık
            factors++;
        }

        // İndikatör çeşitliliği
        let activeIndicators = 0;
        const totalIndicators = 3; // Nadaraya, RSI, MA (ATR stop-loss için)

        timeframes.forEach(tf => {
            if (timeframeAnalysis[tf]?.signals.nadaraya) activeIndicators++;
            if (timeframeAnalysis[tf]?.signals.rsi) activeIndicators++;
            if (timeframeAnalysis[tf]?.signals.movingAverages) activeIndicators++;
        });

        const indicatorDiversity = activeIndicators / (totalIndicators * timeframes.length);
        confidenceScore += indicatorDiversity * 0.3; // %30 ağırlık
        factors++;

        // Sinyal gücü
        const strengthScores = timeframes.map(tf => {
            const analysis = timeframeAnalysis[tf];
            if (!analysis || analysis.signal === SIGNAL_TYPES.NEUTRAL) return 0;
            
            switch (analysis.strength) {
                case SIGNAL_STRENGTH.VERY_STRONG: return 1.0;
                case SIGNAL_STRENGTH.STRONG: return 0.8;
                case SIGNAL_STRENGTH.MODERATE: return 0.6;
                case SIGNAL_STRENGTH.WEAK: return 0.4;
                default: return 0;
            }
        });

        const avgStrength = strengthScores.reduce((a, b) => a + b, 0) / strengthScores.length;
        confidenceScore += avgStrength * 0.3; // %30 ağırlık
        factors++;

        // Final confidence
        const confidence = factors > 0 ? confidenceScore / factors : 0;

        Logger.debug(Logger.CATEGORIES.TRADING, 'Confidence hesaplandı', {
            confidence: (confidence * 100).toFixed(1) + '%',
            consensus: signals.length > 0 ? `${Math.max(signals.filter(s => s === SIGNAL_TYPES.LONG).length, signals.filter(s => s === SIGNAL_TYPES.SHORT).length)}/${signals.length}` : '0/0',
            indicatorDiversity: (indicatorDiversity * 100).toFixed(1) + '%',
            avgStrength: (avgStrength * 100).toFixed(1) + '%'
        });

        return Math.min(Math.max(confidence, 0), 1); // 0-1 arası
    }

    /**
     * Sinyal listesi oluştur
     */
    function generateSignalList(analysis) {
        const signals = [];
        const timeframes = ['4h', '1h', '15m'];

        // Ana sinyal
        if (analysis.overall.signal !== SIGNAL_TYPES.NEUTRAL) {
            signals.push({
                id: generateSignalId(),
                type: 'main_signal',
                signal: analysis.overall.signal,
                strength: analysis.overall.strength,
                confidence: analysis.confidence,
                symbol: analysis.symbol,
                timestamp: analysis.timestamp,
                timeframes: analysis.overall.supportingTimeframes.map(tf => tf.timeframe),
                reasons: analysis.overall.reasons,
                indicators: Object.keys(analysis.indicators),
                metadata: {
                    score: analysis.overall.score,
                    conflicts: analysis.overall.conflictingTimeframes
                }
            });
        }

        // Timeframe spesifik sinyaller
        timeframes.forEach(tf => {
            const tfAnalysis = analysis.timeframes[tf];
            if (tfAnalysis && tfAnalysis.signal !== SIGNAL_TYPES.NEUTRAL) {
                signals.push({
                    id: generateSignalId(),
                    type: 'timeframe_signal',
                    signal: tfAnalysis.signal,
                    strength: tfAnalysis.strength,
                    timeframe: tf,
                    symbol: analysis.symbol,
                    timestamp: analysis.timestamp,
                    reasons: tfAnalysis.reasons,
                    indicators: Object.keys(tfAnalysis.signals),
                    metadata: {
                        score: tfAnalysis.score,
                        signals: tfAnalysis.signals
                    }
                });
            }
        });

        return signals;
    }

    /**
     * Sinyal ID oluştur
     */
    function generateSignalId() {
        return 'signal_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Aktif sinyalleri güncelle
     */
    function updateActiveSignals(analysis) {
        if (!analysis || !analysis.symbol) return;

        const symbol = analysis.symbol;
        
        // Eski sinyalleri temizle
        for (const [key, signal] of activeSignals.entries()) {
            if (signal.symbol === symbol) {
                activeSignals.delete(key);
            }
        }

        // Yeni sinyalleri ekle
        analysis.signals.forEach(signal => {
            activeSignals.set(signal.id, signal);
        });

        // Signal history'ye ekle
        signalHistory.push({
            symbol: symbol,
            timestamp: analysis.timestamp,
            recommendation: analysis.recommendation,
            confidence: analysis.confidence,
            signalCount: analysis.signals.length
        });

        // History limitini koru (son 1000 analiz)
        if (signalHistory.length > 1000) {
            signalHistory = signalHistory.slice(-1000);
        }

        Logger.debug(Logger.CATEGORIES.TRADING, `Aktif sinyaller güncellendi: ${symbol}`, {
            activeSignals: activeSignals.size,
            historyLength: signalHistory.length
        });
    }

    /**
     * Real-time sinyal güncellemesi
     */
    async function updateSignalLive(symbol, newCandle) {
        if (!lastAnalysis || lastAnalysis.symbol !== symbol) {
            Logger.debug(Logger.CATEGORIES.TRADING, `Live update için önceki analiz bulunamadı: ${symbol}`);
            return null;
        }

        return ErrorHandler.safeAsync(async function() {
            // Mevcut multi-data'yı güncelle (approximation)
            const multiData = await DataProcessor.getMultiTimeframeData(symbol, ['4h', '1h', '15m']);
            
            // Hızlı re-analiz
            const updatedAnalysis = await analyzeSymbol(symbol, multiData, { quickUpdate: true });
            
            if (updatedAnalysis) {
                updateActiveSignals(updatedAnalysis);
                
                // Sinyal değişikliği varsa notify et
                if (updatedAnalysis.recommendation !== lastAnalysis.recommendation) {
                    Logger.info(Logger.CATEGORIES.TRADING, `Sinyal değişikliği: ${symbol}`, {
                        old: lastAnalysis.recommendation,
                        new: updatedAnalysis.recommendation,
                        confidence: (updatedAnalysis.confidence * 100).toFixed(1) + '%'
                    });

                    // Event trigger
                    triggerSignalEvent('signal_changed', {
                        symbol: symbol,
                        oldSignal: lastAnalysis.recommendation,
                        newSignal: updatedAnalysis.recommendation,
                        analysis: updatedAnalysis
                    });
                }
            }

            return updatedAnalysis;

        }, `Live Signal Update: ${symbol}`)();
    }

    /**
     * Signal event trigger
     */
    function triggerSignalEvent(eventType, eventData) {
        const event = new CustomEvent(`signalGenerator.${eventType}`, {
            detail: eventData
        });
        
        document.dispatchEvent(event);
        Logger.debug(Logger.CATEGORIES.TRADING, `Signal event triggered: ${eventType}`, eventData);
    }

    /**
     * Batch sinyal analizi (multiple symbols)
     */
    async function analyzeBatch(symbols, options = {}) {
        Logger.info(Logger.CATEGORIES.TRADING, `Batch signal analizi başlatılıyor: ${symbols.length} symbol`);

        const results = {};
        const promises = symbols.map(async symbol => {
            try {
                const multiData = await DataProcessor.getMultiTimeframeData(symbol, ['4h', '1h', '15m']);
                const analysis = await analyzeSymbol(symbol, multiData, options);
                
                if (analysis) {
                    updateActiveSignals(analysis);
                    results[symbol] = analysis;
                }
                
                return { symbol, success: true, analysis };
            } catch (error) {
                Logger.error(Logger.CATEGORIES.TRADING, `Batch analiz hatası: ${symbol}`, error);
                return { symbol, success: false, error: error.message };
            }
        });

        const batchResults = await Promise.all(promises);
        
        const summary = {
            total: symbols.length,
            successful: batchResults.filter(r => r.success).length,
            failed: batchResults.filter(r => !r.success).length,
            signals: Object.keys(results).length
        };

        Logger.success(Logger.CATEGORIES.TRADING, 'Batch signal analizi tamamlandı', summary);

        return {
            results: results,
            summary: summary,
            details: batchResults
        };
    }

    // Public API
    return {
        // Initialization
        init: init,
        isInitialized: function() { return isInitialized; },

        // Ana fonksiyonlar
        analyzeSymbol: analyzeSymbol,
        updateSignalLive: updateSignalLive,
        analyzeBatch: analyzeBatch,

        // Signal management
        getActiveSignals: function(symbol = null) {
            if (symbol) {
                const signals = [];
                for (const [key, signal] of activeSignals.entries()) {
                    if (signal.symbol === symbol) {
                        signals.push(signal);
                    }
                }
                return signals;
            }
            return Array.from(activeSignals.values());
        },

        getSignalHistory: function(symbol = null, limit = 100) {
            let history = symbol ? 
                signalHistory.filter(h => h.symbol === symbol) : 
                signalHistory;
            
            return history.slice(-limit);
        },

        getLastAnalysis: function() {
            return lastAnalysis;
        },

        // Event management
        addEventListener: function(eventType, callback) {
            document.addEventListener(`signalGenerator.${eventType}`, callback);
        },

        removeEventListener: function(eventType, callback) {
            document.removeEventListener(`signalGenerator.${eventType}`, callback);
        },

        // Statistics
        getStats: function() {
            const recentSignals = signalHistory.filter(h => Date.now() - h.timestamp < 24 * 60 * 60 * 1000);
            const longSignals = recentSignals.filter(h => h.recommendation === SIGNAL_TYPES.LONG).length;
            const shortSignals = recentSignals.filter(h => h.recommendation === SIGNAL_TYPES.SHORT).length;
            const neutralSignals = recentSignals.filter(h => h.recommendation === SIGNAL_TYPES.NEUTRAL).length;

            return {
                activeSignals: activeSignals.size,
                historyLength: signalHistory.length,
                recent24h: {
                    total: recentSignals.length,
                    long: longSignals,
                    short: shortSignals,
                    neutral: neutralSignals
                }
            };
        },

        // Cleanup
        clearHistory: function() {
            signalHistory = [];
            Logger.info(Logger.CATEGORIES.TRADING, 'Signal history temizlendi');
        },

        clearActiveSignals: function() {
            activeSignals.clear();
            Logger.info(Logger.CATEGORIES.TRADING, 'Aktif sinyaller temizlendi');
        },

        // Constants
        SIGNAL_TYPES: SIGNAL_TYPES,
        SIGNAL_STRENGTH: SIGNAL_STRENGTH
    };

})();

// Auto-initialize
if (window.Config && window.Logger && window.ErrorHandler && window.DataProcessor && 
    window.NadarayaWatson && window.RSI && window.MovingAverages && window.ATR) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            SignalGenerator.init();
        });
    } else {
        SignalGenerator.init();
    }
} else {
    console.warn('SignalGenerator: Gerekli modüller bulunamadı');
}
