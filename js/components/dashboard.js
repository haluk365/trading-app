/**
 * DASHBOARD COMPONENT
 * Ana dashboard UI - portföy özeti, aktif pozisyonlar, performans
 * Real-time güncellemeler ve özet kartlar
 */

window.Dashboard = (function() {
    'use strict';

    let isInitialized = false;
    let dashboardElements = {};
    let refreshInterval = null;
    let updateCallbacks = new Map();

    const REFRESH_RATE = 1000; // 1 saniye

    /**
     * Dashboard'u başlat
     */
    function init() {
        if (isInitialized) {
            Logger.warning(Logger.CATEGORIES.UI, 'Dashboard zaten başlatılmış');
            return false;
        }

        try {
            // DOM elementlerini bul
            findDashboardElements();
            
            // Dashboard layout'unu oluştur
            createDashboardLayout();
            
            // Event listener'ları kur
            setupEventListeners();
            
            // Real-time güncellemeleri başlat
            startRealTimeUpdates();

            isInitialized = true;
            Logger.success(Logger.CATEGORIES.UI, 'Dashboard başlatıldı');
            return true;
            
        } catch (error) {
            Logger.error(Logger.CATEGORIES.UI, 'Dashboard başlatma hatası', error);
            return false;
        }
    }

    /**
     * DOM elementlerini bul
     */
    function findDashboardElements() {
        dashboardElements = {
            container: document.getElementById('dashboard'),
            accountSummary: null,
            portfolioStats: null,
            activePositions: null,
            recentSignals: null,
            performanceChart: null,
            riskMetrics: null
        };

        if (!dashboardElements.container) {
            throw new Error('Dashboard container bulunamadı');
        }
    }

    /**
     * Dashboard layout'unu oluştur
     */
    function createDashboardLayout() {
        const container = dashboardElements.container;
        
        container.innerHTML = `
            <div class="dashboard-grid">
                <!-- Account Summary Card -->
                <div class="dashboard-card account-summary">
                    <div class="card-header">
                        <h3><i class="fas fa-wallet"></i> Hesap Özeti</h3>
                        <div class="card-status" id="accountStatus">
                            <span class="status-dot active"></span>
                            <span>Aktif</span>
                        </div>
                    </div>
                    <div class="card-content" id="accountSummary">
                        <div class="loading-skeleton">Yükleniyor...</div>
                    </div>
                </div>

                <!-- Portfolio Stats Card -->
                <div class="dashboard-card portfolio-stats">
                    <div class="card-header">
                        <h3><i class="fas fa-chart-pie"></i> Portföy İstatistikleri</h3>
                        <button class="btn-icon" id="refreshPortfolio">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                    </div>
                    <div class="card-content" id="portfolioStats">
                        <div class="loading-skeleton">Yükleniyor...</div>
                    </div>
                </div>

                <!-- Active Positions Card -->
                <div class="dashboard-card active-positions">
                    <div class="card-header">
                        <h3><i class="fas fa-list"></i> Aktif Pozisyonlar</h3>
                        <span class="badge" id="positionCount">0</span>
                    </div>
                    <div class="card-content" id="activePositions">
                        <div class="empty-state">
                            <i class="fas fa-inbox"></i>
                            <p>Aktif pozisyon bulunmuyor</p>
                        </div>
                    </div>
                </div>

                <!-- Recent Signals Card -->
                <div class="dashboard-card recent-signals">
                    <div class="card-header">
                        <h3><i class="fas fa-signal"></i> Son Sinyaller</h3>
                        <span class="time-indicator" id="lastSignalTime">-</span>
                    </div>
                    <div class="card-content" id="recentSignals">
                        <div class="empty-state">
                            <i class="fas fa-satellite-dish"></i>
                            <p>Henüz sinyal yok</p>
                        </div>
                    </div>
                </div>

                <!-- Performance Chart Card -->
                <div class="dashboard-card performance-chart">
                    <div class="card-header">
                        <h3><i class="fas fa-chart-line"></i> Performans</h3>
                        <div class="chart-controls">
                            <select id="performancePeriod" class="chart-period-select">
                                <option value="1h">1 Saat</option>
                                <option value="24h" selected>24 Saat</option>
                                <option value="7d">7 Gün</option>
                                <option value="30d">30 Gün</option>
                            </select>
                        </div>
                    </div>
                    <div class="card-content" id="performanceChart">
                        <div class="chart-placeholder">
                            <i class="fas fa-chart-area"></i>
                            <p>Performans grafiği</p>
                        </div>
                    </div>
                </div>

                <!-- Risk Metrics Card -->
                <div class="dashboard-card risk-metrics">
                    <div class="card-header">
                        <h3><i class="fas fa-shield-alt"></i> Risk Metrikleri</h3>
                        <div class="risk-indicator" id="riskLevel">
                            <span class="risk-dot medium"></span>
                            <span>ORTA</span>
                        </div>
                    </div>
                    <div class="card-content" id="riskMetrics">
                        <div class="loading-skeleton">Yükleniyor...</div>
                    </div>
                </div>
            </div>
        `;

        // Element referanslarını güncelle
        updateElementReferences();
        
        Logger.debug(Logger.CATEGORIES.UI, 'Dashboard layout oluşturuldu');
    }

    /**
     * Element referanslarını güncelle
     */
    function updateElementReferences() {
        dashboardElements.accountSummary = document.getElementById('accountSummary');
        dashboardElements.portfolioStats = document.getElementById('portfolioStats');
        dashboardElements.activePositions = document.getElementById('activePositions');
        dashboardElements.recentSignals = document.getElementById('recentSignals');
        dashboardElements.performanceChart = document.getElementById('performanceChart');
        dashboardElements.riskMetrics = document.getElementById('riskMetrics');
    }

    /**
     * Event listener'ları kur
     */
    function setupEventListeners() {
        // Refresh button
        const refreshBtn = document.getElementById('refreshPortfolio');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function() {
                refreshBtn.classList.add('fa-spin');
                refreshAllData().finally(() => {
                    refreshBtn.classList.remove('fa-spin');
                });
            });
        }

        // Performance period change
        const periodSelect = document.getElementById('performancePeriod');
        if (periodSelect) {
            periodSelect.addEventListener('change', function() {
                updatePerformanceChart(this.value);
            });
        }

        // MockTrader events
        if (window.MockTrader) {
            MockTrader.addEventListener('position_opened', updateActivePositions);
            MockTrader.addEventListener('position_closed', updateActivePositions);
            MockTrader.addEventListener('account_reset', refreshAllData);
        }

        // PortfolioManager events
        if (window.PortfolioManager) {
            PortfolioManager.addEventListener('recommendation_updated', updateSignals);
        }

        // RiskManager events
        if (window.RiskManager) {
            RiskManager.addEventListener('risk_level_changed', updateRiskMetrics);
            RiskManager.addEventListener('emergency_triggered', updateRiskMetrics);
        }

        Logger.debug(Logger.CATEGORIES.UI, 'Dashboard event listeners kuruldu');
    }

    /**
     * Real-time güncellemeleri başlat
     */
    function startRealTimeUpdates() {
        refreshInterval = setInterval(() => {
            updateAccountSummary();
            updatePortfolioStats();
            updateActivePositions();
        }, REFRESH_RATE);

        // İlk yükleme
        refreshAllData();
        
        Logger.debug(Logger.CATEGORIES.UI, 'Real-time güncellemeler başlatıldı');
    }

    /**
     * Tüm verileri yenile
     */
    async function refreshAllData() {
        try {
            await Promise.all([
                updateAccountSummary(),
                updatePortfolioStats(),
                updateActivePositions(),
                updateRecentSignals(),
                updatePerformanceChart(),
                updateRiskMetrics()
            ]);
            
            Logger.debug(Logger.CATEGORIES.UI, 'Dashboard verileri yenilendi');
        } catch (error) {
            Logger.error(Logger.CATEGORIES.UI, 'Dashboard veri yenileme hatası', error);
        }
    }

    /**
     * Account summary güncelle
     */
    function updateAccountSummary() {
        if (!window.MockTrader || !dashboardElements.accountSummary) return;

        const account = MockTrader.getAccount();
        const stats = MockTrader.getAccountStats();

        if (!account) {
            dashboardElements.accountSummary.innerHTML = `
                <div class="error-message">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Hesap bilgisi alınamadı</span>
                </div>
            `;
            return;
        }

        const pnlClass = account.totalPnL >= 0 ? 'positive' : 'negative';
        const pnlIcon = account.totalPnL >= 0 ? 'fa-arrow-up' : 'fa-arrow-down';
        const pnlPercent = ((account.totalPnL / 10000) * 100).toFixed(2); // 10000 = initial balance

        dashboardElements.accountSummary.innerHTML = `
            <div class="summary-grid">
                <div class="summary-item balance">
                    <div class="item-label">Bakiye</div>
                    <div class="item-value">${Utils.Format.currency(account.balance)}</div>
                </div>
                <div class="summary-item equity">
                    <div class="item-label">Equity</div>
                    <div class="item-value">${Utils.Format.currency(account.equity)}</div>
                </div>
                <div class="summary-item pnl ${pnlClass}">
                    <div class="item-label">Toplam P&L</div>
                    <div class="item-value">
                        <i class="fas ${pnlIcon}"></i>
                        ${Utils.Format.currency(account.totalPnL)} (${pnlPercent}%)
                    </div>
                </div>
                <div class="summary-item margin">
                    <div class="item-label">Kullanılan Margin</div>
                    <div class="item-value">${Utils.Format.currency(account.margin)}</div>
                </div>
                <div class="summary-item trades">
                    <div class="item-label">Toplam İşlem</div>
                    <div class="item-value">${stats?.totalTrades || 0}</div>
                </div>
                <div class="summary-item winrate">
                    <div class="item-label">Kazanma Oranı</div>
                    <div class="item-value">${Utils.Format.percentage(stats?.winRate * 100 || 0)}</div>
                </div>
            </div>
        `;
    }

    /**
     * Portfolio stats güncelle
     */
    function updatePortfolioStats() {
        if (!window.PortfolioManager || !dashboardElements.portfolioStats) return;

        const portfolio = PortfolioManager.getPortfolio();
        const performance = PortfolioManager.getPerformanceMetrics();

        if (!portfolio) {
            dashboardElements.portfolioStats.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-chart-pie"></i>
                    <p>Portföy bilgisi yok</p>
                </div>
            `;
            return;
        }

        dashboardElements.portfolioStats.innerHTML = `
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-icon"><i class="fas fa-coins"></i></div>
                    <div class="stat-content">
                        <div class="stat-label">Aktif Pozisyonlar</div>
                        <div class="stat-value">${portfolio.activeTrades || 0}</div>
                    </div>
                </div>
                <div class="stat-item">
                    <div class="stat-icon"><i class="fas fa-percentage"></i></div>
                    <div class="stat-content">
                        <div class="stat-label">Kullanılan Allocation</div>
                        <div class="stat-value">${Utils.Format.percentage(portfolio.totalAllocation || 0)}</div>
                    </div>
                </div>
                <div class="stat-item">
                    <div class="stat-icon"><i class="fas fa-eye"></i></div>
                    <div class="stat-content">
                        <div class="stat-label">Watch List</div>
                        <div class="stat-value">${portfolio.watchList?.length || 0} coin</div>
                    </div>
                </div>
                <div class="stat-item">
                    <div class="stat-icon"><i class="fas fa-chart-line"></i></div>
                    <div class="stat-content">
                        <div class="stat-label">Unrealized P&L</div>
                        <div class="stat-value ${portfolio.unrealizedPnL >= 0 ? 'positive' : 'negative'}">
                            ${Utils.Format.currency(portfolio.unrealizedPnL || 0)}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Aktif pozisyonları güncelle
     */
    function updateActivePositions() {
        if (!window.MockTrader || !dashboardElements.activePositions) return;

        const positions = MockTrader.getActivePositions();
        const positionCountBadge = document.getElementById('positionCount');
        
        if (positionCountBadge) {
            positionCountBadge.textContent = positions.length;
        }

        if (positions.length === 0) {
            dashboardElements.activePositions.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>Aktif pozisyon bulunmuyor</p>
                </div>
            `;
            return;
        }

        const positionsHTML = positions.map(position => {
            const pnlClass = position.unrealizedPnL >= 0 ? 'positive' : 'negative';
            const pnlPercent = ((position.unrealizedPnL / position.marginUsed) * 100).toFixed(2);
            
            return `
                <div class="position-item ${position.side}">
                    <div class="position-header">
                        <div class="position-symbol">
                            <span class="symbol">${position.symbol}</span>
                            <span class="side-badge ${position.side}">${position.side.toUpperCase()}</span>
                        </div>
                        <div class="position-pnl ${pnlClass}">
                            ${Utils.Format.currency(position.unrealizedPnL)} (${pnlPercent}%)
                        </div>
                    </div>
                    <div class="position-details">
                        <div class="detail-item">
                            <span class="label">Giriş:</span>
                            <span class="value">${Utils.Format.number(position.entryPrice, 2)}</span>
                        </div>
                        <div class="detail-item">
                            <span class="label">Güncel:</span>
                            <span class="value">${Utils.Format.number(position.currentPrice, 2)}</span>
                        </div>
                        <div class="detail-item">
                            <span class="label">Stop Loss:</span>
                            <span class="value">${Utils.Format.number(position.stopLoss, 2)}</span>
                        </div>
                        <div class="detail-item">
                            <span class="label">Boyut:</span>
                            <span class="value">${Utils.Format.number(position.size, 6)}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        dashboardElements.activePositions.innerHTML = `
            <div class="positions-list">
                ${positionsHTML}
            </div>
        `;
    }

    /**
     * Son sinyalleri güncelle
     */
    function updateRecentSignals() {
        if (!window.SignalGenerator || !dashboardElements.recentSignals) return;

        const signals = SignalGenerator.getActiveSignals();
        const lastSignalTime = document.getElementById('lastSignalTime');

        if (signals.length === 0) {
            dashboardElements.recentSignals.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-satellite-dish"></i>
                    <p>Henüz sinyal yok</p>
                </div>
            `;
            if (lastSignalTime) lastSignalTime.textContent = '-';
            return;
        }

        // En son sinyali bul
        const latestSignal = signals.reduce((latest, current) => 
            current.timestamp > latest.timestamp ? current : latest
        );

        if (lastSignalTime) {
            lastSignalTime.textContent = Utils.Format.date(latestSignal.timestamp, 'HH:mm');
        }

        const signalsHTML = signals.slice(0, 5).map(signal => {
            const strengthClass = signal.strength >= 0.8 ? 'strong' : 
                                 signal.strength >= 0.6 ? 'medium' : 'weak';
            
            return `
                <div class="signal-item ${signal.signal} ${strengthClass}">
                    <div class="signal-header">
                        <span class="signal-symbol">${signal.symbol}</span>
                        <span class="signal-type">${signal.signal.toUpperCase()}</span>
                    </div>
                    <div class="signal-details">
                        <div class="signal-strength">
                            <span class="strength-label">Güven:</span>
                            <div class="strength-bar">
                                <div class="strength-fill" style="width: ${(signal.confidence * 100)}%"></div>
                            </div>
                            <span class="strength-value">${Utils.Format.percentage(signal.confidence * 100)}</span>
                        </div>
                        <div class="signal-time">${Utils.Format.date(signal.timestamp, 'HH:mm')}</div>
                    </div>
                </div>
            `;
        }).join('');

        dashboardElements.recentSignals.innerHTML = `
            <div class="signals-list">
                ${signalsHTML}
            </div>
        `;
    }

    /**
     * Performance chart güncelle
     */
    function updatePerformanceChart(period = '24h') {
        if (!window.PortfolioManager || !dashboardElements.performanceChart) return;

        const history = PortfolioManager.getPortfolioHistory(100);
        
        if (history.length < 2) {
            dashboardElements.performanceChart.innerHTML = `
                <div class="chart-placeholder">
                    <i class="fas fa-chart-area"></i>
                    <p>Yeterli veri yok</p>
                </div>
            `;
            return;
        }

        // Basit chart representation (gerçek chart kütüphanesi olmadığı için)
        const chartData = history.map(item => ({
            time: item.timestamp,
            value: item.totalPnL
        }));

        const minValue = Math.min(...chartData.map(d => d.value));
        const maxValue = Math.max(...chartData.map(d => d.value));
        const range = maxValue - minValue || 1;

        const chartHTML = chartData.map((point, index) => {
            const height = ((point.value - minValue) / range) * 100;
            const color = point.value >= 0 ? '#48bb78' : '#f56565';
            
            return `
                <div class="chart-bar" style="height: ${height}%; background-color: ${color};">
                    <div class="chart-tooltip">
                        <div class="tooltip-time">${Utils.Format.date(point.time, 'HH:mm')}</div>
                        <div class="tooltip-value">${Utils.Format.currency(point.value)}</div>
                    </div>
                </div>
            `;
        }).join('');

        dashboardElements.performanceChart.innerHTML = `
            <div class="chart-container">
                <div class="chart-bars">
                    ${chartHTML}
                </div>
                <div class="chart-summary">
                    <div class="summary-stat">
                        <span class="stat-label">En Yüksek:</span>
                        <span class="stat-value positive">${Utils.Format.currency(maxValue)}</span>
                    </div>
                    <div class="summary-stat">
                        <span class="stat-label">En Düşük:</span>
                        <span class="stat-value negative">${Utils.Format.currency(minValue)}</span>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Risk metrics güncelle
     */
    function updateRiskMetrics() {
        if (!window.RiskManager || !dashboardElements.riskMetrics) return;

        const riskLevel = RiskManager.getCurrentRiskLevel();
        const riskMetrics = RiskManager.getCurrentRiskMetrics();
        const dailyStats = RiskManager.getDailyStats();
        const riskIndicator = document.getElementById('riskLevel');

        // Risk level indicator güncelle
        if (riskIndicator) {
            const riskDot = riskIndicator.querySelector('.risk-dot');
            const riskText = riskIndicator.querySelector('span:last-child');
            
            if (riskDot) {
                riskDot.className = `risk-dot ${riskLevel}`;
            }
            if (riskText) {
                riskText.textContent = riskLevel.toUpperCase();
            }
        }

        dashboardElements.riskMetrics.innerHTML = `
            <div class="risk-grid">
                <div class="risk-item">
                    <div class="risk-label">Günlük Kayıp</div>
                    <div class="risk-value ${dailyStats.dailyLossPercent > 5 ? 'warning' : ''}">
                        ${Utils.Format.percentage(dailyStats.dailyLossPercent)}
                    </div>
                    <div class="risk-bar">
                        <div class="risk-fill" style="width: ${Math.min(dailyStats.dailyLossPercent / 10 * 100, 100)}%"></div>
                    </div>
                </div>
                <div class="risk-item">
                    <div class="risk-label">Max Drawdown</div>
                    <div class="risk-value ${riskMetrics.drawdownPercent > 10 ? 'warning' : ''}">
                        ${Utils.Format.percentage(riskMetrics.drawdownPercent)}
                    </div>
                    <div class="risk-bar">
                        <div class="risk-fill" style="width: ${Math.min(riskMetrics.drawdownPercent / 15 * 100, 100)}%"></div>
                    </div>
                </div>
                <div class="risk-item">
                    <div class="risk-label">Aktif Pozisyonlar</div>
                    <div class="risk-value">${riskMetrics.activePositions}/5</div>
                    <div class="risk-bar">
                        <div class="risk-fill" style="width: ${(riskMetrics.activePositions / 5) * 100}%"></div>
                    </div>
                </div>
                <div class="risk-item">
                    <div class="risk-label">Günlük İşlemler</div>
                    <div class="risk-value">${dailyStats.tradesOpened}/20</div>
                    <div class="risk-bar">
                        <div class="risk-fill" style="width: ${(dailyStats.tradesOpened / 20) * 100}%"></div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Update callback ekle
     */
    function addUpdateCallback(id, callback) {
        updateCallbacks.set(id, callback);
    }

    /**
     * Update callback kaldır
     */
    function removeUpdateCallback(id) {
        updateCallbacks.delete(id);
    }

    /**
     * Dashboard'u durdur
     */
    function destroy() {
        if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
        }
        
        updateCallbacks.clear();
        isInitialized = false;
        
        Logger.info(Logger.CATEGORIES.UI, 'Dashboard durduruldu');
    }

    // Public API
    return {
        init: init,
        destroy: destroy,
        refreshAllData: refreshAllData,
        addUpdateCallback: addUpdateCallback,
        removeUpdateCallback: removeUpdateCallback,
        
        // Individual update functions
        updateAccountSummary: updateAccountSummary,
        updatePortfolioStats: updatePortfolioStats,
        updateActivePositions: updateActivePositions,
        updateRecentSignals: updateRecentSignals,
        updatePerformanceChart: updatePerformanceChart,
        updateRiskMetrics: updateRiskMetrics,
        
        isInitialized: function() {
            return isInitialized;
        }
    };

})();

// Auto-initialize
if (window.Config && window.Logger && window.Utils) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            Dashboard.init();
        });
    } else {
        Dashboard.init();
    }
} else {
    console.warn('Dashboard: Gerekli modüller bulunamadı');
}
