/**
 * UYGULAMA CONFIGURATION DOSYASI
 * Tüm uygulama ayarları ve sabitler
 */

window.Config = (function() {
    'use strict';

    // Ana uygulama ayarları
    const APP = {
        name: 'Crypto Trading Strategy App',
        version: '1.0.0',
        environment: 'development', // development, production
        debug: true,
        autoStart: true
    };

    // Binance API ayarları
    const BINANCE = {
        // Testnet URLs
        testnet: {
            restAPI: 'https://testnet.binance.vision/api',
            websocket: 'wss://testnet-dstream.binance.com/ws',
            futures: 'https://testnet.binancefuture.com'
        },
        
        // Mainnet URLs
        mainnet: {
            restAPI: 'https://api.binance.com/api',
            websocket: 'wss://stream.binance.com:9443/ws',
            futures: 'https://fapi.binance.com'
        },
        
        // Şu an testnet kullanıyoruz
        useTestnet: true,
        
        // API rate limits
        rateLimits: {
            rest: 1200, // requests per minute
            websocket: 10, // connections
            orders: 100 // orders per 10 seconds
        },
        
        // Default pair
        defaultPair: 'BTCUSDT',
        
        // WebSocket reconnection
        reconnect: {
            maxAttempts: 5,
            delay: 1000, // ms
            backoffMultiplier: 2
        }
    };

    // Trading strategy ayarları
    const STRATEGY = {
        // Nadaraya-Watson ayarları
        nadaraya: {
            bandwidth: 8,
            multiplier: 3,
            source: 'close',
            
            // Taşma eşikleri (yüzde)
            thresholds: {
                '15m': 2.0,
                '1h': 1.0,
                '4h': 0.5
            }
        },
        
        // RSI ayarları
        rsi: {
            period: 14,
            overbought: 80,
            oversold: 20,
            source: 'close'
        },
        
        // Moving Averages ayarları
        movingAverages: {
            periods: [7, 25, 99],
            type: 'SMA', // SMA, EMA, WMA
            
            // Aralık kontrolü (yüzde)
            gapThresholds: {
                'ma99_ma25': 5.0,  // MA99-MA25 arası %5
                'ma25_ma7': 5.0,   // MA25-MA7 arası %5
                'ma7_price': 3.0   // MA7-Fiyat arası %3
            }
        },
        
        // ATR ayarları
        atr: {
            period: 14,
            multiplier: 1.5,
            smoothing: 'RMA' // RMA, SMA, EMA, WMA
        },
        
        // Risk yönetimi
        risk: {
            maxPositionSize: 5.0, // Sermayenin %5'i
            maxDailyLoss: 10.0,   // Günlük max %10 kayıp
            trailingStopTrigger: 2.0, // 2x kar etince trailing başlat
            trailingStopPercentage: 30.0 // %30 trailing
        },
        
        // Timeframe'ler
        timeframes: ['15m', '1h', '4h'],
        defaultTimeframe: '15m'
    };

    // Mock trading ayarları
    const MOCK_TRADING = {
        enabled: true,
        initialBalance: 10000, // USDT
        maxLeverage: 20,
        defaultLeverage: 10,
        
        // Slippage simulation
        slippage: {
            enabled: true,
            percentage: 0.1 // %0.1
        },
        
        // Fee simulation
        fees: {
            enabled: true,
            maker: 0.02,  // %0.02
            taker: 0.04   // %0.04
        }
    };

    // UI ayarları
    const UI = {
        // Theme
        theme: 'dark',
        
        // Chart ayarları
        chart: {
            defaultHeight: 400,
            candleColors: {
                up: '#48bb78',
                down: '#f56565'
            },
            gridColor: '#2d3748',
            textColor: '#ffffff'
        },
        
        // Dashboard
        dashboard: {
            refreshInterval: 1000, // ms
            maxSignals: 50,
            autoRefresh: true
        },
        
        // Alerts
        alerts: {
            duration: 5000, // ms
            maxAlerts: 10,
            sound: false,
            desktop: false
        },
        
        // Debug console
        debug: {
            maxLogs: 1000,
            autoScroll: true,
            defaultVisible: false
        }
    };

    // Data management ayarları
    const DATA = {
        // Cache ayarları
        cache: {
            enabled: true,
            ttl: 60000, // 1 minute
            maxSize: 1000 // max cache entries
        },
        
        // Storage
        storage: {
            prefix: 'tradingApp_',
            version: '1.0',
            compression: false
        },
        
        // WebSocket
        websocket: {
            pingInterval: 30000, // 30 seconds
            pongTimeout: 5000,   // 5 seconds
            maxReconnectAttempts: 5
        },
        
        // Kline data
        kline: {
            limits: {
                '1m': 1000,
                '5m': 1000,
                '15m': 1000,
                '1h': 1000,
                '4h': 1000,
                '1d': 1000
            }
        }
    };

    // Coin listesi
    const COINS = {
        default: [
            'BTCUSDT',
            'ETHUSDT',
            'ADAUSDT',
            'BNBUSDT',
            'SOLUSDT',
            'DOTUSDT',
            'MATICUSDT',
            'AVAXUSDT'
        ],
        
        // Volatilite filtreleme
        volatilityFilter: {
            enabled: true,
            maxDailyChange: 15.0, // %15 max günlük değişim
            minVolume: 1000000    // Min 24h volume
        }
    };

    // Alert ayarları
    const ALERTS = {
        types: {
            SIGNAL_DETECTED: 'signal_detected',
            TRADE_OPENED: 'trade_opened',
            TRADE_CLOSED: 'trade_closed',
            STOP_LOSS_HIT: 'stop_loss_hit',
            TAKE_PROFIT_HIT: 'take_profit_hit',
            ERROR_OCCURRED: 'error_occurred'
        },
        
        // Notification ayarları
        notifications: {
            browser: true,
            sound: false,
            email: false
        },
        
        // Sound files
        sounds: {
            signal: '/sounds/signal.mp3',
            success: '/sounds/success.mp3',
            error: '/sounds/error.mp3'
        }
    };

    // Performance monitoring
    const PERFORMANCE = {
        monitoring: {
            enabled: true,
            sampleRate: 0.1, // %10 sampling
            maxEntries: 1000
        },
        
        // Thresholds
        thresholds: {
            slowFunction: 100,  // ms
            memoryUsage: 50,    // MB
            apiResponse: 1000   // ms
        }
    };

    /**
     * Environment'a göre config'i ayarla
     */
    function getEnvironmentConfig() {
        if (APP.environment === 'production') {
            return {
                debug: false,
                binanceTestnet: false,
                mockTrading: false,
                performanceMonitoring: false
            };
        }
        
        return {
            debug: true,
            binanceTestnet: true,
            mockTrading: true,
            performanceMonitoring: true
        };
    }

    /**
     * URL'leri al
     */
    function getURLs() {
        const env = BINANCE.useTestnet ? BINANCE.testnet : BINANCE.mainnet;
        return {
            rest: env.restAPI,
            websocket: env.websocket,
            futures: env.futures
        };
    }

    /**
     * Coin pair'ını validate et
     */
    function isValidPair(symbol) {
        if (!symbol || typeof symbol !== 'string') {
            return false;
        }
        
        // Binance format kontrolü
        return /^[A-Z]{3,10}USDT$/.test(symbol);
    }

    /**
     * Timeframe'i validate et
     */
    function isValidTimeframe(timeframe) {
        const validTimeframes = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];
        return validTimeframes.includes(timeframe);
    }

    /**
     * Config'i local storage'a kaydet
     */
    function saveConfig(key, value) {
        try {
            const configKey = DATA.storage.prefix + 'config_' + key;
            localStorage.setItem(configKey, JSON.stringify(value));
            
            if (window.Logger) {
                Logger.debug(Logger.CATEGORIES.STORAGE, `Config kaydedildi: ${key}`);
            }
            
            return true;
        } catch (error) {
            if (window.Logger) {
                Logger.error(Logger.CATEGORIES.STORAGE, 'Config kaydetme hatası', error);
            }
            return false;
        }
    }

    /**
     * Config'i local storage'dan yükle
     */
    function loadConfig(key, defaultValue = null) {
        try {
            const configKey = DATA.storage.prefix + 'config_' + key;
            const stored = localStorage.getItem(configKey);
            
            if (stored) {
                return JSON.parse(stored);
            }
            
            return defaultValue;
        } catch (error) {
            if (window.Logger) {
                Logger.error(Logger.CATEGORIES.STORAGE, 'Config yükleme hatası', error);
            }
            return defaultValue;
        }
    }

    /**
     * Tüm config'i export et
     */
    function exportConfig() {
        return {
            app: APP,
            binance: BINANCE,
            strategy: STRATEGY,
            mockTrading: MOCK_TRADING,
            ui: UI,
            data: DATA,
            coins: COINS,
            alerts: ALERTS,
            performance: PERFORMANCE,
            environment: getEnvironmentConfig(),
            timestamp: new Date().toISOString()
        };
    }

    // Public API
    const config = {
        // Main config objects
        APP: APP,
        BINANCE: BINANCE,
        STRATEGY: STRATEGY,
        MOCK_TRADING: MOCK_TRADING,
        UI: UI,
        DATA: DATA,
        COINS: COINS,
        ALERTS: ALERTS,
        PERFORMANCE: PERFORMANCE,

        // Helper functions
        getURLs: getURLs,
        getEnvironmentConfig: getEnvironmentConfig,
        isValidPair: isValidPair,
        isValidTimeframe: isValidTimeframe,
        
        // Storage functions
        save: saveConfig,
        load: loadConfig,
        export: exportConfig,

        // Quick access functions
        get: function(path, defaultValue = null) {
            try {
                const keys = path.split('.');
                let value = config;
                
                for (const key of keys) {
                    if (value && typeof value === 'object' && key in value) {
                        value = value[key];
                    } else {
                        return defaultValue;
                    }
                }
                
                return value;
            } catch (error) {
                return defaultValue;
            }
        },

        set: function(path, value) {
            try {
                const keys = path.split('.');
                const lastKey = keys.pop();
                let obj = config;
                
                for (const key of keys) {
                    if (!(key in obj)) {
                        obj[key] = {};
                    }
                    obj = obj[key];
                }
                
                obj[lastKey] = value;
                return true;
            } catch (error) {
                if (window.Logger) {
                    Logger.error(Logger.CATEGORIES.STORAGE, 'Config set hatası', error);
                }
                return false;
            }
        }
    };

    // Initialize
    if (window.Logger) {
        Logger.info(Logger.CATEGORIES.APP, 'Configuration yüklendi', {
            version: APP.version,
            environment: APP.environment,
            testnet: BINANCE.useTestnet
        });
    }

    return config;

})();

// Auto-apply environment config
if (window.Config) {
    const envConfig = Config.getEnvironmentConfig();
    
    // Debug mode'u ayarla
    if (window.Logger && !envConfig.debug) {
        // Production'da debug level'ları kısıtla
        Logger.setFilters({ level: 'info' });
    }
    
    // Performance monitoring'i başlat
    if (envConfig.performanceMonitoring && window.Performance) {
        Performance.start();
    }
}
