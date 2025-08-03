/**
 * MOCK TRADER MODÜLÜ
 * Gerçek işlem yapmadan stratejiyi test etme sistemi
 * Sanal bakiye, leverage, fee ve slippage simülasyonu
 */

window.MockTrader = (function() {
    'use strict';

    let isInitialized = false;
    let mockAccount = null;
    let activePositions = new Map();
    let tradeHistory = [];
    let orderBook = new Map();

    const POSITION_TYPES = {
        LONG: 'long',
        SHORT: 'short'
    };

    const POSITION_STATUS = {
        OPEN: 'open',
        CLOSED: 'closed',
        LIQUIDATED: 'liquidated'
    };

    const ORDER_TYPES = {
        MARKET: 'market',
        LIMIT: 'limit',
        STOP_LOSS: 'stop_loss',
        TAKE_PROFIT: 'take_profit'
    };

    /**
     * Mock Trader'ı başlat
     */
    function init() {
        if (isInitialized) {
            Logger.warning(Logger.CATEGORIES.TRADING, 'MockTrader zaten başlatılmış');
            return true;
        }

        try {
            // Mock account oluştur
            initializeMockAccount();
            
            // Position monitoring başlat
            startPositionMonitoring();
            
            // Data event listener'ları kur
            setupDataEventListeners();

            isInitialized = true;
            Logger.success(Logger.CATEGORIES.TRADING, 'MockTrader başlatıldı', {
                initialBalance: mockAccount.balance,
                maxLeverage: mockAccount.maxLeverage
            });
            
            return true;
            
        } catch (error) {
            Logger.error(Logger.CATEGORIES.TRADING, 'MockTrader başlatma hatası', error);
            return false;
        }
    }

    /**
     * Mock account başlatma
     */
    function initializeMockAccount() {
        const config = Config.get('MOCK_TRADING', {});
        
        mockAccount = {
            balance: config.initialBalance || 10000, // USDT
            equity: config.initialBalance || 10000,
            margin: 0,
            freeMargin: config.initialBalance || 10000,
            marginLevel: 0,
            maxLeverage: config.maxLeverage || 20,
            defaultLeverage: config.defaultLeverage || 10,
            
            // Fees
            fees: {
                enabled: config.fees?.enabled || true,
                maker: config.fees?.maker || 0.02, // %0.02
                taker: config.fees?.taker || 0.04  // %0.04
            },
            
            // Slippage
            slippage: {
                enabled: config.slippage?.enabled || true,
                percentage: config.slippage?.percentage || 0.1 // %0.1
            },
            
            // Statistics
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            totalPnL: 0,
            maxDrawdown: 0,
            maxBalance: config.initialBalance || 10000,
            
            createdAt: Date.now()
        };

        Logger.info(Logger.CATEGORIES.TRADING, 'Mock account oluşturuldu', {
            balance: mockAccount.balance,
            maxLeverage: mockAccount.maxLeverage
        });
    }

    /**
     * Position monitoring başlat
     */
    function startPositionMonitoring() {
        setInterval(() => {
            updateActivePositions();
        }, 1000); // Her saniye kontrol
    }

    /**
     * Data event listener'ları kur
     */
    function setupDataEventListeners() {
        // Real-time price updates için
        DataProcessor.addEventListener('kline_updated', (event) => {
            const { symbol, candle } = event.detail;
            updatePositionPrices(symbol, parseFloat(candle.close));
        });

        // Ticker updates için
        DataProcessor.addEventListener('ticker_updated', (event) => {
            const { symbol, ticker } = event.detail;
            updatePositionPrices(symbol, parseFloat(ticker.price));
        });
    }

    /**
     * Market order aç
     */
    async function openMarketOrder(symbol, side, quantity, leverage = null, options = {}) {
        return ErrorHandler.safeAsync(async function() {
            if (!mockAccount) {
                throw new Error('Mock account başlatılmamış');
            }

            Logger.info(Logger.CATEGORIES.TRADING, `Market order açılıyor: ${symbol}`, {
                side: side,
                quantity: quantity,
                leverage: leverage || mockAccount.defaultLeverage
            });

            // Current price al
            const currentPrice = await getCurrentPrice(symbol);
            if (!currentPrice) {
                throw new Error('Current price alınamadı: ' + symbol);
            }

            // Position parametrelerini hesapla
            const positionLeverage = leverage || mockAccount.defaultLeverage;
            const positionSize = quantity;
            const notionalValue = positionSize * currentPrice;
            const marginRequired = notionalValue / positionLeverage;

            // Margin kontrolü
            if (marginRequired > mockAccount.freeMargin) {
                throw new Error(`Yetersiz margin. Gerekli: ${marginRequired.toFixed(2)}, Mevcut: ${mockAccount.freeMargin.toFixed(2)}`);
            }

            // Slippage uygula
            const executionPrice = applySlippage(currentPrice, side);

            // Fee hesapla
            const feeAmount = calculateFee(notionalValue, 'taker');

            // ATR bazlı stop-loss hesapla
            const stopLoss = await calculateATRStopLoss(symbol, executionPrice, side);

            // Position oluştur
            const position = {
                id: generatePositionId(),
                symbol: symbol,
                side: side,
                type: POSITION_TYPES[side.toUpperCase()],
                status: POSITION_STATUS.OPEN,
                
                size: positionSize,
                leverage: positionLeverage,
                entryPrice: executionPrice,
                currentPrice: executionPrice,
                notionalValue: notionalValue,
                marginUsed: marginRequired,
                
                stopLoss: stopLoss,
                takeProfit: null,
                
                unrealizedPnL: 0,
                realizedPnL: 0,
                
                fees: feeAmount,
                totalFees: feeAmount,
                
                openTime: Date.now(),
                lastUpdate: Date.now(),
                
                // Metadata
                openedBy: options.openedBy || 'manual',
                strategy: options.strategy || null,
                signalId: options.signalId || null,
                
                // Trailing stop
                trailingStop: {
                    enabled: false,
                    triggerPrice: null,
                    distance: null,
                    highestProfit: 0
                }
            };

            // Account'u güncelle
            mockAccount.margin += marginRequired;
            mockAccount.freeMargin -= marginRequired;
            mockAccount.balance -= feeAmount;
            mockAccount.totalTrades++;

            // Position'ı kaydet
            activePositions.set(position.id, position);

            Logger.success(Logger.CATEGORIES.TRADING, `Position açıldı: ${position.id}`, {
                symbol: symbol,
                side: side,
                size: positionSize,
                entryPrice: executionPrice.toFixed(2),
                stopLoss: stopLoss.toFixed(2),
                margin: marginRequired.toFixed(2),
                fee: feeAmount.toFixed(2)
            });

            // Event trigger
            triggerTradeEvent('position_opened', position);

            return position;

        }, `Open Market Order: ${symbol} ${side}`)();
    }

    /**
     * Position kapat
     */
    async function closePosition(positionId, reason = 'manual', currentPrice = null) {
        return ErrorHandler.safeAsync(async function() {
            const position = activePositions.get(positionId);
            if (!position) {
                throw new Error('Position bulunamadı: ' + positionId);
            }

            if (position.status !== POSITION_STATUS.OPEN) {
                throw new Error('Position zaten kapalı: ' + positionId);
            }

            Logger.info(Logger.CATEGORIES.TRADING, `Position kapatılıyor: ${positionId}`, {
                reason: reason,
                symbol: position.symbol
            });

            // Exit price belirle
            const exitPrice = currentPrice || await getCurrentPrice(position.symbol);
            if (!exitPrice) {
                throw new Error('Exit price alınamadı: ' + position.symbol);
            }

            // Slippage uygula
            const executionPrice = applySlippage(exitPrice, position.side === 'long' ? 'short' : 'long');

            // Final P&L hesapla
            const pnl = calculatePositionPnL(position, executionPrice);
            const exitFee = calculateFee(position.size * executionPrice, 'taker');
            const netPnL = pnl - exitFee;

            // Position'ı güncelle
            position.status = POSITION_STATUS.CLOSED;
            position.currentPrice = executionPrice;
            position.exitPrice = executionPrice;
            position.closeTime = Date.now();
            position.closeReason = reason;
            position.realizedPnL = netPnL;
            position.totalFees += exitFee;

            // Account'u güncelle
            mockAccount.margin -= position.marginUsed;
            mockAccount.freeMargin += position.marginUsed;
            mockAccount.balance += netPnL - exitFee;
            mockAccount.equity = mockAccount.balance + getCurrentUnrealizedPnL();
            mockAccount.totalPnL += netPnL;

            // Statistics güncelle
            if (netPnL > 0) {
                mockAccount.winningTrades++;
            } else {
                mockAccount.losingTrades++;
            }

            // Max balance/drawdown güncelle
            if (mockAccount.balance > mockAccount.maxBalance) {
                mockAccount.maxBalance = mockAccount.balance;
            }

            const drawdown = (mockAccount.maxBalance - mockAccount.balance) / mockAccount.maxBalance * 100;
            if (drawdown > mockAccount.maxDrawdown) {
                mockAccount.maxDrawdown = drawdown;
            }

            // Position'ı history'ye taşı
            activePositions.delete(positionId);
            tradeHistory.push({ ...position });

            // History limitini koru
            if (tradeHistory.length > 1000) {
                tradeHistory = tradeHistory.slice(-1000);
            }

            Logger.success(Logger.CATEGORIES.TRADING, `Position kapatıldı: ${positionId}`, {
                pnl: netPnL.toFixed(2),
                percentage: ((netPnL / position.marginUsed) * 100).toFixed(2) + '%',
                reason: reason,
                duration: Utils.Format.duration(position.closeTime - position.openTime)
            });

            // Event trigger
            triggerTradeEvent('position_closed', position);

            return position;

        }, `Close Position: ${positionId}`)();
    }

    /**
     * Stop-loss/Take-profit tetikleme
     */
    function checkStopLossTakeProfit(position, currentPrice) {
        let shouldClose = false;
        let reason = null;

        if (position.side === 'long') {
            // Long position
            if (position.stopLoss && currentPrice <= position.stopLoss) {
                shouldClose = true;
                reason = 'stop_loss';
            } else if (position.takeProfit && currentPrice >= position.takeProfit) {
                shouldClose = true;
                reason = 'take_profit';
            }
        } else {
            // Short position
            if (position.stopLoss && currentPrice >= position.stopLoss) {
                shouldClose = true;
                reason = 'stop_loss';
            } else if (position.takeProfit && currentPrice <= position.takeProfit) {
                shouldClose = true;
                reason = 'take_profit';
            }
        }

        return { shouldClose, reason };
    }

    /**
     * Trailing stop kontrolü
     */
    function updateTrailingStop(position, currentPrice) {
        if (!position.trailingStop.enabled) return;

        const currentPnL = calculatePositionPnL(position, currentPrice);
        const currentPnLPercentage = (currentPnL / position.marginUsed) * 100;

        // Highest profit güncelle
        if (currentPnL > position.trailingStop.highestProfit) {
            position.trailingStop.highestProfit = currentPnL;
        }

        // Trailing stop distance'ı güncelle
        const trailingPercent = Config.get('STRATEGY.risk.trailingStopPercentage', 30.0);
        const profitFromEntry = Math.abs(currentPnL);
        const trailingDistance = profitFromEntry * (trailingPercent / 100);

        if (position.side === 'long') {
            const proposedStopLoss = currentPrice - trailingDistance;
            if (proposedStopLoss > position.stopLoss) {
                position.stopLoss = proposedStopLoss;
                
                Logger.debug(Logger.CATEGORIES.TRADING, `Trailing stop güncellendi: ${position.id}`, {
                    newStopLoss: proposedStopLoss.toFixed(2),
                    currentPrice: currentPrice.toFixed(2),
                    pnl: currentPnLPercentage.toFixed(2) + '%'
                });
            }
        } else {
            const proposedStopLoss = currentPrice + trailingDistance;
            if (proposedStopLoss < position.stopLoss) {
                position.stopLoss = proposedStopLoss;
                
                Logger.debug(Logger.CATEGORIES.TRADING, `Trailing stop güncellendi: ${position.id}`, {
                    newStopLoss: proposedStopLoss.toFixed(2),
                    currentPrice: currentPrice.toFixed(2),
                    pnl: currentPnLPercentage.toFixed(2) + '%'
                });
            }
        }
    }

    /**
     * Aktif pozisyonları güncelle
     */
    function updateActivePositions() {
        for (const [positionId, position] of activePositions.entries()) {
            ErrorHandler.safeExecute(() => {
                // Current price güncelle (cache'den al)
                const currentPrice = getCachedPrice(position.symbol);
                if (!currentPrice) return;

                // Position'ı güncelle
                position.currentPrice = currentPrice;
                position.unrealizedPnL = calculatePositionPnL(position, currentPrice);
                position.lastUpdate = Date.now();

                // Trailing stop kontrolü
                updateTrailingStop(position, currentPrice);

                // Stop-loss/Take-profit kontrolü
                const { shouldClose, reason } = checkStopLossTakeProfit(position, currentPrice);
                
                if (shouldClose) {
                    closePosition(positionId, reason, currentPrice);
                }

            }, `Update Position: ${positionId}`);
        }

        // Account equity güncelle
        if (mockAccount) {
            mockAccount.equity = mockAccount.balance + getCurrentUnrealizedPnL();
            
            // Margin level hesapla
            if (mockAccount.margin > 0) {
                mockAccount.marginLevel = (mockAccount.equity / mockAccount.margin) * 100;
            } else {
                mockAccount.marginLevel = 0;
            }
        }
    }

    /**
     * Position prices güncelle
     */
    function updatePositionPrices(symbol, price) {
        for (const [positionId, position] of activePositions.entries()) {
            if (position.symbol === symbol) {
                position.currentPrice = price;
                position.unrealizedPnL = calculatePositionPnL(position, price);
                position.lastUpdate = Date.now();
            }
        }
    }

    /**
     * Current price al (cache'den veya API'den)
     */
    async function getCurrentPrice(symbol) {
        // Önce cache'den kontrol et
        const cached = getCachedPrice(symbol);
        if (cached) return cached;

        try {
            // API'den al
            const price = await BinanceAPI.getCurrentPrice(symbol);
            return price;
        } catch (error) {
            Logger.error(Logger.CATEGORIES.TRADING, `Current price alınamadı: ${symbol}`, error);
            return null;
        }
    }

    /**
     * Cached price al
     */
    function getCachedPrice(symbol) {
        const cached = Storage.cache.get(`ticker_${symbol}`);
        return cached ? parseFloat(cached.price) : null;
    }

    /**
     * Slippage uygula
     */
    function applySlippage(price, side) {
        if (!mockAccount.slippage.enabled) return price;

        const slippagePercent = mockAccount.slippage.percentage / 100;
        
        if (side === 'long') {
            // Long için yukarı slippage
            return price * (1 + slippagePercent);
        } else {
            // Short için aşağı slippage
            return price * (1 - slippagePercent);
        }
    }

    /**
     * Fee hesapla
     */
    function calculateFee(notionalValue, orderType = 'taker') {
        if (!mockAccount.fees.enabled) return 0;

        const feeRate = orderType === 'maker' ? 
            mockAccount.fees.maker / 100 : 
            mockAccount.fees.taker / 100;

        return notionalValue * feeRate;
    }

    /**
     * Position P&L hesapla
     */
    function calculatePositionPnL(position, currentPrice) {
        const priceChange = currentPrice - position.entryPrice;
        
        if (position.side === 'long') {
            return priceChange * position.size;
        } else {
            return -priceChange * position.size;
        }
    }

    /**
     * ATR bazlı stop-loss hesapla
     */
    async function calculateATRStopLoss(symbol, entryPrice, side) {
        try {
            // 15M timeframe'den ATR al
            const multiData = await DataProcessor.getMultiTimeframeData(symbol, ['15m']);
            const atrResult = ATR.analyzeMultiTimeframe(multiData);
            
            if (atrResult['15m']) {
                const atrValue = atrResult['15m'].atr;
                const multiplier = Config.get('STRATEGY.atr.multiplier', 1.5);
                
                if (side === 'long') {
                    return entryPrice - (atrValue * multiplier);
                } else {
                    return entryPrice + (atrValue * multiplier);
                }
            }
        } catch (error) {
            Logger.warning(Logger.CATEGORIES.TRADING, `ATR stop-loss hesaplanamadı: ${symbol}`, error);
        }

        // Fallback: %2 stop-loss
        const fallbackPercent = 0.02;
        if (side === 'long') {
            return entryPrice * (1 - fallbackPercent);
        } else {
            return entryPrice * (1 + fallbackPercent);
        }
    }

    /**
     * Current unrealized P&L hesapla
     */
    function getCurrentUnrealizedPnL() {
        let totalUnrealizedPnL = 0;
        
        for (const position of activePositions.values()) {
            totalUnrealizedPnL += position.unrealizedPnL;
        }
        
        return totalUnrealizedPnL;
    }

    /**
     * Trailing stop aktif et
     */
    function enableTrailingStop(positionId) {
        const position = activePositions.get(positionId);
        if (!position) {
            throw new Error('Position bulunamadı: ' + positionId);
        }

        // Trigger noktasını hesapla (2x initial risk)
        const initialRisk = Math.abs(position.entryPrice - position.stopLoss);
        const triggerProfit = initialRisk * 2;

        position.trailingStop.enabled = true;
        position.trailingStop.triggerPrice = position.entryPrice + 
            (position.side === 'long' ? triggerProfit : -triggerProfit);

        Logger.info(Logger.CATEGORIES.TRADING, `Trailing stop aktif edildi: ${positionId}`, {
            triggerPrice: position.trailingStop.triggerPrice.toFixed(2),
            currentPrice: position.currentPrice.toFixed(2)
        });

        return position;
    }

    /**
     * Position ID oluştur
     */
    function generatePositionId() {
        return 'pos_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }

    /**
     * Trade event trigger
     */
    function triggerTradeEvent(eventType, position) {
        const event = new CustomEvent(`mockTrader.${eventType}`, {
            detail: position
        });
        
        document.dispatchEvent(event);
        Logger.debug(Logger.CATEGORIES.TRADING, `Trade event triggered: ${eventType}`, {
            positionId: position.id,
            symbol: position.symbol
        });
    }

    /**
     * Account reset
     */
    function resetAccount() {
        // Tüm pozisyonları kapat
        const positionIds = Array.from(activePositions.keys());
        positionIds.forEach(id => {
            closePosition(id, 'account_reset');
        });

        // Account'u sıfırla
        const initialBalance = Config.get('MOCK_TRADING.initialBalance', 10000);
        mockAccount.balance = initialBalance;
        mockAccount.equity = initialBalance;
        mockAccount.margin = 0;
        mockAccount.freeMargin = initialBalance;
        mockAccount.marginLevel = 0;
        mockAccount.totalTrades = 0;
        mockAccount.winningTrades = 0;
        mockAccount.losingTrades = 0;
        mockAccount.totalPnL = 0;
        mockAccount.maxDrawdown = 0;
        mockAccount.maxBalance = initialBalance;

        // History temizle
        tradeHistory = [];
        orderBook.clear();

        Logger.info(Logger.CATEGORIES.TRADING, 'Mock account sıfırlandı', {
            balance: mockAccount.balance
        });

        // Event trigger
        triggerTradeEvent('account_reset', mockAccount);
    }

    // Public API
    return {
        // Initialization
        init: init,
        isInitialized: function() { return isInitialized; },

        // Trading functions
        openMarketOrder: openMarketOrder,
        closePosition: closePosition,
        enableTrailingStop: enableTrailingStop,

        // Account management
        getAccount: function() {
            return mockAccount ? { ...mockAccount } : null;
        },

        resetAccount: resetAccount,

        // Position management
        getActivePositions: function() {
            return Array.from(activePositions.values());
        },

        getPositionById: function(positionId) {
            return activePositions.get(positionId);
        },

        getTradeHistory: function(limit = 100) {
            return tradeHistory.slice(-limit);
        },

        // Statistics
        getAccountStats: function() {
            if (!mockAccount) return null;

            const winRate = mockAccount.totalTrades > 0 ? 
                mockAccount.winningTrades / mockAccount.totalTrades : 0;
            
            const avgWin = mockAccount.winningTrades > 0 ?
                tradeHistory.filter(t => t.realizedPnL > 0)
                           .reduce((sum, t) => sum + t.realizedPnL, 0) / mockAccount.winningTrades : 0;
            
            const avgLoss = mockAccount.losingTrades > 0 ?
                tradeHistory.filter(t => t.realizedPnL < 0)
                           .reduce((sum, t) => sum + Math.abs(t.realizedPnL), 0) / mockAccount.losingTrades : 0;

            return {
                balance: mockAccount.balance,
                equity: mockAccount.equity,
                totalPnL: mockAccount.totalPnL,
                totalTrades: mockAccount.totalTrades,
                winningTrades: mockAccount.winningTrades,
                losingTrades: mockAccount.losingTrades,
                winRate: winRate,
                profitFactor: avgLoss > 0 ? avgWin / avgLoss : 0,
                maxDrawdown: mockAccount.maxDrawdown,
                activePositions: activePositions.size,
                unrealizedPnL: getCurrentUnrealizedPnL()
            };
        },

        // Event management
        addEventListener: function(eventType, callback) {
            document.addEventListener(`mockTrader.${eventType}`, callback);
        },

        removeEventListener: function(eventType, callback) {
            document.removeEventListener(`mockTrader.${eventType}`, callback);
        },

        // Utility
        calculatePositionSize: function(riskPercentage, entryPrice, stopLoss) {
            if (!mockAccount) return 0;

            const riskAmount = mockAccount.balance * (riskPercentage / 100);
            const priceRisk = Math.abs(entryPrice - stopLoss);
            
            return priceRisk > 0 ? riskAmount / priceRisk : 0;
        },

        // Constants
        POSITION_TYPES: POSITION_TYPES,
        POSITION_STATUS: POSITION_STATUS,
        ORDER_TYPES: ORDER_TYPES
    };

})();

// Auto-initialize
if (window.Config && window.Logger && window.ErrorHandler && window.DataProcessor && 
    window.BinanceAPI && window.ATR && window.Storage && window.Utils) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            MockTrader.init();
        });
    } else {
        MockTrader.init();
    }
} else {
    console.warn('MockTrader: Gerekli modüller bulunamadı');
}
