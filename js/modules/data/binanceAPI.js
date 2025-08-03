/**
 * BINANCE API MODÜLÜ
 * Binance REST API bağlantısı ve veri çekme işlemleri
 * Rate limiting ve error handling dahil
 */

window.BinanceAPI = (function() {
    'use strict';

    let isInitialized = false;
    let rateLimiter = {
        requests: [],
        maxRequests: 1200, // per minute
        window: 60000 // 1 minute
    };

    const BASE_URLS = {
        testnet: 'https://testnet.binance.vision/api/v3',
        mainnet: 'https://api.binance.com/api/v3'
    };

    /**
     * API'yi başlat
     */
    function init() {
        if (isInitialized) {
            Logger.warning(Logger.CATEGORIES.API, 'BinanceAPI zaten başlatılmış');
            return true;
        }

        try {
            // Rate limiter'ı başlat
            startRateLimiterCleanup();
            
            // Connection test
            testConnection();

            isInitialized = true;
            Logger.success(Logger.CATEGORIES.API, 'BinanceAPI başlatıldı', {
                testnet: Config.get('BINANCE.useTestnet', true),
                baseUrl: getBaseURL()
            });
            
            return true;
        } catch (error) {
            Logger.error(Logger.CATEGORIES.API, 'BinanceAPI başlatma hatası', error);
            return false;
        }
    }

    /**
     * Rate limiter temizleyicisini başlat
     */
    function startRateLimiterCleanup() {
        setInterval(() => {
            const now = Date.now();
            rateLimiter.requests = rateLimiter.requests.filter(
                timestamp => now - timestamp < rateLimiter.window
            );
        }, 10000); // Her 10 saniyede temizle
    }

    /**
     * Base URL'i al
     */
    function getBaseURL() {
        const useTestnet = Config.get('BINANCE.useTestnet', true);
        return useTestnet ? BASE_URLS.testnet : BASE_URLS.mainnet;
    }

    /**
     * Rate limiting kontrolü
     */
    function checkRateLimit() {
        const now = Date.now();
        const recentRequests = rateLimiter.requests.filter(
            timestamp => now - timestamp < rateLimiter.window
        );

        if (recentRequests.length >= rateLimiter.maxRequests) {
            const oldestRequest = Math.min(...recentRequests);
            const waitTime = rateLimiter.window - (now - oldestRequest);
            
            Logger.warning(Logger.CATEGORIES.API, `Rate limit reached, waiting ${waitTime}ms`);
            return waitTime;
        }

        return 0;
    }

    /**
     * HTTP request gönder
     */
    async function makeRequest(endpoint, params = {}, options = {}) {
        return ErrorHandler.safeAsync(async function() {
            // Rate limiting kontrolü
            const waitTime = checkRateLimit();
            if (waitTime > 0) {
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            // Request kaydı
            rateLimiter.requests.push(Date.now());

            // URL oluştur
            const baseUrl = getBaseURL();
            const url = new URL(`${baseUrl}${endpoint}`);
            
            // Parameters ekle
            Object.keys(params).forEach(key => {
                if (params[key] !== null && params[key] !== undefined) {
                    url.searchParams.append(key, params[key]);
                }
            });

            Logger.debug(Logger.CATEGORIES.API, `API Request: ${endpoint}`, { url: url.toString(), params });

            // Fetch options
            const fetchOptions = {
                method: options.method || 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            };

            const startTime = Date.now();
            const response = await fetch(url.toString(), fetchOptions);
            const responseTime = Date.now() - startTime;

            // Response time logging
            if (responseTime > 1000) {
                Logger.warning(Logger.CATEGORIES.API, `Slow API response: ${responseTime}ms`, { endpoint });
            } else {
                Logger.debug(Logger.CATEGORIES.API, `API Response: ${responseTime}ms`, { endpoint });
            }

            // Error handling
            if (!response.ok) {
                const errorData = await response.text();
                let errorMessage;
                
                try {
                    const errorJson = JSON.parse(errorData);
                    errorMessage = errorJson.msg || `HTTP ${response.status}`;
                } catch {
                    errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                }

                const apiError = new Error(errorMessage);
                apiError.status = response.status;
                apiError.url = url.toString();
                apiError.method = fetchOptions.method;

                throw apiError;
            }

            const data = await response.json();
            Logger.debug(Logger.CATEGORIES.API, `API Success: ${endpoint}`, { 
                dataLength: Array.isArray(data) ? data.length : 'object',
                responseTime 
            });

            return data;

        }, `Binance API Request: ${endpoint}`)();
    }

    /**
     * Bağlantı testi
     */
    async function testConnection() {
        try {
            const serverTime = await getServerTime();
            const localTime = Date.now();
            const timeDiff = Math.abs(serverTime - localTime);

            Logger.info(Logger.CATEGORIES.API, 'Binance bağlantısı test edildi', {
                serverTime: new Date(serverTime).toISOString(),
                localTime: new Date(localTime).toISOString(),
                timeDifference: timeDiff
            });

            // Büyük zaman farkı uyarısı
            if (timeDiff > 5000) {
                Logger.warning(Logger.CATEGORIES.API, `Büyük zaman farkı: ${timeDiff}ms`);
            }

            return true;
        } catch (error) {
            Logger.error(Logger.CATEGORIES.API, 'Bağlantı testi başarısız', error);
            throw error;
        }
    }

    /**
     * Server zamanını al
     */
    async function getServerTime() {
        const data = await makeRequest('/time');
        return data.serverTime;
    }

    /**
     * Exchange bilgilerini al
     */
    async function getExchangeInfo() {
        const cacheKey = 'exchange_info';
        const cached = Storage.cache.get(cacheKey);
        
        if (cached) {
            Logger.debug(Logger.CATEGORIES.API, 'Exchange info cache\'den alındı');
            return cached;
        }

        const data = await makeRequest('/exchangeInfo');
        
        // 1 saat cache
        Storage.cache.set(cacheKey, data, 3600000);
        Logger.info(Logger.CATEGORIES.API, 'Exchange info alındı', {
            symbolCount: data.symbols ? data.symbols.length : 0
        });
        
        return data;
    }

    /**
     * Symbol bilgilerini al
     */
    async function getSymbolInfo(symbol) {
        const exchangeInfo = await getExchangeInfo();
        const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol);
        
        if (!symbolInfo) {
            throw new Error(`Symbol bulunamadı: ${symbol}`);
        }
        
        return symbolInfo;
    }

    /**
     * 24hr ticker istatistiklerini al
     */
    async function getTicker24hr(symbol = null) {
        const params = symbol ? { symbol } : {};
        const data = await makeRequest('/ticker/24hr', params);
        
        Logger.debug(Logger.CATEGORIES.API, '24hr ticker alındı', {
            symbol: symbol || 'all',
            count: Array.isArray(data) ? data.length : 1
        });
        
        return data;
    }

    /**
     * Güncel fiyatı al
     */
    async function getCurrentPrice(symbol) {
        const data = await makeRequest('/ticker/price', { symbol });
        return parseFloat(data.price);
    }

    /**
     * Kline/Candlestick verilerini al
     */
    async function getKlines(symbol, interval, options = {}) {
        const params = {
            symbol: symbol,
            interval: interval,
            limit: options.limit || 500
        };

        // Zaman aralığı parametreleri
        if (options.startTime) params.startTime = options.startTime;
        if (options.endTime) params.endTime = options.endTime;

        // Cache kontrolü
        const cacheKey = `klines_${symbol}_${interval}_${params.limit}_${params.startTime || 'latest'}`;
        const cached = Storage.cache.get(cacheKey);
        
        if (cached && !options.forceRefresh) {
            Logger.debug(Logger.CATEGORIES.API, 'Klines cache\'den alındı', { symbol, interval });
            return cached;
        }

        const data = await makeRequest('/klines', params);
        
        // Veriyi parse et
        const parsedData = Utils.Data.parseOHLCV(data);
        
        // Kısa süre cache et (1 dakika)
        Storage.cache.set(cacheKey, parsedData, 60000);
        
        Logger.info(Logger.CATEGORIES.API, 'Klines alındı', {
            symbol,
            interval,
            count: parsedData.length,
            from: parsedData.length > 0 ? new Date(parsedData[0].timestamp).toISOString() : null,
            to: parsedData.length > 0 ? new Date(parsedData[parsedData.length - 1].timestamp).toISOString() : null
        });

        // IndexedDB'ye kaydet (büyük veriler için)
        if (parsedData.length > 100) {
            try {
                await Storage.db.set(Storage.STORES.KLINE_DATA, {
                    id: `${symbol}_${interval}_${Date.now()}`,
                    symbol: symbol,
                    interval: interval,
                    timeframe: interval,
                    timestamp: Date.now(),
                    data: parsedData
                });
            } catch (error) {
                Logger.warning(Logger.CATEGORIES.API, 'Klines IndexedDB kaydetme hatası', error);
            }
        }
        
        return parsedData;
    }

    /**
     * Depth/Order Book al
     */
    async function getDepth(symbol, limit = 100) {
        const params = { symbol, limit };
        const data = await makeRequest('/depth', params);
        
        Logger.debug(Logger.CATEGORIES.API, 'Depth alındı', {
            symbol,
            bids: data.bids.length,
            asks: data.asks.length
        });
        
        return {
            lastUpdateId: data.lastUpdateId,
            bids: data.bids.map(([price, quantity]) => ({
                price: parseFloat(price),
                quantity: parseFloat(quantity)
            })),
            asks: data.asks.map(([price, quantity]) => ({
                price: parseFloat(price),
                quantity: parseFloat(quantity)
            }))
        };
    }

    /**
     * Son işlemleri al
     */
    async function getRecentTrades(symbol, limit = 500) {
        const params = { symbol, limit };
        const data = await makeRequest('/trades', params);
        
        Logger.debug(Logger.CATEGORIES.API, 'Recent trades alındı', {
            symbol,
            count: data.length
        });
        
        return data.map(trade => ({
            id: trade.id,
            price: parseFloat(trade.price),
            qty: parseFloat(trade.qty),
            quoteQty: parseFloat(trade.quoteQty),
            time: trade.time,
            isBuyerMaker: trade.isBuyerMaker
        }));
    }

    /**
     * Historical klines al (büyük veri setleri için)
     */
    async function getHistoricalKlines(symbol, interval, startTime, endTime = null) {
        Logger.info(Logger.CATEGORIES.API, 'Historical klines indiriliyor...', {
            symbol, interval, 
            from: new Date(startTime).toISOString(),
            to: endTime ? new Date(endTime).toISOString() : 'now'
        });

        const allKlines = [];
        let currentStartTime = startTime;
        const limit = 1000; // Max limit
        const intervalMs = getIntervalMs(interval);

        while (true) {
            const options = {
                limit: limit,
                startTime: currentStartTime
            };

            if (endTime) {
                options.endTime = endTime;
            }

            const klines = await getKlines(symbol, interval, options);
            
            if (klines.length === 0) {
                break;
            }

            allKlines.push(...klines);
            
            // Son kline'ın zamanını al
            const lastKline = klines[klines.length - 1];
            currentStartTime = lastKline.timestamp + intervalMs;
            
            // End time'a ulaştıysak dur
            if (endTime && currentStartTime >= endTime) {
                break;
            }

            // Rate limiting için kısa bekleme
            await new Promise(resolve => setTimeout(resolve, 100));
            
            Logger.debug(Logger.CATEGORIES.API, `Historical klines progress: ${allKlines.length} candles`);
        }

        Logger.success(Logger.CATEGORIES.API, 'Historical klines tamamlandı', {
            symbol, interval,
            totalCandles: allKlines.length
        });

        return allKlines;
    }

    /**
     * Interval'ı millisaniyeye çevir
     */
    function getIntervalMs(interval) {
        const intervals = {
            '1m': 60 * 1000,
            '3m': 3 * 60 * 1000,
            '5m': 5 * 60 * 1000,
            '15m': 15 * 60 * 1000,
            '30m': 30 * 60 * 1000,
            '1h': 60 * 60 * 1000,
            '2h': 2 * 60 * 60 * 1000,
            '4h': 4 * 60 * 60 * 1000,
            '6h': 6 * 60 * 60 * 1000,
            '8h': 8 * 60 * 60 * 1000,
            '12h': 12 * 60 * 60 * 1000,
            '1d': 24 * 60 * 60 * 1000,
            '3d': 3 * 24 * 60 * 60 * 1000,
            '1w': 7 * 24 * 60 * 60 * 1000,
            '1M': 30 * 24 * 60 * 60 * 1000
        };
        
        return intervals[interval] || 60 * 1000; // Default 1 minute
    }

    /**
     * Multiple symbols için paralel veri çekme
     */
    async function getMultipleKlines(symbols, interval, options = {}) {
        Logger.info(Logger.CATEGORIES.API, 'Multiple klines indiriliyor...', {
            symbols: symbols.length,
            interval
        });

        const promises = symbols.map(symbol => 
            getKlines(symbol, interval, options).catch(error => {
                Logger.error(Logger.CATEGORIES.API, `Klines hatası: ${symbol}`, error);
                return null;
            })
        );

        const results = await Promise.all(promises);
        
        // Başarılı olanları filtrele
        const successfulResults = {};
        symbols.forEach((symbol, index) => {
            if (results[index]) {
                successfulResults[symbol] = results[index];
            }
        });

        Logger.success(Logger.CATEGORIES.API, 'Multiple klines tamamlandı', {
            requested: symbols.length,
            successful: Object.keys(successfulResults).length
        });

        return successfulResults;
    }

    // Public API
    return {
        // Initialization
        init: init,
        isInitialized: function() { return isInitialized; },
        
        // Basic functions
        getServerTime: getServerTime,
        getExchangeInfo: getExchangeInfo,
        getSymbolInfo: getSymbolInfo,
        testConnection: testConnection,
        
        // Market data
        getCurrentPrice: getCurrentPrice,
        getTicker24hr: getTicker24hr,
        getKlines: getKlines,
        getHistoricalKlines: getHistoricalKlines,
        getMultipleKlines: getMultipleKlines,
        getDepth: getDepth,
        getRecentTrades: getRecentTrades,
        
        // Utility
        getBaseURL: getBaseURL,
        makeRequest: makeRequest,
        
        // Rate limiting info
        getRateLimitInfo: function() {
            const now = Date.now();
            const recentRequests = rateLimiter.requests.filter(
                timestamp => now - timestamp < rateLimiter.window
            );
            
            return {
                currentRequests: recentRequests.length,
                maxRequests: rateLimiter.maxRequests,
                window: rateLimiter.window,
                remainingRequests: rateLimiter.maxRequests - recentRequests.length
            };
        }
    };

})();

// Auto-initialize
if (window.Config && window.Logger && window.ErrorHandler && window.Storage && window.Utils) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            BinanceAPI.init();
        });
    } else {
        BinanceAPI.init();
    }
} else {
    console.warn('BinanceAPI: Gerekli modüller bulunamadı');
}
