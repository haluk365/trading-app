/**
 * PORTFOLIO MANAGER MODÜLÜ
 * Portföy yönetimi, risk dağılımı ve position allocation
 * Multiple coin'ler arası risk dengesi ve correlation analizi
 */

window.PortfolioManager = (function() {
    'use strict';

    let isInitialized = false;
    let portfolio = null;
    let watchList = new Set();
    let portfolioHistory = [];
    let riskLimits = {};

    const ALLOCATION_STRATEGIES = {
        EQUAL_WEIGHT: 'equal_weight',
        RISK_PARITY: 'risk_parity',
        VOLATILITY_BASED: 'volatility_based',
        SIGNAL_STRENGTH: 'signal_strength'
    };

    const PORTFOLIO_STATUS = {
        ACTIVE: 'active',
        PAUSED: 'paused',
        LIQUIDATING: 'liquidating'
    };

    /**
     * Portfolio Manager'ı başlat
     */
    function init() {
        if (isInitialized) {
            Logger.warning(Logger.CATEGORIES.TRADING, 'PortfolioManager zaten başlatılmış');
            return true;
        }

        try {
            // Portfolio'yu başlat
            initializePortfolio();
            
            // Risk limits'leri kur
            setupRiskLimits();
            
            // Event listener'ları kur
            setupEventListeners();
            
            // Portfolio monitoring başlat
            startPortfolioMonitoring();

            isInitialized = true;
            Logger.success(Logger.CATEGORIES.TRADING, 'PortfolioManager başlatıldı');
            return true;
            
        } catch (error) {
            Logger.error(Logger.CATEGORIES.TRADING, 'PortfolioManager başlatma hatası', error);
            return false;
        }
    }

    /**
     * Portfolio'yu başlat
     */
    function initializePortfolio() {
        portfolio = {
            id: generatePortfolioId(),
            status: PORTFOLIO_STATUS.ACTIVE,
            strategy: ALLOCATION_STRATEGIES.SIGNAL_STRENGTH,
            
            // Holdings
            positions: new Map(),
            watchList: Array.from(watchList),
            
            // Risk settings
            maxPositions: Config.get('STRATEGY.risk.maxPositions', 5),
            maxRiskPerPosition: Config.get('STRATEGY.risk.maxPositionSize', 5.0), // %5
            maxTotalRisk: Config.get('STRATEGY.risk.maxDailyLoss', 20.0), // %20
            
            // Allocation
            totalAllocation: 0,
            availableAllocation: 100,
            
            // Performance
            totalValue: 0,
            totalPnL: 0,
            dailyPnL: 0,
            unrealizedPnL: 0,
            
            // Statistics
            totalTrades: 0,
            activeTrades: 0,
            winRate: 0,
            sharpeRatio: 0,
            maxDrawdown: 0,
            
            createdAt: Date.now(),
            lastUpdate: Date.now()
        };

        // Default watch list
        const defaultCoins = Config.get('COINS.default', ['BTCUSDT', 'ETHUSDT']);
        defaultCoins.forEach(coin => addToWatchList(coin));

        Logger.info(Logger.CATEGORIES.TRADING, 'Portfolio başlatıldı', {
            id: portfolio.id,
            maxPositions: portfolio.maxPositions,
            maxRiskPerPosition: portfolio.maxRiskPerPosition + '%'
        });
    }

    /**
     * Risk limits kur
     */
    function setupRiskLimits() {
        riskLimits = {
            // Position level limits
            maxPositionSize: Config.get('STRATEGY.risk.maxPositionSize', 5.0),
            maxLeverage: Config.get('MOCK_TRADING.maxLeverage', 20),
            
            // Portfolio level limits  
            maxDailyLoss: Config.get('STRATEGY.risk.maxDailyLoss', 10.0),
            maxTotalRisk: 25.0, // Max %25 total exposure
            maxCorrelation: 0.7, // Max 0.7 correlation between positions
            
            // Time based limits
            maxPositionsPerDay: 10,
            cooldownPeriod: 30 * 60 * 1000, // 30 minutes between same symbol trades
            
            // Volatility limits
            maxVolatility: 5.0, // Max %5 daily volatility per position
            
            lastReset: Date.now()
        };

        Logger.debug(Logger.CATEGORIES.TRADING, 'Risk limits kuruldu', riskLimits);
    }

    /**
     * Event listener'ları kur
     */
    function setupEventListeners() {
        // MockTrader events
        MockTrader.addEventListener('position_opened', handlePositionOpened);
        MockTrader.addEventListener('position_closed', handlePositionClosed);
        
        // SignalGenerator events
        SignalGenerator.addEventListener('signal_changed', handleSignalChanged);
    }

    /**
     * Portfolio monitoring başlat
     */
    function startPortfolioMonitoring() {
        setInterval(() => {
            updatePortfolioMetrics();
            checkRiskLimits();
            recordPortfolioSnapshot();
        }, 30 * 1000); // Her 30 saniye
    }

    /**
     * Watch list'e coin ekle
     */
    function addToWatchList(symbol) {
        if (!Config.isValidPair(symbol)) {
            throw new Error('Geçersiz symbol: ' + symbol);
        }

        watchList.add(symbol);
        
        if (portfolio) {
            portfolio.watchList = Array.from(watchList);
            Logger.info(Logger.CATEGORIES.TRADING, `Watch list'e eklendi: ${symbol}`);
        }

        return true;
    }

    /**
     * Watch list'ten coin çıkar
     */
    function removeFromWatchList(symbol) {
        const removed = watchList.delete(symbol);
        
        if (removed && portfolio) {
            portfolio.watchList = Array.from(watchList);
            Logger.info(Logger.CATEGORIES.TRADING, `Watch list'ten çıkarıldı: ${symbol}`);
        }

        return removed;
    }

    /**
     * Position allocation hesapla
     */
    function calculatePositionAllocation(symbol, signalStrength, riskLevel) {
        if (!portfolio || portfolio.status !== PORTFOLIO_STATUS.ACTIVE) {
            return 0;
        }

        // Base allocation (strategy'e göre)
        let baseAllocation = 0;
        
        switch (portfolio.strategy) {
            case ALLOCATION_STRATEGIES.EQUAL_WEIGHT:
                baseAllocation = portfolio.maxRiskPerPosition;
                break;
                
            case ALLOCATION_STRATEGIES.SIGNAL_STRENGTH:
                // Signal strength'e göre allocation (1-5%)
                baseAllocation = Math.min(
                    1 + (signalStrength * 4), // 1% + (0-1) * 4% = 1-5%
                    portfolio.maxRiskPerPosition
                );
                break;
                
            case ALLOCATION_STRATEGIES.VOLATILITY_BASED:
                // Volatilite'ye ters orantılı allocation
                const volatility = getSymbolVolatility(symbol);
                baseAllocation = Math.min(
                    portfolio.maxRiskPerPosition / Math.max(volatility, 1),
                    portfolio.maxRiskPerPosition
                );
                break;
                
            case ALLOCATION_STRATEGIES.RISK_PARITY:
                // Risk parity allocation
                baseAllocation = calculateRiskParityAllocation(symbol);
                break;
                
            default:
                baseAllocation = portfolio.maxRiskPerPosition;
        }

        // Risk level adjustment
        const riskAdjustment = riskLevel || 1.0;
        const adjustedAllocation = baseAllocation * riskAdjustment;

        // Available allocation kontrolü
        const finalAllocation = Math.min(
            adjustedAllocation,
            portfolio.availableAllocation,
            portfolio.maxRiskPerPosition
        );

        Logger.debug(Logger.CATEGORIES.TRADING, `Position allocation hesaplandı: ${symbol}`, {
            baseAllocation: baseAllocation.toFixed(2) + '%',
            riskAdjustment: riskAdjustment,
            finalAllocation: finalAllocation.toFixed(2) + '%'
        });

        return finalAllocation;
    }

    /**
     * Symbol volatility al
     */
    function getSymbolVolatility(symbol) {
        try {
            // Cache'den volatility bilgisi al
            const cached = Storage.cache.get(`volatility_${symbol}`);
            return cached ? cached : 2.0; // Default %2
        } catch (error) {
            return 2.0; // Fallback
        }
    }

    /**
     * Risk parity allocation hesapla
     */
    function calculateRiskParityAllocation(symbol) {
        const activePositions = MockTrader.getActivePositions();
        const totalPositions = activePositions.length;
        
        if (totalPositions === 0) {
            return portfolio.maxRiskPerPosition;
        }

        // Equal risk distribution
        const equalRiskAllocation = portfolio.maxTotalRisk / (totalPositions + 1);
        return Math.min(equalRiskAllocation, portfolio.maxRiskPerPosition);
    }

    /**
     * Position uygunluğu kontrol et
     */
    function checkPositionEligibility(symbol, side, signalData) {
        const checks = {
            symbolInWatchList: watchList.has(symbol),
            portfolioActive: portfolio.status === PORTFOLIO_STATUS.ACTIVE,
            maxPositionsLimit: portfolio.positions.size < portfolio.maxPositions,
            riskLimitOk: true,
            correlationOk: true,
            cooldownOk: true,
            volatilityOk: true,
            allocationAvailable: portfolio.availableAllocation > 0
        };

        // Risk limit kontrolü
        const account = MockTrader.getAccount();
        if (account) {
            const currentDrawdown = ((account.maxBalance - account.balance) / account.maxBalance) * 100;
            checks.riskLimitOk = currentDrawdown < riskLimits.maxDailyLoss;
        }

        // Correlation kontrolü
        checks.correlationOk = checkCorrelationLimit(symbol);

        // Cooldown kontrolü
        checks.cooldownOk = checkCooldownPeriod(symbol);

        // Volatility kontrolü
        const volatility = getSymbolVolatility(symbol);
        checks.volatilityOk = volatility <= riskLimits.maxVolatility;

        const isEligible = Object.values(checks).every(check => check === true);

        Logger.debug(Logger.CATEGORIES.TRADING, `Position eligibility: ${symbol}`, {
            eligible: isEligible,
            checks: checks
        });

        return {
            isEligible: isEligible,
            checks: checks,
            reason: isEligible ? 'All checks passed' : getFailedChecks(checks)
        };
    }

    /**
     * Correlation limit kontrolü
     */
    function checkCorrelationLimit(newSymbol) {
        const activePositions = MockTrader.getActivePositions();
        
        for (const position of activePositions) {
            const correlation = calculateSymbolCorrelation(newSymbol, position.symbol);
            if (correlation > riskLimits.maxCorrelation) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * Symbol correlation hesapla
     */
    function calculateSymbolCorrelation(symbol1, symbol2) {
        if (symbol1 === symbol2) return 1.0;
        
        // Basit correlation hesaplama (cache'den al veya hesapla)
        const cacheKey = `correlation_${symbol1}_${symbol2}`;
        const cached = Storage.cache.get(cacheKey);
        
        if (cached) return cached;
        
        // Cryptocurrency correlation patterns (simplified)
        const correlationMap = {
            'BTCUSDT': { 'ETHUSDT': 0.8, 'ADAUSDT': 0.6, 'BNBUSDT': 0.5 },
            'ETHUSDT': { 'BTCUSDT': 0.8, 'ADAUSDT': 0.7, 'BNBUSDT': 0.6 },
            'ADAUSDT': { 'BTCUSDT': 0.6, 'ETHUSDT': 0.7, 'BNBUSDT': 0.4 }
        };
        
        const correlation = correlationMap[symbol1]?.[symbol2] || 0.3; // Default low correlation
        
        // Cache'e kaydet
        Storage.cache.set(cacheKey, correlation, 60 * 60 * 1000); // 1 saat
        
        return correlation;
    }

    /**
     * Cooldown period kontrolü
     */
    function checkCooldownPeriod(symbol) {
        const history = MockTrader.getTradeHistory(50);
        const now = Date.now();
        
        for (const trade of history) {
            if (trade.symbol === symbol && 
                trade.closeTime && 
                (now - trade.closeTime) < riskLimits.cooldownPeriod) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * Failed checks'i listele
     */
    function getFailedChecks(checks) {
        const failed = [];
        
        Object.entries(checks).forEach(([key, value]) => {
            if (!value) {
                failed.push(key);
            }
        });
        
        return failed.join(', ');
    }

    /**
     * Position recommendation al
     */
    async function getPositionRecommendation(symbol) {
        try {
            // Signal analizi
            const multiData = await DataProcessor.getMultiTimeframeData(symbol, ['4h', '1h', '15m']);
            const signalAnalysis = await SignalGenerator.analyzeSymbol(symbol, multiData);
            
            if (!signalAnalysis || signalAnalysis.recommendation === 'neutral') {
                return {
                    symbol: symbol,
                    recommendation: 'hold',
                    reason: 'No clear signal',
                    allocation: 0
                };
            }

            // Eligibility kontrolü
            const eligibility = checkPositionEligibility(symbol, signalAnalysis.recommendation, signalAnalysis);
            
            if (!eligibility.isEligible) {
                return {
                    symbol: symbol,
                    recommendation: 'hold',
                    reason: eligibility.reason,
                    allocation: 0,
                    eligibility: eligibility
                };
            }

            // Allocation hesapla
            const allocation = calculatePositionAllocation(
                symbol, 
                signalAnalysis.confidence,
                1.0
            );

            return {
                symbol: symbol,
                recommendation: signalAnalysis.recommendation,
                confidence: signalAnalysis.confidence,
                allocation: allocation,
                signalAnalysis: signalAnalysis,
                eligibility: eligibility,
                timestamp: Date.now()
            };

        } catch (error) {
            Logger.error(Logger.CATEGORIES.TRADING, `Position recommendation hatası: ${symbol}`, error);
            return {
                symbol: symbol,
                recommendation: 'hold',
                reason: 'Analysis error: ' + error.message,
                allocation: 0
            };
        }
    }

    /**
     * Portfolio recommendations al
     */
    async function getPortfolioRecommendations() {
        Logger.info(Logger.CATEGORIES.TRADING, `Portfolio recommendations hesaplanıyor: ${watchList.size} symbol`);

        const recommendations = [];
        const promises = Array.from(watchList).map(symbol => 
            getPositionRecommendation(symbol)
        );

        const results = await Promise.allSettled(promises);
        
        results.forEach((result, index) => {
            const symbol = Array.from(watchList)[index];
            
            if (result.status === 'fulfilled') {
                recommendations.push(result.value);
            } else {
                Logger.error(Logger.CATEGORIES.TRADING, `Recommendation hatası: ${symbol}`, result.reason);
                recommendations.push({
                    symbol: symbol,
                    recommendation: 'hold',
                    reason: 'Error: ' + result.reason.message,
                    allocation: 0
                });
            }
        });

        // Recommendations'ı confidence'e göre sırala
        recommendations.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

        Logger.success(Logger.CATEGORIES.TRADING, 'Portfolio recommendations hazır', {
            total: recommendations.length,
            actionable: recommendations.filter(r => r.allocation > 0).length
        });

        return recommendations;
    }

    /**
     * Position handle events
     */
    function handlePositionOpened(event) {
        const position = event.detail;
        
        // Portfolio'da position'ı track et
        portfolio.positions.set(position.id, {
            id: position.id,
            symbol: position.symbol,
            side: position.side,
            allocation: (position.marginUsed / MockTrader.getAccount().balance) * 100,
            openTime: position.openTime,
            signalId: position.signalId
        });

        // Available allocation güncelle
        updateAvailableAllocation();
        
        Logger.debug(Logger.CATEGORIES.TRADING, `Portfolio position eklendi: ${position.symbol}`);
    }

    /**
     * Position closed handler
     */
    function handlePositionClosed(event) {
        const position = event.detail;
        
        // Portfolio'dan position'ı çıkar
        portfolio.positions.delete(position.id);
        
        // Available allocation güncelle
        updateAvailableAllocation();
        
        Logger.debug(Logger.CATEGORIES.TRADING, `Portfolio position çıkarıldı: ${position.symbol}`);
    }

    /**
     * Signal changed handler
     */
    function handleSignalChanged(event) {
        const { symbol, newSignal } = event.detail;
        
        if (watchList.has(symbol)) {
            Logger.debug(Logger.CATEGORIES.TRADING, `Watch list symbol sinyal değişti: ${symbol} → ${newSignal}`);
            
            // Async recommendation update
            getPositionRecommendation(symbol).then(recommendation => {
                triggerPortfolioEvent('recommendation_updated', {
                    symbol: symbol,
                    recommendation: recommendation
                });
            });
        }
    }

    /**
     * Available allocation güncelle
     */
    function updateAvailableAllocation() {
        let totalUsed = 0;
        
        for (const portfolioPosition of portfolio.positions.values()) {
            totalUsed += portfolioPosition.allocation;
        }
        
        portfolio.totalAllocation = totalUsed;
        portfolio.availableAllocation = Math.max(0, 100 - totalUsed);
        
        Logger.debug(Logger.CATEGORIES.TRADING, 'Allocation güncellendi', {
            total: portfolio.totalAllocation.toFixed(2) + '%',
            available: portfolio.availableAllocation.toFixed(2) + '%'
        });
    }

    /**
     * Portfolio metrics güncelle
     */
    function updatePortfolioMetrics() {
        if (!portfolio) return;

        try {
            const account = MockTrader.getAccount();
            const stats = MockTrader.getAccountStats();
            
            if (account && stats) {
                portfolio.totalValue = account.equity;
                portfolio.totalPnL = account.totalPnL;
                portfolio.unrealizedPnL = stats.unrealizedPnL;
                portfolio.totalTrades = stats.totalTrades;
                portfolio.activeTrades = stats.activePositions;
                portfolio.winRate = stats.winRate;
                portfolio.maxDrawdown = stats.maxDrawdown;
                
                // Daily P&L hesapla
                const today = new Date().toDateString();
                const todayHistory = portfolioHistory.filter(h => 
                    new Date(h.timestamp).toDateString() === today
                );
                
                if (todayHistory.length > 0) {
                    const firstToday = todayHistory[0];
                    portfolio.dailyPnL = portfolio.totalValue - firstToday.totalValue;
                }
                
                portfolio.lastUpdate = Date.now();
            }
            
        } catch (error) {
            Logger.error(Logger.CATEGORIES.TRADING, 'Portfolio metrics güncelleme hatası', error);
        }
    }

    /**
     * Risk limits kontrolü
     */
    function checkRiskLimits() {
        if (!portfolio) return;

        const account = MockTrader.getAccount();
        if (!account) return;

        const alerts = [];

        // Daily loss limit
        const dailyLossPercent = Math.abs(portfolio.dailyPnL / account.balance) * 100;
        if (dailyLossPercent > riskLimits.maxDailyLoss * 0.8) { // %80'e ulaştığında uyar
            alerts.push({
                type: 'daily_loss_warning',
                message: `Günlük kayıp limiti %${riskLimits.maxDailyLoss}'nin %80'ine ulaştı`,
                current: dailyLossPercent,
                limit: riskLimits.maxDailyLoss
            });
        }

        // Total allocation limit
        if (portfolio.totalAllocation > portfolio.maxTotalRisk * 0.9) {
            alerts.push({
                type: 'allocation_warning',
                message: `Toplam risk allocation %${portfolio.maxTotalRisk}'nin %90'ına ulaştı`,
                current: portfolio.totalAllocation,
                limit: portfolio.maxTotalRisk
            });
        }

        // Max positions limit
        if (portfolio.positions.size >= portfolio.maxPositions * 0.8) {
            alerts.push({
                type: 'position_count_warning',
                message: `Maksimum pozisyon sayısının %80'ine ulaşıldı`,
                current: portfolio.positions.size,
                limit: portfolio.maxPositions
            });
        }

        // Alerts'leri trigger et
        alerts.forEach(alert => {
            Logger.warning(Logger.CATEGORIES.TRADING, alert.message, alert);
            triggerPortfolioEvent('risk_alert', alert);
        });
    }

    /**
     * Portfolio snapshot kaydet
     */
    function recordPortfolioSnapshot() {
        if (!portfolio) return;

        const snapshot = {
            timestamp: Date.now(),
            totalValue: portfolio.totalValue,
            totalPnL: portfolio.totalPnL,
            dailyPnL: portfolio.dailyPnL,
            unrealizedPnL: portfolio.unrealizedPnL,
            activePositions: portfolio.activeTrades,
            totalAllocation: portfolio.totalAllocation,
            winRate: portfolio.winRate
        };

        portfolioHistory.push(snapshot);

        // History limitini koru (son 1000 snapshot)
        if (portfolioHistory.length > 1000) {
            portfolioHistory = portfolioHistory.slice(-1000);
        }
    }

    /**
     * Portfolio event trigger
     */
    function triggerPortfolioEvent(eventType, eventData) {
        const event = new CustomEvent(`portfolioManager.${eventType}`, {
            detail: eventData
        });
        
        document.dispatchEvent(event);
        Logger.debug(Logger.CATEGORIES.TRADING, `Portfolio event triggered: ${eventType}`);
    }

    /**
     * Portfolio ID oluştur
     */
    function generatePortfolioId() {
        return 'portfolio_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }

    // Public API
    return {
        // Initialization
        init: init,
        isInitialized: function() { return isInitialized; },

        // Watch list management
        addToWatchList: addToWatchList,
        removeFromWatchList: removeFromWatchList,
        getWatchList: function() {
            return Array.from(watchList);
        },

        // Portfolio management
        getPortfolio: function() {
            return portfolio ? { ...portfolio, positions: Array.from(portfolio.positions.values()) } : null;
        },

        setAllocationStrategy: function(strategy) {
            if (Object.values(ALLOCATION_STRATEGIES).includes(strategy)) {
                portfolio.strategy = strategy;
                Logger.info(Logger.CATEGORIES.TRADING, `Allocation strategy değiştirildi: ${strategy}`);
                return true;
            }
            return false;
        },

        // Recommendations
        getPositionRecommendation: getPositionRecommendation,
        getPortfolioRecommendations: getPortfolioRecommendations,

        // Risk management
        checkPositionEligibility: checkPositionEligibility,
        calculatePositionAllocation: calculatePositionAllocation,
        getRiskLimits: function() {
            return { ...riskLimits };
        },

        updateRiskLimits: function(newLimits) {
            riskLimits = { ...riskLimits, ...newLimits };
            Logger.info(Logger.CATEGORIES.TRADING, 'Risk limits güncellendi', newLimits);
        },

        // Analytics
        getPortfolioHistory: function(limit = 100) {
            return portfolioHistory.slice(-limit);
        },

        getPerformanceMetrics: function() {
            if (!portfolio || portfolioHistory.length < 2) return null;

            const recent = portfolioHistory.slice(-30); // Son 30 snapshot
            const returns = recent.map((snapshot, index) => {
                if (index === 0) return 0;
                return (snapshot.totalValue - recent[index - 1].totalValue) / recent[index - 1].totalValue;
            }).slice(1);

            const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
            const volatility = Math.sqrt(
                returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
            );

            return {
                totalReturn: portfolio.totalPnL,
                avgDailyReturn: avgReturn,
                volatility: volatility,
                sharpeRatio: volatility > 0 ? avgReturn / volatility : 0,
                maxDrawdown: portfolio.maxDrawdown,
                winRate: portfolio.winRate,
                totalTrades: portfolio.totalTrades,
                activeTrades: portfolio.activeTrades
            };
        },

        // Event management
        addEventListener: function(eventType, callback) {
            document.addEventListener(`portfolioManager.${eventType}`, callback);
        },

        removeEventListener: function(eventType, callback) {
            document.removeEventListener(`portfolioManager.${eventType}`, callback);
        },

        // Constants
        ALLOCATION_STRATEGIES: ALLOCATION_STRATEGIES,
        PORTFOLIO_STATUS: PORTFOLIO_STATUS
    };

})();

// Auto-initialize
if (window.Config && window.Logger && window.ErrorHandler && window.DataProcessor && 
    window.SignalGenerator && window.MockTrader && window.Storage) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            PortfolioManager.init();
        });
    } else {
        PortfolioManager.init();
    }
} else {
    console.warn('PortfolioManager: Gerekli modüller bulunamadı');
}
