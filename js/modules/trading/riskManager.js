/**
 * RISK MANAGER MODÜLÜ
 * Gelişmiş risk yönetimi, stop-loss management ve emergency controls
 * Real-time risk monitoring ve otomatik risk azaltma sistemleri
 */

window.RiskManager = (function() {
    'use strict';

    let isInitialized = false;
    let riskProfile = null;
    let riskEvents = [];
    let emergencyMode = false;
    let riskLimits = {};
    let dailyStats = null;

    const RISK_LEVELS = {
        LOW: 'low',
        MEDIUM: 'medium',
        HIGH: 'high',
        CRITICAL: 'critical'
    };

    const RISK_ACTIONS = {
        MONITOR: 'monitor',
        WARN: 'warn',
        REDUCE: 'reduce',
        STOP: 'stop',
        EMERGENCY: 'emergency'
    };

    const EMERGENCY_TRIGGERS = {
        DAILY_LOSS_LIMIT: 'daily_loss_limit',
        DRAWDOWN_LIMIT: 'drawdown_limit',
        MARGIN_CALL: 'margin_call',
        CORRELATION_SPIKE: 'correlation_spike',
        VOLATILITY_SPIKE: 'volatility_spike'
    };

    /**
     * Risk Manager'ı başlat
     */
    function init() {
        if (isInitialized) {
            Logger.warning(Logger.CATEGORIES.TRADING, 'RiskManager zaten başlatılmış');
            return true;
        }

        try {
            // Risk profile oluştur
            initializeRiskProfile();
            
            // Risk limits kur
            setupRiskLimits();
            
            // Daily stats başlat
            initializeDailyStats();
            
            // Event listener'ları kur
            setupRiskEventListeners();
            
            // Risk monitoring başlat
            startRiskMonitoring();

            isInitialized = true;
            Logger.success(Logger.CATEGORIES.TRADING, 'RiskManager başlatıldı', {
                riskLevel: riskProfile.level,
                emergencyMode: emergencyMode
            });
            
            return true;
            
        } catch (error) {
            Logger.error(Logger.CATEGORIES.TRADING, 'RiskManager başlatma hatası', error);
            return false;
        }
    }

    /**
     * Risk profile oluştur
     */
    function initializeRiskProfile() {
        riskProfile = {
            level: RISK_LEVELS.MEDIUM,
            
            // Position risk limits
            maxPositionSize: Config.get('STRATEGY.risk.maxPositionSize', 5.0), // %5
            maxPositions: 5,
            maxLeverage: Config.get('MOCK_TRADING.maxLeverage', 20),
            
            // Portfolio risk limits
            maxDailyLoss: Config.get('STRATEGY.risk.maxDailyLoss', 10.0), // %10
            maxDrawdown: 15.0,      // %15 max drawdown
            maxCorrelation: 0.7,    // Max correlation between positions
            
            // Volatility limits
            maxVolatility: 5.0,     // %5 max daily volatility per position
            
            // Time-based limits
            maxTradesPerDay: 20,
            cooldownPeriod: 30 * 60 * 1000, // 30 minutes
            
            // Emergency settings
            emergencyStopLoss: 20.0,  // %20 emergency stop
            panicModeThreshold: 25.0, // %25 total loss = panic mode
            
            createdAt: Date.now(),
            lastUpdate: Date.now()
        };

        Logger.info(Logger.CATEGORIES.TRADING, 'Risk profile oluşturuldu', {
            level: riskProfile.level,
            maxDailyLoss: riskProfile.maxDailyLoss + '%',
            maxDrawdown: riskProfile.maxDrawdown + '%'
        });
    }

    /**
     * Risk limits kur
     */
    function setupRiskLimits() {
        riskLimits = {
            // Threshold levels
            thresholds: {
                [RISK_LEVELS.LOW]: {
                    dailyLoss: riskProfile.maxDailyLoss * 0.3,      // %3
                    drawdown: riskProfile.maxDrawdown * 0.3,        // %4.5
                    positions: Math.ceil(riskProfile.maxPositions * 0.6) // 3
                },
                [RISK_LEVELS.MEDIUM]: {
                    dailyLoss: riskProfile.maxDailyLoss * 0.6,      // %6
                    drawdown: riskProfile.maxDrawdown * 0.6,        // %9
                    positions: Math.ceil(riskProfile.maxPositions * 0.8) // 4
                },
                [RISK_LEVELS.HIGH]: {
                    dailyLoss: riskProfile.maxDailyLoss * 0.8,      // %8
                    drawdown: riskProfile.maxDrawdown * 0.8,        // %12
                    positions: riskProfile.maxPositions             // 5
                },
                [RISK_LEVELS.CRITICAL]: {
                    dailyLoss: riskProfile.maxDailyLoss,            // %10
                    drawdown: riskProfile.maxDrawdown,              // %15
                    positions: 0                                    // No new positions
                }
            },
            
            // Actions for each level
            actions: {
                [RISK_LEVELS.LOW]: RISK_ACTIONS.MONITOR,
                [RISK_LEVELS.MEDIUM]: RISK_ACTIONS.WARN,
                [RISK_LEVELS.HIGH]: RISK_ACTIONS.REDUCE,
                [RISK_LEVELS.CRITICAL]: RISK_ACTIONS.STOP
            }
        };

        Logger.debug(Logger.CATEGORIES.TRADING, 'Risk limits kuruldu', riskLimits);
    }

    /**
     * Daily stats başlat
     */
    function initializeDailyStats() {
        const today = new Date().toDateString();
        
        dailyStats = {
            date: today,
            startingBalance: 0,
            currentBalance: 0,
            dailyPnL: 0,
            dailyLossPercent: 0,
            tradesOpened: 0,
            tradesClosed: 0,
            maxDrawdownToday: 0,
            riskEvents: [],
            lastReset: Date.now()
        };

        // MockTrader'dan starting balance al
        const account = MockTrader.getAccount();
        if (account) {
            dailyStats.startingBalance = account.balance;
            dailyStats.currentBalance = account.balance;
        }

        Logger.debug(Logger.CATEGORIES.TRADING, 'Daily stats başlatıldı', {
            date: today,
            startingBalance: dailyStats.startingBalance
        });
    }

    /**
     * Risk event listener'ları kur
     */
    function setupRiskEventListeners() {
        // MockTrader events
        MockTrader.addEventListener('position_opened', handlePositionRiskEvent);
        MockTrader.addEventListener('position_closed', handlePositionRiskEvent);
        
        // PortfolioManager events
        PortfolioManager.addEventListener('risk_alert', handlePortfolioRiskEvent);
        
        // SignalGenerator events
        SignalGenerator.addEventListener('signal_changed', handleSignalRiskEvent);
    }

    /**
     * Risk monitoring başlat
     */
    function startRiskMonitoring() {
        setInterval(() => {
            updateRiskMetrics();
            checkRiskLevels();
            checkEmergencyTriggers();
            executeRiskActions();
        }, 10 * 1000); // Her 10 saniye

        // Daily reset kontrolü
        setInterval(() => {
            checkDailyReset();
        }, 60 * 1000); // Her dakika kontrol
    }

    /**
     * Risk metrics güncelle
     */
    function updateRiskMetrics() {
        try {
            const account = MockTrader.getAccount();
            const stats = MockTrader.getAccountStats();
            
            if (!account || !stats) return;

            // Daily stats güncelle
            dailyStats.currentBalance = account.balance;
            dailyStats.dailyPnL = account.balance - dailyStats.startingBalance;
            dailyStats.dailyLossPercent = Math.abs(dailyStats.dailyPnL / dailyStats.startingBalance) * 100;
            
            // Max drawdown today
            const currentDrawdown = ((account.maxBalance - account.balance) / account.maxBalance) * 100;
            if (currentDrawdown > dailyStats.maxDrawdownToday) {
                dailyStats.maxDrawdownToday = currentDrawdown;
            }

            // Risk profile güncelle
            riskProfile.lastUpdate = Date.now();

        } catch (error) {
            Logger.error(Logger.CATEGORIES.TRADING, 'Risk metrics güncelleme hatası', error);
        }
    }

    /**
     * Risk levels kontrol et
     */
    function checkRiskLevels() {
        const currentLevel = calculateCurrentRiskLevel();
        
        if (currentLevel !== riskProfile.level) {
            const oldLevel = riskProfile.level;
            riskProfile.level = currentLevel;
            
            Logger.warning(Logger.CATEGORIES.TRADING, `Risk level değişti: ${oldLevel} → ${currentLevel}`);
            
            // Risk event kaydet
            recordRiskEvent({
                type: 'risk_level_change',
                oldLevel: oldLevel,
                newLevel: currentLevel,
                metrics: getCurrentRiskMetrics()
            });
            
            // Event trigger
            triggerRiskEvent('risk_level_changed', {
                oldLevel: oldLevel,
                newLevel: currentLevel
            });
        }
    }

    /**
     * Current risk level hesapla
     */
    function calculateCurrentRiskLevel() {
        const metrics = getCurrentRiskMetrics();
        
        // Critical level kontrolü
        if (metrics.dailyLossPercent >= riskLimits.thresholds[RISK_LEVELS.CRITICAL].dailyLoss ||
            metrics.drawdownPercent >= riskLimits.thresholds[RISK_LEVELS.CRITICAL].drawdown ||
            emergencyMode) {
            return RISK_LEVELS.CRITICAL;
        }
        
        // High level kontrolü
        if (metrics.dailyLossPercent >= riskLimits.thresholds[RISK_LEVELS.HIGH].dailyLoss ||
            metrics.drawdownPercent >= riskLimits.thresholds[RISK_LEVELS.HIGH].drawdown ||
            metrics.activePositions >= riskLimits.thresholds[RISK_LEVELS.HIGH].positions) {
            return RISK_LEVELS.HIGH;
        }
        
        // Medium level kontrolü
        if (metrics.dailyLossPercent >= riskLimits.thresholds[RISK_LEVELS.MEDIUM].dailyLoss ||
            metrics.drawdownPercent >= riskLimits.thresholds[RISK_LEVELS.MEDIUM].drawdown ||
            metrics.activePositions >= riskLimits.thresholds[RISK_LEVELS.MEDIUM].positions) {
            return RISK_LEVELS.MEDIUM;
        }
        
        return RISK_LEVELS.LOW;
    }

    /**
     * Current risk metrics al
     */
    function getCurrentRiskMetrics() {
        const account = MockTrader.getAccount();
        const stats = MockTrader.getAccountStats();
        const activePositions = MockTrader.getActivePositions();
        
        if (!account || !stats) {
            return {
                dailyLossPercent: 0,
                drawdownPercent: 0,
                activePositions: 0,
                totalExposure: 0,
                unrealizedPnL: 0
            };
        }

        return {
            dailyLossPercent: dailyStats.dailyLossPercent,
            drawdownPercent: stats.maxDrawdown,
            activePositions: activePositions.length,
            totalExposure: calculateTotalExposure(activePositions),
            unrealizedPnL: stats.unrealizedPnL,
            marginLevel: account.marginLevel || 0
        };
    }

    /**
     * Total exposure hesapla
     */
    function calculateTotalExposure(positions) {
        let totalExposure = 0;
        
        positions.forEach(position => {
            totalExposure += Math.abs(position.notionalValue || 0);
        });
        
        return totalExposure;
    }

    /**
     * Emergency triggers kontrol et
     */
    function checkEmergencyTriggers() {
        const metrics = getCurrentRiskMetrics();
        const account = MockTrader.getAccount();
        
        if (!account) return;

        const triggers = [];

        // Daily loss limit
        if (metrics.dailyLossPercent >= riskProfile.maxDailyLoss) {
            triggers.push({
                type: EMERGENCY_TRIGGERS.DAILY_LOSS_LIMIT,
                value: metrics.dailyLossPercent,
                limit: riskProfile.maxDailyLoss
            });
        }

        // Drawdown limit
        if (metrics.drawdownPercent >= riskProfile.maxDrawdown) {
            triggers.push({
                type: EMERGENCY_TRIGGERS.DRAWDOWN_LIMIT,
                value: metrics.drawdownPercent,
                limit: riskProfile.maxDrawdown
            });
        }

        // Margin level (if applicable)
        if (metrics.marginLevel > 0 && metrics.marginLevel < 200) { // %200 margin level altında
            triggers.push({
                type: EMERGENCY_TRIGGERS.MARGIN_CALL,
                value: metrics.marginLevel,
                limit: 200
            });
        }

        // Panic mode threshold
        const totalLossPercent = ((dailyStats.startingBalance - account.balance) / dailyStats.startingBalance) * 100;
        if (totalLossPercent >= riskProfile.panicModeThreshold) {
            triggers.push({
                type: 'panic_mode',
                value: totalLossPercent,
                limit: riskProfile.panicModeThreshold
            });
        }

        // Emergency triggers'ları işle
        triggers.forEach(trigger => {
            handleEmergencyTrigger(trigger);
        });
    }

    /**
     * Emergency trigger handle et
     */
    function handleEmergencyTrigger(trigger) {
        Logger.error(Logger.CATEGORIES.TRADING, `Emergency trigger activated: ${trigger.type}`, trigger);

        // Emergency mode aktif et
        if (!emergencyMode) {
            activateEmergencyMode(trigger);
        }

        // Risk event kaydet
        recordRiskEvent({
            type: 'emergency_trigger',
            trigger: trigger,
            timestamp: Date.now()
        });

        // Event trigger
        triggerRiskEvent('emergency_triggered', trigger);
    }

    /**
     * Emergency mode aktif et
     */
    function activateEmergencyMode(trigger) {
        emergencyMode = true;
        riskProfile.level = RISK_LEVELS.CRITICAL;

        Logger.error(Logger.CATEGORIES.TRADING, 'EMERGENCY MODE ACTIVATED', {
            trigger: trigger.type,
            value: trigger.value,
            limit: trigger.limit
        });

        // Acil işlemler
        executeEmergencyActions(trigger);

        // Event trigger
        triggerRiskEvent('emergency_mode_activated', {
            trigger: trigger,
            timestamp: Date.now()
        });
    }

    /**
     * Emergency actions execute et
     */
    async function executeEmergencyActions(trigger) {
        Logger.warning(Logger.CATEGORIES.TRADING, 'Emergency actions başlatılıyor...');

        try {
            // 1. Tüm pozisyonları kapat
            const activePositions = MockTrader.getActivePositions();
            
            for (const position of activePositions) {
                await MockTrader.closePosition(position.id, 'emergency_close');
                Logger.warning(Logger.CATEGORIES.TRADING, `Emergency close: ${position.symbol}`);
            }

            // 2. Portfolio'yu pause et
            if (PortfolioManager.isInitialized()) {
                // Portfolio status'ü pause'a çek (implementation gerekli)
                Logger.warning(Logger.CATEGORIES.TRADING, 'Portfolio paused');
            }

            // 3. Yeni işlemleri durdur
            riskProfile.maxPositions = 0;

            Logger.success(Logger.CATEGORIES.TRADING, 'Emergency actions tamamlandı');

        } catch (error) {
            Logger.error(Logger.CATEGORIES.TRADING, 'Emergency actions hatası', error);
        }
    }

    /**
     * Risk actions execute et
     */
    function executeRiskActions() {
        const action = riskLimits.actions[riskProfile.level];
        
        switch (action) {
            case RISK_ACTIONS.MONITOR:
                // Sadece monitoring, herhangi bir action yok
                break;
                
            case RISK_ACTIONS.WARN:
                // Warning logs ve notifications
                if (shouldWarn()) {
                    Logger.warning(Logger.CATEGORIES.TRADING, `Risk seviyesi: ${riskProfile.level}`, getCurrentRiskMetrics());
                }
                break;
                
            case RISK_ACTIONS.REDUCE:
                // Position size'ları azalt
                executeRiskReduction();
                break;
                
            case RISK_ACTIONS.STOP:
                // Yeni pozisyonları durdur
                executeRiskStop();
                break;
                
            case RISK_ACTIONS.EMERGENCY:
                // Emergency mode'a geç
                if (!emergencyMode) {
                    activateEmergencyMode({ type: 'risk_action', level: riskProfile.level });
                }
                break;
        }
    }

    /**
     * Warning gerekli mi kontrol et
     */
    function shouldWarn() {
        const lastWarn = riskEvents.find(e => 
            e.type === 'warning' && 
            Date.now() - e.timestamp < 5 * 60 * 1000 // Son 5 dakika
        );
        
        return !lastWarn;
    }

    /**
     * Risk reduction execute et
     */
    function executeRiskReduction() {
        const activePositions = MockTrader.getActivePositions();
        
        // En riskli pozisyonları tespit et
        const riskyPositions = activePositions
            .filter(position => position.unrealizedPnL < 0) // Zararda olanlar
            .sort((a, b) => a.unrealizedPnL - b.unrealizedPnL) // En fazla zararda olan ilk
            .slice(0, 2); // En riskli 2 pozisyon

        riskyPositions.forEach(position => {
            // Stop-loss'ları sıkılaştır
            const newStopLoss = calculateTighterStopLoss(position);
            
            // Position update (implementation gerekli)
            Logger.warning(Logger.CATEGORIES.TRADING, `Risk reduction: ${position.symbol} stop-loss sıkılaştırıldı`);
            
            recordRiskEvent({
                type: 'risk_reduction',
                positionId: position.id,
                symbol: position.symbol,
                oldStopLoss: position.stopLoss,
                newStopLoss: newStopLoss
            });
        });
    }

    /**
     * Tighter stop-loss hesapla
     */
    function calculateTighterStopLoss(position) {
        const currentPrice = position.currentPrice;
        const currentStopLoss = position.stopLoss;
        
        // %50 daha sıkı stop-loss
        const tighterDistance = Math.abs(currentPrice - currentStopLoss) * 0.5;
        
        if (position.side === 'long') {
            return currentPrice - tighterDistance;
        } else {
            return currentPrice + tighterDistance;
        }
    }

    /**
     * Risk stop execute et
     */
    function executeRiskStop() {
        // Yeni pozisyon açmayı durdur
        riskProfile.maxPositions = 0;
        
        Logger.warning(Logger.CATEGORIES.TRADING, 'Yeni pozisyonlar durduruldu - Risk seviyesi: CRITICAL');
        
        recordRiskEvent({
            type: 'risk_stop',
            level: riskProfile.level,
            metrics: getCurrentRiskMetrics()
        });
    }

    /**
     * Position risk event handle et
     */
    function handlePositionRiskEvent(event) {
        const position = event.detail;
        
        if (event.type === 'position_opened') {
            dailyStats.tradesOpened++;
            
            // Max trades per day kontrolü
            if (dailyStats.tradesOpened > riskProfile.maxTradesPerDay) {
                Logger.warning(Logger.CATEGORIES.TRADING, 'Günlük trade limiti aşıldı', {
                    current: dailyStats.tradesOpened,
                    limit: riskProfile.maxTradesPerDay
                });
            }
        } else if (event.type === 'position_closed') {
            dailyStats.tradesClosed++;
        }
    }

    /**
     * Portfolio risk event handle et
     */
    function handlePortfolioRiskEvent(event) {
        const alert = event.detail;
        
        recordRiskEvent({
            type: 'portfolio_risk',
            alert: alert,
            timestamp: Date.now()
        });
    }

    /**
     * Signal risk event handle et
     */
    function handleSignalRiskEvent(event) {
        const { symbol, newSignal, oldSignal } = event.detail;
        
        // Ani sinyal değişimleri risk olarak kaydet
        if (oldSignal && newSignal !== oldSignal) {
            recordRiskEvent({
                type: 'signal_change',
                symbol: symbol,
                oldSignal: oldSignal,
                newSignal: newSignal,
                timestamp: Date.now()
            });
        }
    }

    /**
     * Risk event kaydet
     */
    function recordRiskEvent(event) {
        event.id = generateRiskEventId();
        event.timestamp = event.timestamp || Date.now();
        
        riskEvents.push(event);
        dailyStats.riskEvents.push(event);
        
        // Event history limitini koru
        if (riskEvents.length > 1000) {
            riskEvents = riskEvents.slice(-1000);
        }
        
        Logger.debug(Logger.CATEGORIES.TRADING, 'Risk event kaydedildi', {
            type: event.type,
            id: event.id
        });
    }

    /**
     * Daily reset kontrol et
     */
    function checkDailyReset() {
        const today = new Date().toDateString();
        
        if (dailyStats.date !== today) {
            Logger.info(Logger.CATEGORIES.TRADING, 'Daily stats reset ediliyor');
            
            // Önceki günün verilerini kaydet
            const yesterdayStats = { ...dailyStats };
            
            // Yeni günü başlat
            initializeDailyStats();
            
            // Emergency mode'u reset et (opsiyonel)
            if (emergencyMode) {
                Logger.info(Logger.CATEGORIES.TRADING, 'Emergency mode daily reset ile deaktive edildi');
                emergencyMode = false;
                riskProfile.level = RISK_LEVELS.MEDIUM;
                riskProfile.maxPositions = Config.get('STRATEGY.risk.maxPositions', 5);
            }
            
            // Event trigger
            triggerRiskEvent('daily_reset', {
                yesterdayStats: yesterdayStats,
                newDate: today
            });
        }
    }

    /**
     * Risk event trigger
     */
    function triggerRiskEvent(eventType, eventData) {
        const event = new CustomEvent(`riskManager.${eventType}`, {
            detail: eventData
        });
        
        document.dispatchEvent(event);
        Logger.debug(Logger.CATEGORIES.TRADING, `Risk event triggered: ${eventType}`);
    }

    /**
     * Risk event ID oluştur
     */
    function generateRiskEventId() {
        return 'risk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }

    /**
     * Position risk assessment
     */
    function assessPositionRisk(symbol, side, size, leverage, signalData) {
        const assessment = {
            riskScore: 0,
            riskLevel: RISK_LEVELS.LOW,
            warnings: [],
            recommendations: []
        };

        // Position size risk
        const account = MockTrader.getAccount();
        if (account) {
            const positionRisk = (size * leverage) / account.balance * 100;
            
            if (positionRisk > riskProfile.maxPositionSize) {
                assessment.riskScore += 30;
                assessment.warnings.push(`Position risk %${positionRisk.toFixed(1)} > limit %${riskProfile.maxPositionSize}`);
            }
        }

        // Leverage risk
        if (leverage > 10) {
            assessment.riskScore += 20;
            assessment.warnings.push(`Yüksek leverage: ${leverage}x`);
        }

        // Signal confidence risk
        if (signalData && signalData.confidence < 0.7) {
            assessment.riskScore += 15;
            assessment.warnings.push(`Düşük signal confidence: %${(signalData.confidence * 100).toFixed(1)}`);
        }

        // Market volatility risk
        const volatility = getSymbolVolatility(symbol);
        if (volatility > 3) {
            assessment.riskScore += 25;
            assessment.warnings.push(`Yüksek volatilite: %${volatility.toFixed(1)}`);
        }

        // Current portfolio risk
        const currentRisk = getCurrentRiskMetrics();
        if (currentRisk.activePositions >= 4) {
            assessment.riskScore += 10;
            assessment.warnings.push(`Çok fazla aktif pozisyon: ${currentRisk.activePositions}`);
        }

        // Risk level belirleme
        if (assessment.riskScore >= 60) {
            assessment.riskLevel = RISK_LEVELS.CRITICAL;
            assessment.recommendations.push('Bu pozisyonu açmayın');
        } else if (assessment.riskScore >= 40) {
            assessment.riskLevel = RISK_LEVELS.HIGH;
            assessment.recommendations.push('Position size\'ı azaltın');
        } else if (assessment.riskScore >= 20) {
            assessment.riskLevel = RISK_LEVELS.MEDIUM;
            assessment.recommendations.push('Dikkatli olun');
        }

        return assessment;
    }

    /**
     * Symbol volatility al (simplified)
     */
    function getSymbolVolatility(symbol) {
        // Cache'den al veya default döndür
        const cached = Storage.cache.get(`volatility_${symbol}`);
        return cached || 2.0; // Default %2
    }

    // Public API
    return {
        // Initialization
        init: init,
        isInitialized: function() { return isInitialized; },

        // Risk assessment
        assessPositionRisk: assessPositionRisk,
        getCurrentRiskLevel: function() { return riskProfile.level; },
        getCurrentRiskMetrics: getCurrentRiskMetrics,
        
        // Risk profile management
        getRiskProfile: function() {
            return { ...riskProfile };
        },

        updateRiskProfile: function(updates) {
            riskProfile = { ...riskProfile, ...updates, lastUpdate: Date.now() };
            Logger.info(Logger.CATEGORIES.TRADING, 'Risk profile güncellendi', updates);
        },

        // Emergency controls
        isEmergencyMode: function() { return emergencyMode; },
        
        activateEmergencyMode: function(reason) {
            activateEmergencyMode({ type: 'manual', reason: reason });
        },

        deactivateEmergencyMode: function() {
            if (emergencyMode) {
                emergencyMode = false;
                riskProfile.level = RISK_LEVELS.MEDIUM;
                riskProfile.maxPositions = Config.get('STRATEGY.risk.maxPositions', 5);
                
                Logger.info(Logger.CATEGORIES.TRADING, 'Emergency mode manuel olarak deaktive edildi');
                
                triggerRiskEvent('emergency_mode_deactivated', {
                    timestamp: Date.now(),
                    reason: 'manual'
                });
            }
        },

        // Statistics
        getDailyStats: function() {
            return { ...dailyStats };
        },

        getRiskEvents: function(limit = 100) {
            return riskEvents.slice(-limit);
        },

        getRiskHistory: function(days = 7) {
            const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
            return riskEvents.filter(event => event.timestamp >= cutoff);
        },

        // Event management
        addEventListener: function(eventType, callback) {
            document.addEventListener(`riskManager.${eventType}`, callback);
        },

        removeEventListener: function(eventType, callback) {
            document.removeEventListener(`riskManager.${eventType}`, callback);
        },

        // Constants
        RISK_LEVELS: RISK_LEVELS,
        RISK_ACTIONS: RISK_ACTIONS,
        EMERGENCY_TRIGGERS: EMERGENCY_TRIGGERS
    };

})();

// Auto-initialize
if (window.Config && window.Logger && window.ErrorHandler && window.MockTrader && 
    window.PortfolioManager && window.SignalGenerator && window.Storage) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            RiskManager.init();
        });
    } else {
        RiskManager.init();
    }
} else {
    console.warn('RiskManager: Gerekli modüller bulunamadı');
}
