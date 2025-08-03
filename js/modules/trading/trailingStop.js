/**
 * TRAILING STOP MODÜLÜ
 * Dinamik trailing stop sistemi ve kar koruma mekanizmaları
 * Multiple trailing strategies ve breakeven management
 */

window.TrailingStop = (function() {
    'use strict';

    let isInitialized = false;
    let trailingConfigs = new Map();
    let activeTrails = new Map();
    let trailingHistory = [];

    const TRAILING_TYPES = {
        PERCENTAGE: 'percentage',
        ATR: 'atr',
        FIXED: 'fixed',
        STEP: 'step',
        ADAPTIVE: 'adaptive'
    };

    const TRAILING_STATUS = {
        WAITING: 'waiting',
        ACTIVE: 'active',
        TRIGGERED: 'triggered',
        DISABLED: 'disabled'
    };

    const BREAKEVEN_MODES = {
        IMMEDIATE: 'immediate',
        THRESHOLD: 'threshold',
        PROGRESSIVE: 'progressive'
    };

    /**
     * Trailing Stop'u başlat
     */
    function init() {
        if (isInitialized) {
            Logger.warning(Logger.CATEGORIES.TRADING, 'TrailingStop zaten başlatılmış');
            return true;
        }

        try {
            // Default trailing configs kur
            setupDefaultConfigs();
            
            // Event listener'ları kur
            setupEventListeners();
            
            // Trailing monitoring başlat
            startTrailingMonitoring();

            isInitialized = true;
            Logger.success(Logger.CATEGORIES.TRADING, 'TrailingStop başlatıldı');
            return true;
            
        } catch (error) {
            Logger.error(Logger.CATEGORIES.TRADING, 'TrailingStop başlatma hatası', error);
            return false;
        }
    }

    /**
     * Default trailing configs kur
     */
    function setupDefaultConfigs() {
        // Conservative strategy
        trailingConfigs.set('conservative', {
            type: TRAILING_TYPES.PERCENTAGE,
            triggerPercent: 2.0,        // 2x kar etince aktif
            trailingPercent: 50.0,      // %50 trailing
            breakevenMode: BREAKEVEN_MODES.THRESHOLD,
            minProfit: 0.5,             // Min %0.5 kar
            maxTrailingDistance: 5.0,   // Max %5 trailing
            updateInterval: 30000       // 30 saniye
        });

        // Aggressive strategy
        trailingConfigs.set('aggressive', {
            type: TRAILING_TYPES.PERCENTAGE,
            triggerPercent: 1.5,        // 1.5x kar etince aktif
            trailingPercent: 30.0,      // %30 trailing
            breakevenMode: BREAKEVEN_MODES.IMMEDIATE,
            minProfit: 0.2,             // Min %0.2 kar
            maxTrailingDistance: 3.0,   // Max %3 trailing
            updateInterval: 15000       // 15 saniye
        });

        // ATR-based strategy
        trailingConfigs.set('atr', {
            type: TRAILING_TYPES.ATR,
            triggerPercent: 2.0,
            atrMultiplier: 2.0,         // ATR × 2
            breakevenMode: BREAKEVEN_MODES.PROGRESSIVE,
            minProfit: 0.3,
            updateInterval: 60000       // 1 dakika
        });

        // Step trailing strategy
        trailingConfigs.set('step', {
            type: TRAILING_TYPES.STEP,
            triggerPercent: 1.0,
            steps: [
                { profitPercent: 1.0, trailingPercent: 60.0 },  // %1 karda %60 trailing
                { profitPercent: 2.0, trailingPercent: 40.0 },  // %2 karda %40 trailing
                { profitPercent: 5.0, trailingPercent: 25.0 }   // %5 karda %25 trailing
            ],
            breakevenMode: BREAKEVEN_MODES.THRESHOLD,
            updateInterval: 30000
        });

        Logger.debug(Logger.CATEGORIES.TRADING, 'Default trailing configs kuruldu', {
            strategies: Array.from(trailingConfigs.keys())
        });
    }

    /**
     * Event listener'ları kur
     */
    function setupEventListeners() {
        // MockTrader events
        MockTrader.addEventListener('position_opened', handlePositionOpened);
        MockTrader.addEventListener('position_closed', handlePositionClosed);

        // DataProcessor events - price updates
        DataProcessor.addEventListener('kline_updated', handlePriceUpdate);
        DataProcessor.addEventListener('ticker_updated', handleTickerUpdate);
    }

    /**
     * Trailing monitoring başlat
     */
    function startTrailingMonitoring() {
        setInterval(() => {
            updateAllTrailings();
        }, 5000); // Her 5 saniye

        // Cleanup eski trailing'ler
        setInterval(() => {
            cleanupOldTrailings();
        }, 5 * 60 * 1000); // Her 5 dakika
    }

    /**
     * Position trailing başlat
     */
    function startTrailing(positionId, strategy = 'conservative', customConfig = {}) {
        const position = MockTrader.getPositionById(positionId);
        if (!position) {
            throw new Error('Position bulunamadı: ' + positionId);
        }

        // Config al
        const baseConfig = trailingConfigs.get(strategy);
        if (!baseConfig) {
            throw new Error('Trailing strategy bulunamadı: ' + strategy);
        }

        const config = { ...baseConfig, ...customConfig };

        // Trailing object oluştur
        const trailing = {
            id: generateTrailingId(),
            positionId: positionId,
            symbol: position.symbol,
            side: position.side,
            strategy: strategy,
            config: config,
            
            // State
            status: TRAILING_STATUS.WAITING,
            isActive: false,
            isBreakevenSet: false,
            
            // Price tracking
            entryPrice: position.entryPrice,
            currentPrice: position.currentPrice,
            initialStopLoss: position.stopLoss,
            currentStopLoss: position.stopLoss,
            
            // Profit tracking
            highestProfit: 0,
            highestPrice: position.side === 'long' ? position.currentPrice : position.currentPrice,
            currentProfit: 0,
            currentProfitPercent: 0,
            
            // Trigger tracking
            triggerPrice: null,
            triggerProfit: 0,
            lastUpdate: Date.now(),
            createdAt: Date.now(),
            
            // ATR data (if needed)
            atrValue: null,
            lastATRUpdate: null
        };

        // Trigger price hesapla
        calculateTriggerPrice(trailing);

        // ATR data al (if needed)
        if (config.type === TRAILING_TYPES.ATR) {
            updateATRData(trailing);
        }

        activeTrails.set(positionId, trailing);

        Logger.info(Logger.CATEGORIES.TRADING, `Trailing stop başlatıldı: ${position.symbol}`, {
            strategy: strategy,
            triggerPrice: trailing.triggerPrice?.toFixed(2),
            trailingId: trailing.id
        });

        // Event trigger
        triggerTrailingEvent('trailing_started', trailing);

        return trailing;
    }

    /**
     * Trailing durdur
     */
    function stopTrailing(positionId, reason = 'manual') {
        const trailing = activeTrails.get(positionId);
        if (!trailing) {
            return false;
        }

        trailing.status = TRAILING_STATUS.DISABLED;
        trailing.disabledAt = Date.now();
        trailing.disabledReason = reason;

        activeTrails.delete(positionId);
        
        // History'ye ekle
        trailingHistory.push({ ...trailing });

        Logger.info(Logger.CATEGORIES.TRADING, `Trailing stop durduruldu: ${trailing.symbol}`, {
            reason: reason,
            trailingId: trailing.id
        });

        // Event trigger
        triggerTrailingEvent('trailing_stopped', trailing);

        return true;
    }

    /**
     * Trigger price hesapla
     */
    function calculateTriggerPrice(trailing) {
        const initialRisk = Math.abs(trailing.entryPrice - trailing.initialStopLoss);
        const triggerProfit = initialRisk * trailing.config.triggerPercent;

        if (trailing.side === 'long') {
            trailing.triggerPrice = trailing.entryPrice + triggerProfit;
        } else {
            trailing.triggerPrice = trailing.entryPrice - triggerProfit;
        }

        trailing.triggerProfit = triggerProfit;

        Logger.debug(Logger.CATEGORIES.TRADING, `Trigger price hesaplandı: ${trailing.symbol}`, {
            entryPrice: trailing.entryPrice.toFixed(2),
            triggerPrice: trailing.triggerPrice.toFixed(2),
            triggerProfit: triggerProfit.toFixed(2)
        });
    }

    /**
     * ATR data güncelle
     */
    async function updateATRData(trailing) {
        try {
            const multiData = await DataProcessor.getMultiTimeframeData(trailing.symbol, ['15m']);
            const atrResult = ATR.analyzeMultiTimeframe(multiData);
            
            if (atrResult['15m']) {
                trailing.atrValue = atrResult['15m'].atr;
                trailing.lastATRUpdate = Date.now();
                
                Logger.debug(Logger.CATEGORIES.TRADING, `ATR data güncellendi: ${trailing.symbol}`, {
                    atr: trailing.atrValue.toFixed(4)
                });
            }
        } catch (error) {
            Logger.warning(Logger.CATEGORIES.TRADING, `ATR data güncellenemedi: ${trailing.symbol}`, error);
        }
    }

    /**
     * Tüm trailing'leri güncelle
     */
    function updateAllTrailings() {
        for (const [positionId, trailing] of activeTrails.entries()) {
            ErrorHandler.safeExecute(() => {
                updateTrailing(trailing);
            }, `Update Trailing: ${trailing.symbol}`);
        }
    }

    /**
     * Tek trailing güncelle
     */
    function updateTrailing(trailing) {
        const position = MockTrader.getPositionById(trailing.positionId);
        if (!position || position.status !== 'open') {
            stopTrailing(trailing.positionId, 'position_closed');
            return;
        }

        // Current price güncelle
        trailing.currentPrice = position.currentPrice;
        trailing.currentStopLoss = position.stopLoss;

        // Profit hesapla
        updateProfitMetrics(trailing);

        // ATR güncelle (if needed)
        if (trailing.config.type === TRAILING_TYPES.ATR && 
            (!trailing.lastATRUpdate || Date.now() - trailing.lastATRUpdate > 5 * 60 * 1000)) {
            updateATRData(trailing);
        }

        // Trigger kontrolü
        if (trailing.status === TRAILING_STATUS.WAITING) {
            checkTriggerActivation(trailing);
        }

        // Breakeven kontrolü
        if (!trailing.isBreakevenSet) {
            checkBreakevenActivation(trailing);
        }

        // Active trailing güncelleme
        if (trailing.status === TRAILING_STATUS.ACTIVE) {
            updateActiveTrailing(trailing);
        }

        trailing.lastUpdate = Date.now();
    }

    /**
     * Profit metrics güncelle
     */
    function updateProfitMetrics(trailing) {
        // Current profit hesapla
        if (trailing.side === 'long') {
            trailing.currentProfit = trailing.currentPrice - trailing.entryPrice;
        } else {
            trailing.currentProfit = trailing.entryPrice - trailing.currentPrice;
        }

        trailing.currentProfitPercent = (trailing.currentProfit / trailing.entryPrice) * 100;

        // Highest profit güncelle
        if (trailing.currentProfit > trailing.highestProfit) {
            trailing.highestProfit = trailing.currentProfit;
            
            if (trailing.side === 'long') {
                trailing.highestPrice = trailing.currentPrice;
            } else {
                trailing.highestPrice = trailing.currentPrice;
            }
        }
    }

    /**
     * Trigger activation kontrol et
     */
    function checkTriggerActivation(trailing) {
        let shouldActivate = false;

        if (trailing.side === 'long') {
            shouldActivate = trailing.currentPrice >= trailing.triggerPrice;
        } else {
            shouldActivate = trailing.currentPrice <= trailing.triggerPrice;
        }

        if (shouldActivate) {
            activateTrailing(trailing);
        }
    }

    /**
     * Trailing'i aktif et
     */
    function activateTrailing(trailing) {
        trailing.status = TRAILING_STATUS.ACTIVE;
        trailing.isActive = true;
        trailing.activatedAt = Date.now();
        trailing.activatedPrice = trailing.currentPrice;

        Logger.success(Logger.CATEGORIES.TRADING, `Trailing stop aktif edildi: ${trailing.symbol}`, {
            activatedPrice: trailing.currentPrice.toFixed(2),
            currentProfit: trailing.currentProfitPercent.toFixed(2) + '%'
        });

        // İlk trailing stop hesapla
        calculateNewStopLoss(trailing);

        // Event trigger
        triggerTrailingEvent('trailing_activated', trailing);
    }

    /**
     * Breakeven activation kontrol et
     */
    function checkBreakevenActivation(trailing) {
        const config = trailing.config;
        let shouldSetBreakeven = false;

        switch (config.breakevenMode) {
            case BREAKEVEN_MODES.IMMEDIATE:
                shouldSetBreakeven = trailing.currentProfitPercent > 0;
                break;
                
            case BREAKEVEN_MODES.THRESHOLD:
                shouldSetBreakeven = trailing.currentProfitPercent >= config.minProfit;
                break;
                
            case BREAKEVEN_MODES.PROGRESSIVE:
                shouldSetBreakeven = trailing.currentProfitPercent >= (config.minProfit * 2);
                break;
        }

        if (shouldSetBreakeven) {
            setBreakeven(trailing);
        }
    }

    /**
     * Breakeven set et
     */
    function setBreakeven(trailing) {
        // Stop-loss'u entry price'a çek (küçük kar ile)
        const breakevenPrice = trailing.entryPrice + (trailing.entryPrice * 0.001); // %0.1 kar ile breakeven

        trailing.isBreakevenSet = true;
        trailing.breakevenPrice = breakevenPrice;
        trailing.breakevenSetAt = Date.now();

        Logger.info(Logger.CATEGORIES.TRADING, `Breakeven set edildi: ${trailing.symbol}`, {
            breakevenPrice: breakevenPrice.toFixed(2),
            currentProfit: trailing.currentProfitPercent.toFixed(2) + '%'
        });

        // Event trigger
        triggerTrailingEvent('breakeven_set', trailing);

        // Position'ın stop-loss'unu güncelle (implementation gerekli)
        // MockTrader.updateStopLoss(trailing.positionId, breakevenPrice);
    }

    /**
     * Active trailing güncelle
     */
    function updateActiveTrailing(trailing) {
        const oldStopLoss = trailing.currentStopLoss;
        const newStopLoss = calculateNewStopLoss(trailing);

        if (newStopLoss && shouldUpdateStopLoss(trailing, newStopLoss, oldStopLoss)) {
            updatePositionStopLoss(trailing, newStopLoss);
        }
    }

    /**
     * Yeni stop-loss hesapla
     */
    function calculateNewStopLoss(trailing) {
        const config = trailing.config;
        let newStopLoss = null;

        switch (config.type) {
            case TRAILING_TYPES.PERCENTAGE:
                newStopLoss = calculatePercentageTrailing(trailing);
                break;
                
            case TRAILING_TYPES.ATR:
                newStopLoss = calculateATRTrailing(trailing);
                break;
                
            case TRAILING_TYPES.FIXED:
                newStopLoss = calculateFixedTrailing(trailing);
                break;
                
            case TRAILING_TYPES.STEP:
                newStopLoss = calculateStepTrailing(trailing);
                break;
                
            case TRAILING_TYPES.ADAPTIVE:
                newStopLoss = calculateAdaptiveTrailing(trailing);
                break;
        }

        return newStopLoss;
    }

    /**
     * Percentage trailing hesapla
     */
    function calculatePercentageTrailing(trailing) {
        const config = trailing.config;
        const trailingDistance = trailing.highestProfit * (config.trailingPercent / 100);
        
        if (trailing.side === 'long') {
            return trailing.highestPrice - trailingDistance;
        } else {
            return trailing.highestPrice + trailingDistance;
        }
    }

    /**
     * ATR trailing hesapla
     */
    function calculateATRTrailing(trailing) {
        if (!trailing.atrValue) return null;

        const config = trailing.config;
        const atrDistance = trailing.atrValue * config.atrMultiplier;
        
        if (trailing.side === 'long') {
            return trailing.currentPrice - atrDistance;
        } else {
            return trailing.currentPrice + atrDistance;
        }
    }

    /**
     * Fixed trailing hesapla
     */
    function calculateFixedTrailing(trailing) {
        const config = trailing.config;
        const fixedDistance = config.fixedDistance || 0.01; // Default 1%
        
        if (trailing.side === 'long') {
            return trailing.currentPrice * (1 - fixedDistance);
        } else {
            return trailing.currentPrice * (1 + fixedDistance);
        }
    }

    /**
     * Step trailing hesapla
     */
    function calculateStepTrailing(trailing) {
        const config = trailing.config;
        const steps = config.steps || [];
        
        // Current profit'e göre uygun step'i bul
        let selectedStep = null;
        for (const step of steps) {
            if (trailing.currentProfitPercent >= step.profitPercent) {
                selectedStep = step;
            }
        }

        if (!selectedStep) return null;

        const trailingDistance = trailing.highestProfit * (selectedStep.trailingPercent / 100);
        
        if (trailing.side === 'long') {
            return trailing.highestPrice - trailingDistance;
        } else {
            return trailing.highestPrice + trailingDistance;
        }
    }

    /**
     * Adaptive trailing hesapla
     */
    function calculateAdaptiveTrailing(trailing) {
        // Volatility'ye göre adaptive trailing
        const basePercent = 30; // Base %30
        const volatilityAdjustment = getVolatilityAdjustment(trailing.symbol);
        const adaptivePercent = Math.max(20, Math.min(50, basePercent + volatilityAdjustment));
        
        const trailingDistance = trailing.highestProfit * (adaptivePercent / 100);
        
        if (trailing.side === 'long') {
            return trailing.highestPrice - trailingDistance;
        } else {
            return trailing.highestPrice + trailingDistance;
        }
    }

    /**
     * Volatility adjustment al
     */
    function getVolatilityAdjustment(symbol) {
        // Cache'den volatility al
        const cached = Storage.cache.get(`volatility_${symbol}`);
        const volatility = cached || 2.0; // Default %2
        
        // Yüksek volatility = daha geniş trailing
        return (volatility - 2) * 5; // Her %1 volatility için %5 adjustment
    }

    /**
     * Stop-loss güncellenmeli mi kontrol et
     */
    function shouldUpdateStopLoss(trailing, newStopLoss, oldStopLoss) {
        if (!newStopLoss) return false;

        // Trailing direction'a göre kontrol
        if (trailing.side === 'long') {
            return newStopLoss > oldStopLoss; // Long'da stop-loss sadece yukarı gider
        } else {
            return newStopLoss < oldStopLoss; // Short'da stop-loss sadece aşağı gider
        }
    }

    /**
     * Position stop-loss güncelle
     */
    function updatePositionStopLoss(trailing, newStopLoss) {
        try {
            // MockTrader position'ını güncelle
            const position = MockTrader.getPositionById(trailing.positionId);
            if (position) {
                position.stopLoss = newStopLoss;
                trailing.currentStopLoss = newStopLoss;
                
                Logger.debug(Logger.CATEGORIES.TRADING, `Trailing stop güncellendi: ${trailing.symbol}`, {
                    oldStopLoss: trailing.currentStopLoss?.toFixed(2),
                    newStopLoss: newStopLoss.toFixed(2),
                    currentPrice: trailing.currentPrice.toFixed(2),
                    profit: trailing.currentProfitPercent.toFixed(2) + '%'
                });

                // Event trigger
                triggerTrailingEvent('stop_loss_updated', {
                    trailing: trailing,
                    oldStopLoss: trailing.currentStopLoss,
                    newStopLoss: newStopLoss
                });
            }
        } catch (error) {
            Logger.error(Logger.CATEGORIES.TRADING, `Stop-loss güncelleme hatası: ${trailing.symbol}`, error);
        }
    }

    /**
     * Position açılma event handle et
     */
    function handlePositionOpened(event) {
        const position = event.detail;
        
        // Auto-start trailing (if configured)
        const autoStartStrategy = Config.get('STRATEGY.trailingStop.autoStart');
        if (autoStartStrategy) {
            try {
                startTrailing(position.id, autoStartStrategy);
                Logger.debug(Logger.CATEGORIES.TRADING, `Auto trailing başlatıldı: ${position.symbol}`);
            } catch (error) {
                Logger.warning(Logger.CATEGORIES.TRADING, `Auto trailing başlatılamadı: ${position.symbol}`, error);
            }
        }
    }

    /**
     * Position kapanma event handle et
     */
    function handlePositionClosed(event) {
        const position = event.detail;
        
        // Trailing'i durdur
        if (activeTrails.has(position.id)) {
            stopTrailing(position.id, 'position_closed');
        }
    }

    /**
     * Price update handle et
     */
    function handlePriceUpdate(event) {
        const { symbol } = event.detail;
        
        // İlgili trailing'leri bul ve güncelle
        for (const trailing of activeTrails.values()) {
            if (trailing.symbol === symbol) {
                // Throttled update (her 5 saniyede bir normal update var)
                if (Date.now() - trailing.lastUpdate > 2000) { // 2 saniye throttle
                    updateTrailing(trailing);
                }
            }
        }
    }

    /**
     * Ticker update handle et
     */
    function handleTickerUpdate(event) {
        const { symbol } = event.detail;
        
        // Price update ile aynı logic
        handlePriceUpdate(event);
    }

    /**
     * Eski trailing'leri temizle
     */
    function cleanupOldTrailings() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 saat
        
        trailingHistory = trailingHistory.filter(trailing => 
            now - (trailing.disabledAt || trailing.createdAt) < maxAge
        );

        // History limitini koru
        if (trailingHistory.length > 1000) {
            trailingHistory = trailingHistory.slice(-1000);
        }
    }

    /**
     * Trailing event trigger
     */
    function triggerTrailingEvent(eventType, eventData) {
        const event = new CustomEvent(`trailingStop.${eventType}`, {
            detail: eventData
        });
        
        document.dispatchEvent(event);
        Logger.debug(Logger.CATEGORIES.TRADING, `Trailing event triggered: ${eventType}`);
    }

    /**
     * Trailing ID oluştur
     */
    function generateTrailingId() {
        return 'trail_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }

    // Public API
    return {
        // Initialization
        init: init,
        isInitialized: function() { return isInitialized; },

        // Trailing management
        startTrailing: startTrailing,
        stopTrailing: stopTrailing,
        
        // Configuration
        addTrailingConfig: function(name, config) {
            trailingConfigs.set(name, config);
            Logger.info(Logger.CATEGORIES.TRADING, `Trailing config eklendi: ${name}`);
        },

        getTrailingConfig: function(name) {
            return trailingConfigs.get(name);
        },

        getAvailableStrategies: function() {
            return Array.from(trailingConfigs.keys());
        },

        // Active trailing management
        getActiveTrailings: function() {
            return Array.from(activeTrails.values());
        },

        getTrailingByPosition: function(positionId) {
            return activeTrails.get(positionId);
        },

        updateTrailingConfig: function(positionId, newConfig) {
            const trailing = activeTrails.get(positionId);
            if (trailing) {
                trailing.config = { ...trailing.config, ...newConfig };
                Logger.info(Logger.CATEGORIES.TRADING, `Trailing config güncellendi: ${trailing.symbol}`);
                return true;
            }
            return false;
        },

        // Manual controls
        forceBreakeven: function(positionId) {
            const trailing = activeTrails.get(positionId);
            if (trailing && !trailing.isBreakevenSet) {
                setBreakeven(trailing);
                return true;
            }
            return false;
        },

        forceActivation: function(positionId) {
            const trailing = activeTrails.get(positionId);
            if (trailing && trailing.status === TRAILING_STATUS.WAITING) {
                activateTrailing(trailing);
                return true;
            }
            return false;
        },

        // Analytics
        getTrailingHistory: function(limit = 100) {
            return trailingHistory.slice(-limit);
        },

        getTrailingStats: function(symbol = null) {
            const relevantHistory = symbol ? 
                trailingHistory.filter(t => t.symbol === symbol) : 
                trailingHistory;
            
            const totalTrailings = relevantHistory.length;
            const activatedTrailings = relevantHistory.filter(t => t.status === TRAILING_STATUS.ACTIVE || t.activatedAt).length;
            const triggeredTrailings = relevantHistory.filter(t => t.status === TRAILING_STATUS.TRIGGERED).length;
            
            return {
                total: totalTrailings,
                activated: activatedTrailings,
                triggered: triggeredTrailings,
                activationRate: totalTrailings > 0 ? activatedTrailings / totalTrailings : 0,
                triggerRate: activatedTrailings > 0 ? triggeredTrailings / activatedTrailings : 0,
                activeNow: activeTrails.size
            };
        },

        getPerformanceMetrics: function() {
            const activeList = Array.from(activeTrails.values());
            const totalProfit = activeList.reduce((sum, t) => sum + t.currentProfit, 0);
            const avgProfitPercent = activeList.length > 0 ? 
                activeList.reduce((sum, t) => sum + t.currentProfitPercent, 0) / activeList.length : 0;

            return {
                activeTrailings: activeList.length,
                totalUnrealizedProfit: totalProfit,
                avgProfitPercent: avgProfitPercent,
                breakevenSet: activeList.filter(t => t.isBreakevenSet).length,
                waitingActivation: activeList.filter(t => t.status === TRAILING_STATUS.WAITING).length,
                activelyTrailing: activeList.filter(t => t.status === TRAILING_STATUS.ACTIVE).length
            };
        },

        // Event management
        addEventListener: function(eventType, callback) {
            document.addEventListener(`trailingStop.${eventType}`, callback);
        },

        removeEventListener: function(eventType, callback) {
            document.removeEventListener(`trailingStop.${eventType}`, callback);
        },

        // Constants
        TRAILING_TYPES: TRAILING_TYPES,
        TRAILING_STATUS: TRAILING_STATUS,
        BREAKEVEN_MODES: BREAKEVEN_MODES
    };

})();

// Auto-initialize
if (window.Config && window.Logger && window.ErrorHandler && window.MockTrader && 
    window.DataProcessor && window.ATR && window.Storage) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            TrailingStop.init();
        });
    } else {
        TrailingStop.init();
    }
} else {
    console.warn('TrailingStop: Gerekli modüller bulunamadı');
}
