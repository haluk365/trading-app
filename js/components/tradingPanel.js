/**
 * TRADING PANEL COMPONENT
 * Manuel trading arayüzü - pozisyon açma/kapama, risk yönetimi
 * Portfolio recommendations ve quick trading controls
 */

window.TradingPanel = (function() {
    'use strict';

    let isInitialized = false;
    let panelElements = {};
    let selectedSymbol = 'BTCUSDT';
    let currentRecommendations = [];
    let tradingMode = 'auto'; // auto, manual

    const POSITION_SIZES = [1, 2, 3, 5, 8]; // Risk percentages
    const LEVERAGE_OPTIONS = [1, 2, 3, 5, 10, 15, 20];

    /**
     * Trading Panel'i başlat
     */
    function init() {
        if (isInitialized) {
            Logger.warning(Logger.CATEGORIES.UI, 'TradingPanel zaten başlatılmış');
            return false;
        }

        try {
            // DOM elementlerini bul
            findPanelElements();
            
            // Panel layout'unu oluştur
            createTradingLayout();
            
            // Event listener'ları kur
            setupEventListeners();
            
            // Initial data yükle
            loadInitialData();

            isInitialized = true;
            Logger.success(Logger.CATEGORIES.UI, 'TradingPanel başlatıldı');
            return true;
            
        } catch (error) {
            Logger.error(Logger.CATEGORIES.UI, 'TradingPanel başlatma hatası', error);
            return false;
        }
    }

    /**
     * DOM elementlerini bul
     */
    function findPanelElements() {
        panelElements = {
            container: document.getElementById('tradingPanel')
        };

        if (!panelElements.container) {
            throw new Error('Trading panel container bulunamadı');
        }
    }

    /**
     * Trading layout oluştur
     */
    function createTradingLayout() {
        const container = panelElements.container;
        
        container.innerHTML = `
            <!-- Trading Mode Toggle -->
            <div class="trading-mode-toggle">
                <div class="mode-buttons">
                    <button class="mode-btn active" data-mode="auto">
                        <i class="fas fa-robot"></i>
                        <span>Otomatik</span>
                    </button>
                    <button class="mode-btn" data-mode="manual">
                        <i class="fas fa-hand-paper"></i>
                        <span>Manuel</span>
                    </button>
                </div>
            </div>

            <!-- Symbol Selection -->
            <div class="symbol-section">
                <div class="section-header">
                    <h4><i class="fas fa-coins"></i> Symbol Seçimi</h4>
                </div>
                <div class="symbol-selector">
                    <select id="tradingSymbol" class="symbol-select">
                        <option value="BTCUSDT">BTC/USDT</option>
                        <option value="ETHUSDT">ETH/USDT</option>
                        <option value="ADAUSDT">ADA/USDT</option>
                        <option value="BNBUSDT">BNB/USDT</option>
                        <option value="SOLUSDT">SOL/USDT</option>
                    </select>
                    <button id="addToWatchlist" class="btn-icon" title="Watch list'e ekle">
                        <i class="fas fa-eye"></i>
                    </button>
                </div>
                <div class="symbol-info" id="symbolInfo">
                    <div class="loading-text">Symbol bilgisi yükleniyor...</div>
                </div>
            </div>

            <!-- Auto Trading Recommendations -->
            <div class="recommendations-section" id="autoSection">
                <div class="section-header">
                    <h4><i class="fas fa-lightbulb"></i> AI Önerileri</h4>
                    <button id="refreshRecommendations" class="btn-icon">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                </div>
                <div class="recommendations-list" id="recommendationsList">
                    <div class="loading-text">Öneriler yükleniyor...</div>
                </div>
            </div>

            <!-- Manual Trading Controls -->
            <div class="manual-trading-section hidden" id="manualSection">
                <div class="section-header">
                    <h4><i class="fas fa-hand-paper"></i> Manuel Trading</h4>
                </div>
                
                <!-- Position Size & Leverage -->
                <div class="trading-controls">
                    <div class="control-group">
                        <label>Position Size (Risk %)</label>
                        <div class="size-buttons" id="sizeButtons">
                            ${POSITION_SIZES.map(size => 
                                `<button class="size-btn ${size === 2 ? 'active' : ''}" data-size="${size}">${size}%</button>`
                            ).join('')}
                        </div>
                    </div>
                    
                    <div class="control-group">
                        <label>Leverage</label>
                        <select id="leverageSelect" class="leverage-select">
                            ${LEVERAGE_OPTIONS.map(lev => 
                                `<option value="${lev}" ${lev === 10 ? 'selected' : ''}>${lev}x</option>`
                            ).join('')}
                        </select>
                    </div>
                </div>

                <!-- Long/Short Buttons -->
                <div class="position-buttons">
                    <button id="longBtn" class="position-btn long-btn">
                        <i class="fas fa-arrow-up"></i>
                        <span>LONG</span>
                        <div class="btn-price" id="longPrice">-</div>
                    </button>
                    <button id="shortBtn" class="position-btn short-btn">
                        <i class="fas fa-arrow-down"></i>
                        <span>SHORT</span>
                        <div class="btn-price" id="shortPrice">-</div>
                    </button>
                </div>

                <!-- Risk Calculation -->
                <div class="risk-calculation" id="riskCalculation">
                    <div class="risk-item">
                        <span class="risk-label">Position Değeri:</span>
                        <span class="risk-value" id="positionValue">$0</span>
                    </div>
                    <div class="risk-item">
                        <span class="risk-label">Risk Tutarı:</span>
                        <span class="risk-value" id="riskAmount">$0</span>
                    </div>
                    <div class="risk-item">
                        <span class="risk-label">Stop Loss:</span>
                        <span class="risk-value" id="stopLossPrice">$0</span>
                    </div>
                </div>
            </div>

            <!-- Active Positions Management -->
            <div class="positions-management">
                <div class="section-header">
                    <h4><i class="fas fa-list-ul"></i> Pozisyon Yönetimi</h4>
                    <div class="position-count-badge" id="positionCountBadge">0</div>
                </div>
                <div class="positions-list" id="positionsList">
                    <div class="empty-positions">
                        <i class="fas fa-inbox"></i>
                        <p>Aktif pozisyon yok</p>
                    </div>
                </div>
                
                <!-- Quick Actions -->
                <div class="quick-actions">
                    <button id="closeAllBtn" class="quick-action-btn danger" disabled>
                        <i class="fas fa-times-circle"></i>
                        Tümünü Kapat
                    </button>
                    <button id="enableTrailingBtn" class="quick-action-btn secondary" disabled>
                        <i class="fas fa-route"></i>
                        Trailing Stop
                    </button>
                </div>
            </div>

            <!-- Risk Status -->
            <div class="risk-status">
                <div class="section-header">
                    <h4><i class="fas fa-shield-alt"></i> Risk Durumu</h4>
                </div>
                <div class="risk-metrics" id="riskMetrics">
                    <div class="loading-text">Risk bilgileri yükleniyor...</div>
                </div>
            </div>

            <!-- Trading History -->
            <div class="trading-history">
                <div class="section-header">
                    <h4><i class="fas fa-history"></i> Son İşlemler</h4>
                    <button id="clearHistoryBtn" class="btn-icon">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <div class="history-list" id="historyList">
                    <div class="empty-history">
                        <i class="fas fa-clock"></i>
                        <p>Henüz işlem geçmişi yok</p>
                    </div>
                </div>
            </div>
        `;

        updateElementReferences();
        Logger.debug(Logger.CATEGORIES.UI, 'Trading panel layout oluşturuldu');
    }

    /**
     * Element referanslarını güncelle
     */
    function updateElementReferences() {
        panelElements.tradingSymbol = document.getElementById('tradingSymbol');
        panelElements.symbolInfo = document.getElementById('symbolInfo');
        panelElements.recommendationsList = document.getElementById('recommendationsList');
        panelElements.positionsList = document.getElementById('positionsList');
        panelElements.riskMetrics = document.getElementById('riskMetrics');
        panelElements.historyList = document.getElementById('historyList');
        panelElements.autoSection = document.getElementById('autoSection');
        panelElements.manualSection = document.getElementById('manualSection');
    }

    /**
     * Event listener'ları kur
     */
    function setupEventListeners() {
        // Trading mode toggle
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const mode = this.dataset.mode;
                switchTradingMode(mode);
            });
        });

        // Symbol selection
        if (panelElements.tradingSymbol) {
            panelElements.tradingSymbol.addEventListener('change', function() {
                selectedSymbol = this.value;
                updateSymbolInfo();
                updateRecommendations();
                updateRiskCalculation();
            });
        }

        // Add to watchlist
        const addWatchlistBtn = document.getElementById('addToWatchlist');
        if (addWatchlistBtn) {
            addWatchlistBtn.addEventListener('click', function() {
                addToWatchlist(selectedSymbol);
            });
        }

        // Refresh recommendations
        const refreshBtn = document.getElementById('refreshRecommendations');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function() {
                this.classList.add('fa-spin');
                updateRecommendations().finally(() => {
                    this.classList.remove('fa-spin');
                });
            });
        }

        // Position size buttons
        document.querySelectorAll('.size-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                updateRiskCalculation();
            });
        });

        // Leverage selection
        const leverageSelect = document.getElementById('leverageSelect');
        if (leverageSelect) {
            leverageSelect.addEventListener('change', function() {
                updateRiskCalculation();
            });
        }

        // Long/Short buttons
        const longBtn = document.getElementById('longBtn');
        const shortBtn = document.getElementById('shortBtn');
        
        if (longBtn) {
            longBtn.addEventListener('click', function() {
                openPosition('long');
            });
        }
        
        if (shortBtn) {
            shortBtn.addEventListener('click', function() {
                openPosition('short');
            });
        }

        // Quick actions
        const closeAllBtn = document.getElementById('closeAllBtn');
        const trailingBtn = document.getElementById('enableTrailingBtn');
        
        if (closeAllBtn) {
            closeAllBtn.addEventListener('click', closeAllPositions);
        }
        
        if (trailingBtn) {
            trailingBtn.addEventListener('click', enableTrailingForAll);
        }

        // Clear history
        const clearHistoryBtn = document.getElementById('clearHistoryBtn');
        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener('click', clearTradingHistory);
        }

        // MockTrader events
        if (window.MockTrader) {
            MockTrader.addEventListener('position_opened', updatePositionsList);
            MockTrader.addEventListener('position_closed', updatePositionsList);
        }

        // RiskManager events
        if (window.RiskManager) {
            RiskManager.addEventListener('risk_level_changed', updateRiskStatus);
        }

        Logger.debug(Logger.CATEGORIES.UI, 'Trading panel event listeners kuruldu');
    }

    /**
     * Trading mode değiştir
     */
    function switchTradingMode(mode) {
        tradingMode = mode;
        
        // Button states
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.mode === mode) {
                btn.classList.add('active');
            }
        });

        // Section visibility
        if (mode === 'auto') {
            panelElements.autoSection.classList.remove('hidden');
            panelElements.manualSection.classList.add('hidden');
        } else {
            panelElements.autoSection.classList.add('hidden');
            panelElements.manualSection.classList.remove('hidden');
            updateRiskCalculation();
        }

        Logger.info(Logger.CATEGORIES.UI, `Trading mode changed: ${mode}`);
    }

    /**
     * Symbol bilgisini güncelle
     */
    async function updateSymbolInfo() {
        if (!panelElements.symbolInfo) return;

        try {
            panelElements.symbolInfo.innerHTML = '<div class="loading-text">Yükleniyor...</div>';

            // Current price al
            const currentPrice = await BinanceAPI.getCurrentPrice(selectedSymbol);
            const ticker = await BinanceAPI.getTicker24hr(selectedSymbol);

            const changeClass = ticker.priceChangePercent >= 0 ? 'positive' : 'negative';
            const changeIcon = ticker.priceChangePercent >= 0 ? 'fa-arrow-up' : 'fa-arrow-down';

            panelElements.symbolInfo.innerHTML = `
                <div class="symbol-data">
                    <div class="price-info">
                        <div class="current-price">${Utils.Format.number(currentPrice, 2)}</div>
                        <div class="price-change ${changeClass}">
                            <i class="fas ${changeIcon}"></i>
                            ${Utils.Format.currency(ticker.priceChange)} (${Utils.Format.percentage(ticker.priceChangePercent)})
                        </div>
                    </div>
                    <div class="volume-info">
                        <div class="volume-item">
                            <span class="label">24h High:</span>
                            <span class="value">${Utils.Format.number(ticker.high, 2)}</span>
                        </div>
                        <div class="volume-item">
                            <span class="label">24h Low:</span>
                            <span class="value">${Utils.Format.number(ticker.low, 2)}</span>
                        </div>
                        <div class="volume-item">
                            <span class="label">24h Volume:</span>
                            <span class="value">${Utils.Format.number(ticker.volume, 0)}</span>
                        </div>
                    </div>
                </div>
            `;

            // Manual trading button prices'ı güncelle
            const longPriceEl = document.getElementById('longPrice');
            const shortPriceEl = document.getElementById('shortPrice');
            
            if (longPriceEl) longPriceEl.textContent = Utils.Format.number(currentPrice, 2);
            if (shortPriceEl) shortPriceEl.textContent = Utils.Format.number(currentPrice, 2);

        } catch (error) {
            Logger.error(Logger.CATEGORIES.UI, 'Symbol info güncelleme hatası', error);
            panelElements.symbolInfo.innerHTML = `
                <div class="error-text">
                    <i class="fas fa-exclamation-triangle"></i>
                    Symbol bilgisi alınamadı
                </div>
            `;
        }
    }

    /**
     * Recommendations güncelle
     */
    async function updateRecommendations() {
        if (!panelElements.recommendationsList || !window.PortfolioManager) return;

        try {
            panelElements.recommendationsList.innerHTML = '<div class="loading-text">Öneriler hesaplanıyor...</div>';

            const recommendations = await PortfolioManager.getPortfolioRecommendations();
            
            if (recommendations.length === 0) {
                panelElements.recommendationsList.innerHTML = `
                    <div class="empty-recommendations">
                        <i class="fas fa-search"></i>
                        <p>Şu an öneri yok</p>
                    </div>
                `;
                return;
            }

            const recommendationsHTML = recommendations
                .filter(rec => rec.allocation > 0)
                .slice(0, 5)
                .map(rec => {
                    const confidenceClass = rec.confidence >= 0.8 ? 'high' : rec.confidence >= 0.6 ? 'medium' : 'low';
                    
                    return `
                        <div class="recommendation-item ${rec.recommendation} ${confidenceClass}">
                            <div class="rec-header">
                                <div class="rec-symbol">${rec.symbol}</div>
                                <div class="rec-signal ${rec.recommendation}">${rec.recommendation.toUpperCase()}</div>
                            </div>
                            <div class="rec-details">
                                <div class="rec-metric">
                                    <span class="metric-label">Güven:</span>
                                    <span class="metric-value">${Utils.Format.percentage(rec.confidence * 100)}</span>
                                </div>
                                <div class="rec-metric">
                                    <span class="metric-label">Allocation:</span>
                                    <span class="metric-value">${Utils.Format.percentage(rec.allocation)}</span>
                                </div>
                            </div>
                            <div class="rec-actions">
                                <button class="apply-rec-btn" data-symbol="${rec.symbol}" data-side="${rec.recommendation}">
                                    <i class="fas fa-play"></i>
                                    Uygula
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');

            panelElements.recommendationsList.innerHTML = recommendationsHTML;

            // Apply recommendation buttons
            document.querySelectorAll('.apply-rec-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const symbol = this.dataset.symbol;
                    const side = this.dataset.side;
                    applyRecommendation(symbol, side);
                });
            });

            currentRecommendations = recommendations;

        } catch (error) {
            Logger.error(Logger.CATEGORIES.UI, 'Recommendations güncelleme hatası', error);
            panelElements.recommendationsList.innerHTML = `
                <div class="error-text">
                    <i class="fas fa-exclamation-triangle"></i>
                    Öneriler alınamadı
                </div>
            `;
        }
    }

    /**
     * Risk calculation güncelle
     */
    function updateRiskCalculation() {
        if (tradingMode !== 'manual') return;

        const activeSize = document.querySelector('.size-btn.active')?.dataset.size || 2;
        const leverage = document.getElementById('leverageSelect')?.value || 10;
        
        if (!window.MockTrader) return;

        const account = MockTrader.getAccount();
        if (!account) return;

        const riskPercent = parseFloat(activeSize);
        const leverageValue = parseFloat(leverage);
        const riskAmount = account.balance * (riskPercent / 100);
        const positionValue = riskAmount * leverageValue;

        // Element'leri güncelle
        const positionValueEl = document.getElementById('positionValue');
        const riskAmountEl = document.getElementById('riskAmount');
        const stopLossPriceEl = document.getElementById('stopLossPrice');

        if (positionValueEl) positionValueEl.textContent = Utils.Format.currency(positionValue);
        if (riskAmountEl) riskAmountEl.textContent = Utils.Format.currency(riskAmount);
        
        // Estimated stop loss (ATR bazlı)
        if (stopLossPriceEl) {
            const currentPrice = parseFloat(document.getElementById('longPrice')?.textContent || 0);
            const estimatedSL = currentPrice * 0.98; // %2 approximate stop loss
            stopLossPriceEl.textContent = Utils.Format.number(estimatedSL, 2);
        }
    }

    /**
     * Pozisyon aç
     */
    async function openPosition(side) {
        if (!window.MockTrader || !window.RiskManager) {
            Logger.error(Logger.CATEGORIES.UI, 'MockTrader veya RiskManager bulunamadı');
            return;
        }

        try {
            const activeSize = document.querySelector('.size-btn.active')?.dataset.size || 2;
            const leverage = document.getElementById('leverageSelect')?.value || 10;
            
            const riskPercent = parseFloat(activeSize);
            const leverageValue = parseFloat(leverage);

            // Risk assessment
            const riskAssessment = RiskManager.assessPositionRisk(
                selectedSymbol, 
                side, 
                riskPercent, 
                leverageValue,
                null
            );

            if (riskAssessment.riskLevel === 'critical') {
                if (!confirm(`Bu pozisyon çok riskli! Risk skoru: ${riskAssessment.riskScore}\n\nYine de açmak istiyor musunuz?`)) {
                    return;
                }
            }

            // Position size hesapla
            const account = MockTrader.getAccount();
            const riskAmount = account.balance * (riskPercent / 100);
            const currentPrice = await BinanceAPI.getCurrentPrice(selectedSymbol);
            const positionSize = (riskAmount * leverageValue) / currentPrice;

            Logger.info(Logger.CATEGORIES.UI, `${side.toUpperCase()} pozisyon açılıyor`, {
                symbol: selectedSymbol,
                size: positionSize,
                leverage: leverageValue,
                risk: riskPercent + '%'
            });

            // MockTrader ile pozisyon aç
            const position = await MockTrader.openMarketOrder(
                selectedSymbol,
                side,
                positionSize,
                leverageValue,
                {
                    openedBy: 'manual_trading_panel',
                    riskPercent: riskPercent
                }
            );

            Logger.success(Logger.CATEGORIES.UI, `Pozisyon açıldı: ${position.id}`);
            
            // UI güncelle
            updatePositionsList();
            updateRiskStatus();

        } catch (error) {
            Logger.error(Logger.CATEGORIES.UI, 'Pozisyon açma hatası', error);
            alert('Pozisyon açılamadı: ' + error.message);
        }
    }

    /**
     * Recommendation uygula
     */
    async function applyRecommendation(symbol, side) {
        if (!window.MockTrader) return;

        try {
            const recommendation = currentRecommendations.find(rec => 
                rec.symbol === symbol && rec.recommendation === side
            );

            if (!recommendation) {
                Logger.error(Logger.CATEGORIES.UI, 'Recommendation bulunamadı');
                return;
            }

            const account = MockTrader.getAccount();
            const allocationPercent = recommendation.allocation;
            const riskAmount = account.balance * (allocationPercent / 100);
            const currentPrice = await BinanceAPI.getCurrentPrice(symbol);
            const positionSize = riskAmount / currentPrice;

            Logger.info(Logger.CATEGORIES.UI, `Recommendation uygulanıyor: ${symbol} ${side}`, {
                allocation: allocationPercent + '%',
                confidence: (recommendation.confidence * 100).toFixed(1) + '%'
            });

            const position = await MockTrader.openMarketOrder(
                symbol,
                side,
                positionSize,
                10, // Default leverage
                {
                    openedBy: 'auto_recommendation',
                    signalId: recommendation.signalId,
                    confidence: recommendation.confidence
                }
            );

            Logger.success(Logger.CATEGORIES.UI, `Recommendation pozisyonu açıldı: ${position.id}`);
            updatePositionsList();

        } catch (error) {
            Logger.error(Logger.CATEGORIES.UI, 'Recommendation uygulama hatası', error);
            alert('Recommendation uygulanamadı: ' + error.message);
        }
    }

    /**
     * Pozisyon listesini güncelle
     */
    function updatePositionsList() {
        if (!panelElements.positionsList || !window.MockTrader) return;

        const positions = MockTrader.getActivePositions();
        const positionCountBadge = document.getElementById('positionCountBadge');
        const closeAllBtn = document.getElementById('closeAllBtn');
        const trailingBtn = document.getElementById('enableTrailingBtn');

        // Badge güncelle
        if (positionCountBadge) {
            positionCountBadge.textContent = positions.length;
        }

        // Button states
        if (closeAllBtn) closeAllBtn.disabled = positions.length === 0;
        if (trailingBtn) trailingBtn.disabled = positions.length === 0;

        if (positions.length === 0) {
            panelElements.positionsList.innerHTML = `
                <div class="empty-positions">
                    <i class="fas fa-inbox"></i>
                    <p>Aktif pozisyon yok</p>
                </div>
            `;
            return;
        }

        const positionsHTML = positions.map(position => {
            const pnlClass = position.unrealizedPnL >= 0 ? 'positive' : 'negative';
            const pnlPercent = ((position.unrealizedPnL / position.marginUsed) * 100).toFixed(2);
            
            return `
                <div class="position-card ${position.side}">
                    <div class="position-header">
                        <div class="position-info">
                            <span class="position-symbol">${position.symbol}</span>
                            <span class="position-side ${position.side}">${position.side.toUpperCase()}</span>
                        </div>
                        <div class="position-pnl ${pnlClass}">
                            ${Utils.Format.currency(position.unrealizedPnL)}
                            <span class="pnl-percent">(${pnlPercent}%)</span>
                        </div>
                    </div>
                    <div class="position-details">
                        <div class="detail-row">
                            <span class="detail-label">Size:</span>
                            <span class="detail-value">${Utils.Format.number(position.size, 6)}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Entry:</span>
                            <span class="detail-value">${Utils.Format.number(position.entryPrice, 2)}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Current:</span>
                            <span class="detail-value">${Utils.Format.number(position.currentPrice, 2)}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Stop Loss:</span>
                            <span class="detail-value">${Utils.Format.number(position.stopLoss, 2)}</span>
                        </div>
                    </div>
                    <div class="position-actions">
                        <button class="action-btn close-btn" data-position-id="${position.id}">
                            <i class="fas fa-times"></i>
                            Kapat
                        </button>
                        <button class="action-btn trailing-btn" data-position-id="${position.id}">
                            <i class="fas fa-route"></i>
                            Trailing
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        panelElements.positionsList.innerHTML = positionsHTML;

        // Position action buttons
        document.querySelectorAll('.close-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const positionId = this.dataset.positionId;
                closePosition(positionId);
            });
        });

        document.querySelectorAll('.trailing-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const positionId = this.dataset.positionId;
                enableTrailing(positionId);
            });
        });
    }

    /**
     * Pozisyon kapat
     */
    async function closePosition(positionId) {
        if (!window.MockTrader) return;

        try {
            await MockTrader.closePosition(positionId, 'manual_close');
            Logger.success(Logger.CATEGORIES.UI, `Pozisyon kapatıldı: ${positionId}`);
            updatePositionsList();
            updateRiskStatus();
        } catch (error) {
            Logger.error(Logger.CATEGORIES.UI, 'Pozisyon kapatma hatası', error);
            alert('Pozisyon kapatılamadı: ' + error.message);
        }
    }

    /**
     * Trailing stop aktif et
     */
    function enableTrailing(positionId) {
        if (!window.TrailingStop) {
            Logger.error(Logger.CATEGORIES.UI, 'TrailingStop modülü bulunamadı');
            return;
        }

        try {
            TrailingStop.startTrailing(positionId, 'conservative');
            Logger.success(Logger.CATEGORIES.UI, `Trailing stop aktif edildi: ${positionId}`);
            updatePositionsList();
        } catch (error) {
            Logger.error(Logger.CATEGORIES.UI, 'Trailing stop aktifleştirme hatası', error);
            alert('Trailing stop aktifleştirilemedi: ' + error.message);
        }
    }

    /**
     * Tüm pozisyonları kapat
     */
    async function closeAllPositions() {
        if (!window.MockTrader) return;

        const positions = MockTrader.getActivePositions();
        if (positions.length === 0) return;

        if (!confirm(`${positions.length} adet pozisyonu kapatmak istediğinize emin misiniz?`)) {
            return;
        }

        try {
            Logger.info(Logger.CATEGORIES.UI, `Tüm pozisyonlar kapatılıyor: ${positions.length} adet`);

            for (const position of positions) {
                await MockTrader.closePosition(position.id, 'manual_close_all');
            }

            Logger.success(Logger.CATEGORIES.UI, 'Tüm pozisyonlar kapatıldı');
            updatePositionsList();
            updateRiskStatus();

        } catch (error) {
            Logger.error(Logger.CATEGORIES.UI, 'Pozisyonlar kapatma hatası', error);
            alert('Pozisyonlar kapatılamadı: ' + error.message);
        }
    }

    /**
     * Tüm pozisyonlar için trailing aktif et
     */
    function enableTrailingForAll() {
        if (!window.MockTrader || !window.TrailingStop) return;

        const positions = MockTrader.getActivePositions();
        if (positions.length === 0) return;

        try {
            positions.forEach(position => {
                TrailingStop.startTrailing(position.id, 'conservative');
            });

            Logger.success(Logger.CATEGORIES.UI, `${positions.length} pozisyon için trailing stop aktif edildi`);
            updatePositionsList();

        } catch (error) {
            Logger.error(Logger.CATEGORIES.UI, 'Bulk trailing aktifleştirme hatası', error);
            alert('Trailing stop aktifleştirilemedi: ' + error.message);
        }
    }

    /**
     * Watch list'e ekle
     */
    function addToWatchlist(symbol) {
        if (!window.PortfolioManager) {
            Logger.error(Logger.CATEGORIES.UI, 'PortfolioManager bulunamadı');
            return;
        }

        try {
            PortfolioManager.addToWatchList(symbol);
            Logger.success(Logger.CATEGORIES.UI, `Watch list'e eklendi: ${symbol}`);
            
            // Visual feedback
            const btn = document.getElementById('addToWatchlist');
            if (btn) {
                const originalHTML = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-check"></i>';
                btn.style.color = 'var(--success-color)';
                
                setTimeout(() => {
                    btn.innerHTML = originalHTML;
                    btn.style.color = '';
                }, 1500);
            }

        } catch (error) {
            Logger.error(Logger.CATEGORIES.UI, 'Watch list ekleme hatası', error);
            alert('Watch list\'e eklenemedi: ' + error.message);
        }
    }

    /**
     * Risk durumunu güncelle
     */
    function updateRiskStatus() {
        if (!panelElements.riskMetrics || !window.RiskManager) return;

        try {
            const riskLevel = RiskManager.getCurrentRiskLevel();
            const riskMetrics = RiskManager.getCurrentRiskMetrics();
            const dailyStats = RiskManager.getDailyStats();

            const riskLevelClass = riskLevel === 'critical' ? 'critical' : 
                                  riskLevel === 'high' ? 'high' : 
                                  riskLevel === 'medium' ? 'medium' : 'low';

            panelElements.riskMetrics.innerHTML = `
                <div class="risk-overview">
                    <div class="risk-level-indicator ${riskLevelClass}">
                        <div class="risk-dot"></div>
                        <span class="risk-text">${riskLevel.toUpperCase()}</span>
                    </div>
                </div>
                <div class="risk-details">
                    <div class="risk-detail-item">
                        <span class="risk-label">Günlük P&L:</span>
                        <span class="risk-value ${dailyStats.dailyPnL >= 0 ? 'positive' : 'negative'}">
                            ${Utils.Format.currency(dailyStats.dailyPnL)}
                        </span>
                    </div>
                    <div class="risk-detail-item">
                        <span class="risk-label">Max Drawdown:</span>
                        <span class="risk-value">${Utils.Format.percentage(riskMetrics.drawdownPercent)}</span>
                    </div>
                    <div class="risk-detail-item">
                        <span class="risk-label">Aktif Pozisyonlar:</span>
                        <span class="risk-value">${riskMetrics.activePositions}/5</span>
                    </div>
                    <div class="risk-detail-item">
                        <span class="risk-label">Günlük İşlemler:</span>
                        <span class="risk-value">${dailyStats.tradesOpened}/20</span>
                    </div>
                </div>
            `;

        } catch (error) {
            Logger.error(Logger.CATEGORIES.UI, 'Risk status güncelleme hatası', error);
            panelElements.riskMetrics.innerHTML = `
                <div class="error-text">
                    <i class="fas fa-exclamation-triangle"></i>
                    Risk bilgisi alınamadı
                </div>
            `;
        }
    }

    /**
     * Trading history güncelle
     */
    function updateTradingHistory() {
        if (!panelElements.historyList || !window.MockTrader) return;

        const history = MockTrader.getTradeHistory(10); // Son 10 işlem

        if (history.length === 0) {
            panelElements.historyList.innerHTML = `
                <div class="empty-history">
                    <i class="fas fa-clock"></i>
                    <p>Henüz işlem geçmişi yok</p>
                </div>
            `;
            return;
        }

        const historyHTML = history.map(trade => {
            const pnlClass = trade.realizedPnL >= 0 ? 'positive' : 'negative';
            const pnlPercent = ((trade.realizedPnL / trade.marginUsed) * 100).toFixed(2);
            const duration = Utils.Format.duration(trade.closeTime - trade.openTime);

            return `
                <div class="history-item">
                    <div class="history-header">
                        <div class="history-symbol">
                            <span class="symbol">${trade.symbol}</span>
                            <span class="side-badge ${trade.side}">${trade.side.toUpperCase()}</span>
                        </div>
                        <div class="history-pnl ${pnlClass}">
                            ${Utils.Format.currency(trade.realizedPnL)} (${pnlPercent}%)
                        </div>
                    </div>
                    <div class="history-details">
                        <div class="history-detail">
                            <span class="label">Entry:</span>
                            <span class="value">${Utils.Format.number(trade.entryPrice, 2)}</span>
                        </div>
                        <div class="history-detail">
                            <span class="label">Exit:</span>
                            <span class="value">${Utils.Format.number(trade.exitPrice, 2)}</span>
                        </div>
                        <div class="history-detail">
                            <span class="label">Duration:</span>
                            <span class="value">${duration}</span>
                        </div>
                        <div class="history-detail">
                            <span class="label">Reason:</span>
                            <span class="value">${trade.closeReason || 'manual'}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        panelElements.historyList.innerHTML = historyHTML;
    }

    /**
     * Trading history temizle
     */
    function clearTradingHistory() {
        if (!confirm('Tüm işlem geçmişini temizlemek istediğinize emin misiniz?')) {
            return;
        }

        // MockTrader'da history temizleme fonksiyonu olmadığı için
        // Sadece UI'dan temizliyoruz
        panelElements.historyList.innerHTML = `
            <div class="empty-history">
                <i class="fas fa-clock"></i>
                <p>İşlem geçmişi temizlendi</p>
            </div>
        `;

        Logger.info(Logger.CATEGORIES.UI, 'Trading history temizlendi');
    }

    /**
     * Initial data yükle
     */
    async function loadInitialData() {
        try {
            await updateSymbolInfo();
            if (tradingMode === 'auto') {
                await updateRecommendations();
            }
            updatePositionsList();
            updateRiskStatus();
            updateTradingHistory();
            
            Logger.debug(Logger.CATEGORIES.UI, 'Trading panel initial data yüklendi');
        } catch (error) {
            Logger.error(Logger.CATEGORIES.UI, 'Initial data yükleme hatası', error);
        }
    }

    /**
     * Panel'i yenile
     */
    async function refreshPanel() {
        Logger.info(Logger.CATEGORIES.UI, 'Trading panel yenileniyor...');
        await loadInitialData();
    }

    /**
     * Panel'i durdur
     */
    function destroy() {
        isInitialized = false;
        panelElements = {};
        selectedSymbol = 'BTCUSDT';
        currentRecommendations = [];
        tradingMode = 'auto';
        
        Logger.info(Logger.CATEGORIES.UI, 'Trading panel durduruldu');
    }

    // Public API
    return {
        init: init,
        destroy: destroy,
        refreshPanel: refreshPanel,
        
        // Mode management
        switchTradingMode: switchTradingMode,
        getTradingMode: function() { return tradingMode; },
        
        // Symbol management
        setSelectedSymbol: function(symbol) {
            selectedSymbol = symbol;
            if (panelElements.tradingSymbol) {
                panelElements.tradingSymbol.value = symbol;
            }
            updateSymbolInfo();
            updateRecommendations();
        },
        
        getSelectedSymbol: function() { return selectedSymbol; },
        
        // Manual trading
        openPosition: openPosition,
        closePosition: closePosition,
        closeAllPositions: closeAllPositions,
        
        // Update functions
        updateSymbolInfo: updateSymbolInfo,
        updateRecommendations: updateRecommendations,
        updatePositionsList: updatePositionsList,
        updateRiskStatus: updateRiskStatus,
        updateTradingHistory: updateTradingHistory,
        
        // Utility
        isInitialized: function() { return isInitialized; }
    };

})();

// Auto-initialize
if (window.Config && window.Logger && window.Utils && window.BinanceAPI) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            TradingPanel.init();
        });
    } else {
        TradingPanel.init();
    }
} else {
    console.warn('TradingPanel: Gerekli modüller bulunamadı');
}
