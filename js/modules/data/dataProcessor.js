/**
 * DATA PROCESSOR MODÜLÜ
 * API ve WebSocket verilerini işleme ve normalize etme
 * Multi-timeframe veri yönetimi ve synchronization
 */

window.DataProcessor = (function() {
    'use strict';

    let isInitialized = false;
    let dataBuffers = new Map(); // Symbol-timeframe bazında veri buffer'ları
    let dataStreams = new Map(); // Active data streams
    let processingQueue = [];
    let isProcessing = false;

    const BUFFER_LIMITS = {
        '1m': 1440,   // 1 day
        '5m': 1440,   // 5 days  
        '15m': 1440,  // 15 days
        '30m': 1440,  // 30 days
        '1h': 1440,   // 60 days
        '4h': 1440,   // 240 days
        '1d': 365     // 1 year
    };

    /**
     * Data Processor'u başlat
     */
    function init() {
        if (isInitialized) {
            Logger.warning(Logger.CATEGORIES.STORAGE, 'DataProcessor zaten başlatılmış');
            return true;
        }

        try {
            // Processing queue'yu başlat
            startProcessingQueue();
            
            // WebSocket event handler'larını kur
            setupWebSocketHandlers();
            
            // Cleanup scheduler'ı başlat
            startCleanupScheduler();

            isInitialized = true;
            Logger.success(Logger.CATEGORIES.STORAGE, 'DataProcessor başlatıldı');
            return true;
            
        } catch (error) {
            Logger.error(Logger.CATEGORIES.STORAGE, 'DataProcessor başlatma hatası', error);
            return false;
        }
    }

    /**
     * Processing queue'yu başlat
     */
    function startProcessingQueue() {
        setInterval(async () => {
            if (!isProcessing && processingQueue.length > 0) {
                isProcessing = true;
                
                try {
                    const task = processingQueue.shift();
                    await processTask(task);
                } catch (error) {
                    Logger.error(Logger.CATEGORIES.STORAGE, 'Processing queue hatası', error);
                } finally {
                    isProcessing = false;
                }
            }
        }, 100); // Her 100ms kontrol et
    }

    /**
     * WebSocket handler'larını kur
     */
    function setupWebSocketHandlers() {
        // Kline stream handler
        WebSocketManager.addSubscriptionHandler('kline', (data, stream, connection) => {
            queueTask({
                type: 'kline_update',
                data: data,
                stream: stream,
                timestamp: Date.now()
            });
        });

        // Ticker stream handler
        WebSocketManager.addSubscriptionHandler('ticker', (data, stream, connection) => {
            queueTask({
                type: 'ticker_update',
                data: data,
                stream: stream,
                timestamp: Date.now()
            });
        });

        Logger.debug(Logger.CATEGORIES.STORAGE, 'WebSocket handlers kuruldu');
    }

    /**
     * Cleanup scheduler'ı başlat
     */
    function startCleanupScheduler() {
        // Her 5 dakikada eski verileri temizle
        setInterval(() => {
            cleanupOldData();
        }, 5 * 60 * 1000);
    }

    /**
     * Task'i queue'ya ekle
     */
    function queueTask(task) {
        processingQueue.push(task);
        
        // Queue çok büyürse eski task'ları sil
        if (processingQueue.length > 1000) {
            processingQueue = processingQueue.slice(-500);
            Logger.warning(Logger.CATEGORIES.STORAGE, 'Processing queue overflow, cleaned');
        }
    }

    /**
     * Task'i işle
     */
    async function processTask(task) {
        try {
            switch (task.type) {
                case 'kline_update':
                    await processKlineUpdate(task.data, task.stream);
                    break;
                    
                case 'ticker_update':
                    await processTickerUpdate(task.data, task.stream);
                    break;
                    
                case 'bulk_data_load':
                    await processBulkDataLoad(task.data);
                    break;
                    
                default:
                    Logger.warning(Logger.CATEGORIES.STORAGE, `Unknown task type: ${task.type}`);
            }
        } catch (error) {
            Logger.error(Logger.CATEGORIES.STORAGE, 'Task processing hatası', { task, error });
        }
    }

    /**
     * Kline update'ini işle
     */
    async function processKlineUpdate(klineData, stream) {
        const { symbol, timestamp, open, high, low, close, volume, isClosed } = klineData;
        
        // Stream'den timeframe'i parse et
        const timeframe = parseTimeframeFromStream(stream);
        if (!timeframe) {
            Logger.warning(Logger.CATEGORIES.STORAGE, 'Timeframe parse edilemedi', { stream });
            return;
        }

        const bufferKey = getBufferKey(symbol, timeframe);
        
        // Buffer'ı al veya oluştur
        if (!dataBuffers.has(bufferKey)) {
            await initializeBuffer(symbol, timeframe);
        }
        
        const buffer = dataBuffers.get(bufferKey);
        if (!buffer) return;

        // Son candle'ı bul
        const lastCandle = buffer.data[buffer.data.length - 1];
        
        if (lastCandle && lastCandle.timestamp === timestamp) {
            // Mevcut candle'ı güncelle
            lastCandle.high = Math.max(lastCandle.high, high);
            lastCandle.low = Math.min(lastCandle.low, low);
            lastCandle.close = close;
            lastCandle.volume = volume;
            lastCandle.isClosed = isClosed;
            
            Logger.debug(Logger.CATEGORIES.STORAGE, `Kline updated: ${symbol} ${timeframe}`);
        } else {
            // Yeni candle ekle
            const newCandle = {
                timestamp,
                open,
                high,
                low,
                close,
                volume,
                isClosed
            };
            
            buffer.data.push(newCandle);
            
            // Buffer limit kontrolü
            const limit = BUFFER_LIMITS[timeframe] || 1000;
            if (buffer.data.length > limit) {
                buffer.data = buffer.data.slice(-limit);
            }
            
            Logger.debug(Logger.CATEGORIES.STORAGE, `Kline added: ${symbol} ${timeframe}`, {
                total: buffer.data.length
            });
        }
        
        // Son güncelleme zamanını kaydet
        buffer.lastUpdate = Date.now();
        
        // Event trigger et
        triggerDataEvent('kline_updated', {
            symbol,
            timeframe,
            candle: klineData,
            buffer: buffer
        });
    }

    /**
     * Ticker update'ini işle
     */
    async function processTickerUpdate(tickerData, stream) {
        const { symbol, price, priceChange, priceChangePercent, high, low, volume } = tickerData;
        
        // Ticker data'sını cache'le
        Storage.cache.set(`ticker_${symbol}`, tickerData, 5000); // 5 saniye cache
        
        Logger.debug(Logger.CATEGORIES.STORAGE, `Ticker updated: ${symbol}`, {
            price,
            change: priceChangePercent
        });
        
        // Event trigger et
        triggerDataEvent('ticker_updated', {
            symbol,
            ticker: tickerData
        });
    }

    /**
     * Bulk data load'unu işle
     */
    async function processBulkDataLoad(loadData) {
        const { symbol, timeframe, data, source } = loadData;
        
        Logger.info(Logger.CATEGORIES.STORAGE, `Bulk data loading: ${symbol} ${timeframe}`, {
            count: data.length,
            source
        });
        
        const bufferKey = getBufferKey(symbol, timeframe);
        const buffer = {
            symbol,
            timeframe,
            data: data.slice(), // Copy array
            lastUpdate: Date.now(),
            source: source
        };
        
        dataBuffers.set(bufferKey, buffer);
        
        // IndexedDB'ye kaydet
        try {
            await Storage.db.set(Storage.STORES.KLINE_DATA, {
                id: `${symbol}_${timeframe}_${Date.now()}`,
                symbol,
                timeframe,
                timestamp: Date.now(),
                data: data,
                source: source
            });
        } catch (error) {
            Logger.warning(Logger.CATEGORIES.STORAGE, 'IndexedDB bulk save hatası', error);
        }
        
        Logger.success(Logger.CATEGORIES.STORAGE, `Bulk data loaded: ${symbol} ${timeframe}`, {
            count: data.length
        });
        
        triggerDataEvent('bulk_data_loaded', {
            symbol,
            timeframe,
            count: data.length,
            buffer: buffer
        });
    }

    /**
     * Buffer'ı başlat
     */
    async function initializeBuffer(symbol, timeframe) {
        const bufferKey = getBufferKey(symbol, timeframe);
        
        if (dataBuffers.has(bufferKey)) {
            return dataBuffers.get(bufferKey);
        }

        Logger.info(Logger.CATEGORIES.STORAGE, `Buffer başlatılıyor: ${symbol} ${timeframe}`);
        
        try {
            // Önce cache'den kontrol et
            const cached = Storage.cache.get(bufferKey);
            if (cached) {
                dataBuffers.set(bufferKey, cached);
                Logger.debug(Logger.CATEGORIES.STORAGE, `Buffer cache'den yüklendi: ${bufferKey}`);
                return cached;
            }
            
            // API'den initial data al
            const limit = Math.min(BUFFER_LIMITS[timeframe] || 500, 1000);
            const klineData = await BinanceAPI.getKlines(symbol, timeframe, { limit });
            
            const buffer = {
                symbol,
                timeframe,
                data: klineData,
                lastUpdate: Date.now(),
                source: 'api'
            };
            
            dataBuffers.set(bufferKey, buffer);
            
            // Cache'e koy
            Storage.cache.set(bufferKey, buffer, 60000); // 1 dakika cache
            
            Logger.success(Logger.CATEGORIES.STORAGE, `Buffer başlatıldı: ${symbol} ${timeframe}`, {
                count: klineData.length
            });
            
            return buffer;
            
        } catch (error) {
            Logger.error(Logger.CATEGORIES.STORAGE, `Buffer başlatma hatası: ${symbol} ${timeframe}`, error);
            
            // Boş buffer oluştur
            const emptyBuffer = {
                symbol,
                timeframe,
                data: [],
                lastUpdate: Date.now(),
                source: 'empty'
            };
            
            dataBuffers.set(bufferKey, emptyBuffer);
            return emptyBuffer;
        }
    }

    /**
     * Stream'den timeframe parse et
     */
    function parseTimeframeFromStream(stream) {
        const match = stream.match(/@kline_(\w+)/);
        return match ? match[1] : null;
    }

    /**
     * Buffer key oluştur
     */
    function getBufferKey(symbol, timeframe) {
        return `${symbol}_${timeframe}`;
    }

    /**
     * Data event trigger et
     */
    function triggerDataEvent(eventType, eventData) {
        // Custom event dispatch
        const event = new CustomEvent(`dataProcessor.${eventType}`, {
            detail: eventData
        });
        
        document.dispatchEvent(event);
        
        Logger.debug(Logger.CATEGORIES.STORAGE, `Data event triggered: ${eventType}`, eventData);
    }

    /**
     * Eski verileri temizle
     */
    function cleanupOldData() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 saat
        let cleanedCount = 0;
        
        for (const [key, buffer] of dataBuffers.entries()) {
            if (now - buffer.lastUpdate > maxAge) {
                dataBuffers.delete(key);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            Logger.info(Logger.CATEGORIES.STORAGE, `Data cleanup: ${cleanedCount} buffer temizlendi`);
        }
    }

    /**
     * Multi-timeframe data al
     */
    async function getMultiTimeframeData(symbol, timeframes) {
        const results = {};
        
        Logger.info(Logger.CATEGORIES.STORAGE, `Multi-timeframe data alınıyor: ${symbol}`, { timeframes });
        
        for (const timeframe of timeframes) {
            try {
                const buffer = await getBufferData(symbol, timeframe);
                results[timeframe] = buffer.data;
            } catch (error) {
                Logger.error(Logger.CATEGORIES.STORAGE, `Multi-timeframe error: ${symbol} ${timeframe}`, error);
                results[timeframe] = [];
            }
        }
        
        return results;
    }

    /**
     * Buffer data al
     */
    async function getBufferData(symbol, timeframe, options = {}) {
        const bufferKey = getBufferKey(symbol, timeframe);
        let buffer = dataBuffers.get(bufferKey);
        
        if (!buffer || options.forceRefresh) {
            buffer = await initializeBuffer(symbol, timeframe);
        }
        
        // Veri yaşı kontrolü
        const dataAge = Date.now() - buffer.lastUpdate;
        const maxAge = options.maxAge || 60000; // Default 1 dakika
        
        if (dataAge > maxAge && options.refresh !== false) {
            Logger.debug(Logger.CATEGORIES.STORAGE, `Buffer refreshing: ${bufferKey} (age: ${dataAge}ms)`);
            buffer = await initializeBuffer(symbol, timeframe);
        }
        
        // Slice options
        let data = buffer.data;
        
        if (options.limit) {
            data = data.slice(-options.limit);
        }
        
        if (options.startTime || options.endTime) {
            data = data.filter(candle => {
                if (options.startTime && candle.timestamp < options.startTime) return false;
                if (options.endTime && candle.timestamp > options.endTime) return false;
                return true;
            });
        }
        
        return {
            ...buffer,
            data: data
        };
    }

    /**
     * Real-time stream başlat
     */
    async function startDataStream(symbol, timeframes, callback) {
        const streamId = `stream_${symbol}_${Date.now()}`;
        
        Logger.info(Logger.CATEGORIES.STORAGE, `Data stream başlatılıyor: ${symbol}`, { timeframes });
        
        const connections = [];
        
        for (const timeframe of timeframes) {
            try {
                // Buffer'ı hazırla
                await initializeBuffer(symbol, timeframe);
                
                // WebSocket subscription
                const connection = await WebSocketManager.subscribeKline(symbol, timeframe, (klineData) => {
                    // Callback'i trigger et
                    if (callback) {
                        callback({
                            symbol,
                            timeframe,
                            kline: klineData,
                            type: 'kline_update'
                        });
                    }
                });
                
                connections.push(connection);
                
            } catch (error) {
                Logger.error(Logger.CATEGORIES.STORAGE, `Stream error: ${symbol} ${timeframe}`, error);
            }
        }
        
        // Stream bilgisini kaydet
        dataStreams.set(streamId, {
            symbol,
            timeframes,
            connections,
            callback,
            startTime: Date.now()
        });
        
        Logger.success(Logger.CATEGORIES.STORAGE, `Data stream aktif: ${symbol}`, {
            streamId,
            connections: connections.length
        });
        
        return streamId;
    }

    /**
     * Data stream'i durdur
     */
    function stopDataStream(streamId) {
        const stream = dataStreams.get(streamId);
        if (!stream) {
            Logger.warning(Logger.CATEGORIES.STORAGE, `Stream bulunamadı: ${streamId}`);
            return false;
        }
        
        // Bağlantıları kapat
        stream.connections.forEach(connection => {
            WebSocketManager.closeConnection(connection.id);
        });
        
        dataStreams.delete(streamId);
        
        Logger.info(Logger.CATEGORIES.STORAGE, `Data stream durduruldu: ${streamId}`);
        return true;
    }

    // Public API
    return {
        // Initialization
        init: init,
        isInitialized: function() { return isInitialized; },
        
        // Data management
        getBufferData: getBufferData,
        getMultiTimeframeData: getMultiTimeframeData,
        initializeBuffer: initializeBuffer,
        
        // Streaming
        startDataStream: startDataStream,
        stopDataStream: stopDataStream,
        
        // Processing
        queueTask: queueTask,
        
        // Buffer management
        getBuffer: function(symbol, timeframe) {
            return dataBuffers.get(getBufferKey(symbol, timeframe));
        },
        
        getAllBuffers: function() {
            const result = {};
            for (const [key, buffer] of dataBuffers.entries()) {
                result[key] = {
                    symbol: buffer.symbol,
                    timeframe: buffer.timeframe,
                    dataLength: buffer.data.length,
                    lastUpdate: buffer.lastUpdate,
                    source: buffer.source
                };
            }
            return result;
        },
        
        clearBuffer: function(symbol, timeframe) {
            const bufferKey = getBufferKey(symbol, timeframe);
            const deleted = dataBuffers.delete(bufferKey);
            if (deleted) {
                Logger.info(Logger.CATEGORIES.STORAGE, `Buffer temizlendi: ${bufferKey}`);
            }
            return deleted;
        },
        
        clearAllBuffers: function() {
            const count = dataBuffers.size;
            dataBuffers.clear();
            Logger.info(Logger.CATEGORIES.STORAGE, `Tüm buffer'lar temizlendi: ${count} adet`);
        },
        
        // Event management
        addEventListener: function(eventType, callback) {
            document.addEventListener(`dataProcessor.${eventType}`, callback);
        },
        
        removeEventListener: function(eventType, callback) {
            document.removeEventListener(`dataProcessor.${eventType}`, callback);
        },
        
        // Statistics
        getStats: function() {
            return {
                bufferCount: dataBuffers.size,
                streamCount: dataStreams.size,
                queueLength: processingQueue.length,
                isProcessing: isProcessing
            };
        }
    };

})();

// Auto-initialize
if (window.Config && window.Logger && window.ErrorHandler && window.Storage && window.BinanceAPI && window.WebSocketManager) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            DataProcessor.init();
        });
    } else {
        DataProcessor.init();
    }
} else {
    console.warn('DataProcessor: Gerekli modüller bulunamadı');
}
