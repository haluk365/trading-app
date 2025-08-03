/**
 * WEBSOCKET BAĞLANTISI MODÜLÜ
 * Binance WebSocket stream'leri için real-time veri bağlantısı
 * Otomatik reconnection, subscription management ve error handling
 */

window.WebSocketManager = (function() {
    'use strict';

    let isInitialized = false;
    let connections = new Map();
    let subscriptions = new Map();
    let reconnectAttempts = new Map();
    let heartbeatIntervals = new Map();

    const WS_URLS = {
        testnet: 'wss://testnet-dstream.binance.com/ws',
        mainnet: 'wss://stream.binance.com:9443/ws'
    };

    const RECONNECT_CONFIG = {
        maxAttempts: 5,
        baseDelay: 1000,
        maxDelay: 30000,
        backoffMultiplier: 2
    };

    /**
     * WebSocket Manager'ı başlat
     */
    function init() {
        if (isInitialized) {
            Logger.warning(Logger.CATEGORIES.WEBSOCKET, 'WebSocketManager zaten başlatılmış');
            return true;
        }

        try {
            // Global WebSocket error handler
            setupGlobalErrorHandler();
            
            // Cleanup on page unload
            setupCleanupHandlers();

            isInitialized = true;
            Logger.success(Logger.CATEGORIES.WEBSOCKET, 'WebSocketManager başlatıldı', {
                testnet: Config.get('BINANCE.useTestnet', true),
                wsUrl: getWebSocketURL()
            });
            
            return true;
        } catch (error) {
            Logger.error(Logger.CATEGORIES.WEBSOCKET, 'WebSocketManager başlatma hatası', error);
            return false;
        }
    }

    /**
     * WebSocket URL'ini al
     */
    function getWebSocketURL() {
        const useTestnet = Config.get('BINANCE.useTestnet', true);
        return useTestnet ? WS_URLS.testnet : WS_URLS.mainnet;
    }

    /**
     * Global error handler kurulumu
     */
    function setupGlobalErrorHandler() {
        // WebSocket constructor override ederek global error handling ekle
        const originalWebSocket = window.WebSocket;
        window.WebSocket = function(url, protocols) {
            const ws = new originalWebSocket(url, protocols);
            
            // Add global error tracking
            ws.addEventListener('error', function(event) {
                ErrorHandler.handleWebSocketError(event, { url });
            });
            
            return ws;
        };
    }

    /**
     * Cleanup handler'ları kur
     */
    function setupCleanupHandlers() {
        window.addEventListener('beforeunload', function() {
            closeAllConnections();
        });

        window.addEventListener('online', function() {
            Logger.info(Logger.CATEGORIES.WEBSOCKET, 'Network online - reconnecting...');
            reconnectAll();
        });

        window.addEventListener('offline', function() {
            Logger.warning(Logger.CATEGORIES.WEBSOCKET, 'Network offline detected');
        });
    }

    /**
     * WebSocket bağlantısı oluştur
     */
    function createConnection(streamName, callbacks = {}) {
        return ErrorHandler.safeAsync(async function() {
            const connectionId = generateConnectionId(streamName);
            
            if (connections.has(connectionId)) {
                Logger.warning(Logger.CATEGORIES.WEBSOCKET, `Bağlantı zaten mevcut: ${streamName}`);
                return connections.get(connectionId);
            }

            const wsUrl = `${getWebSocketURL()}/${streamName}`;
            Logger.info(Logger.CATEGORIES.WEBSOCKET, `WebSocket bağlantısı kuruluyor: ${streamName}`);

            const ws = new WebSocket(wsUrl);
            const connectionInfo = {
                id: connectionId,
                streamName: streamName,
                websocket: ws,
                callbacks: callbacks,
                status: 'connecting',
                connectedAt: null,
                lastMessage: null,
                messageCount: 0,
                subscriptions: new Set()
            };

            // Event handlers
            setupWebSocketHandlers(connectionInfo);
            
            // Connection'ı kaydet
            connections.set(connectionId, connectionInfo);
            reconnectAttempts.set(connectionId, 0);

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    Logger.error(Logger.CATEGORIES.WEBSOCKET, `Bağlantı timeout: ${streamName}`);
                    reject(new Error('WebSocket connection timeout'));
                }, 10000);

                ws.addEventListener('open', function() {
                    clearTimeout(timeout);
                    Logger.success(Logger.CATEGORIES.WEBSOCKET, `WebSocket bağlandı: ${streamName}`);
                    resolve(connectionInfo);
                });

                ws.addEventListener('error', function(event) {
                    clearTimeout(timeout);
                    Logger.error(Logger.CATEGORIES.WEBSOCKET, `Bağlantı hatası: ${streamName}`, event);
                    reject(event);
                });
            });

        }, `WebSocket Connection: ${streamName}`)();
    }

    /**
     * WebSocket event handler'ları kur
     */
    function setupWebSocketHandlers(connectionInfo) {
        const { websocket, callbacks, id, streamName } = connectionInfo;

        websocket.addEventListener('open', function() {
            connectionInfo.status = 'connected';
            connectionInfo.connectedAt = Date.now();
            reconnectAttempts.set(id, 0);
            
            // Heartbeat başlat
            startHeartbeat(id);
            
            if (callbacks.onOpen) {
                callbacks.onOpen(connectionInfo);
            }
            
            Logger.debug(Logger.CATEGORIES.WEBSOCKET, `Connection opened: ${streamName}`);
        });

        websocket.addEventListener('message', function(event) {
            connectionInfo.lastMessage = Date.now();
            connectionInfo.messageCount++;
            
            try {
                const data = JSON.parse(event.data);
                
                // Rate limiting check
                if (connectionInfo.messageCount % 100 === 0) {
                    Logger.debug(Logger.CATEGORIES.WEBSOCKET, `Messages received: ${connectionInfo.messageCount}`, {
                        streamName,
                        uptime: Date.now() - connectionInfo.connectedAt
                    });
                }
                
                if (callbacks.onMessage) {
                    callbacks.onMessage(data, connectionInfo);
                }
                
                // Subscription handler'larını çağır
                handleSubscriptionMessage(data, connectionInfo);
                
            } catch (error) {
                Logger.error(Logger.CATEGORIES.WEBSOCKET, 'Message parse hatası', {
                    streamName,
                    message: event.data,
                    error: error.message
                });
            }
        });

        websocket.addEventListener('close', function(event) {
            connectionInfo.status = 'disconnected';
            
            // Heartbeat'i durdur
            stopHeartbeat(id);
            
            Logger.warning(Logger.CATEGORIES.WEBSOCKET, `Connection closed: ${streamName}`, {
                code: event.code,
                reason: event.reason,
                wasClean: event.wasClean
            });

            if (callbacks.onClose) {
                callbacks.onClose(event, connectionInfo);
            }

            // Otomatik reconnection (eğer beklenmeyen kapanma ise)
            if (!event.wasClean && event.code !== 1000) {
                scheduleReconnect(id);
            }
        });

        websocket.addEventListener('error', function(event) {
            connectionInfo.status = 'error';
            
            Logger.error(Logger.CATEGORIES.WEBSOCKET, `WebSocket error: ${streamName}`, event);
            
            if (callbacks.onError) {
                callbacks.onError(event, connectionInfo);
            }
        });
    }

    /**
     * Heartbeat sistemi başlat
     */
    function startHeartbeat(connectionId) {
        const interval = setInterval(() => {
            const connection = connections.get(connectionId);
            if (!connection || connection.status !== 'connected') {
                clearInterval(interval);
                return;
            }

            const now = Date.now();
            const timeSinceLastMessage = now - (connection.lastMessage || connection.connectedAt);
            
            // 60 saniyedir mesaj gelmemişse ping gönder
            if (timeSinceLastMessage > 60000) {
                try {
                    connection.websocket.send(JSON.stringify({ method: 'ping' }));
                    Logger.debug(Logger.CATEGORIES.WEBSOCKET, `Ping sent: ${connection.streamName}`);
                } catch (error) {
                    Logger.error(Logger.CATEGORIES.WEBSOCKET, 'Ping gönderme hatası', error);
                }
            }
            
            // 120 saniyedir mesaj gelmemişse reconnect
            if (timeSinceLastMessage > 120000) {
                Logger.warning(Logger.CATEGORIES.WEBSOCKET, `No messages received, reconnecting: ${connection.streamName}`);
                reconnectConnection(connectionId);
            }
            
        }, 30000); // Her 30 saniye kontrol

        heartbeatIntervals.set(connectionId, interval);
    }

    /**
     * Heartbeat'i durdur
     */
    function stopHeartbeat(connectionId) {
        const interval = heartbeatIntervals.get(connectionId);
        if (interval) {
            clearInterval(interval);
            heartbeatIntervals.delete(connectionId);
        }
    }

    /**
     * Reconnection planla
     */
    function scheduleReconnect(connectionId) {
        const connection = connections.get(connectionId);
        if (!connection) return;

        const attempts = reconnectAttempts.get(connectionId) || 0;
        
        if (attempts >= RECONNECT_CONFIG.maxAttempts) {
            Logger.error(Logger.CATEGORIES.WEBSOCKET, `Max reconnect attempts reached: ${connection.streamName}`);
            return;
        }

        const delay = Math.min(
            RECONNECT_CONFIG.baseDelay * Math.pow(RECONNECT_CONFIG.backoffMultiplier, attempts),
            RECONNECT_CONFIG.maxDelay
        );

        Logger.info(Logger.CATEGORIES.WEBSOCKET, `Reconnect scheduled in ${delay}ms: ${connection.streamName}`, {
            attempt: attempts + 1,
            maxAttempts: RECONNECT_CONFIG.maxAttempts
        });

        setTimeout(() => {
            reconnectConnection(connectionId);
        }, delay);

        reconnectAttempts.set(connectionId, attempts + 1);
    }

    /**
     * Bağlantıyı yeniden kur
     */
    async function reconnectConnection(connectionId) {
        const connection = connections.get(connectionId);
        if (!connection) return;

        Logger.info(Logger.CATEGORIES.WEBSOCKET, `Reconnecting: ${connection.streamName}`);

        // Eski bağlantıyı kapat
        if (connection.websocket.readyState === WebSocket.OPEN) {
            connection.websocket.close();
        }

        try {
            // Yeni bağlantı oluştur
            const newConnection = await createConnection(connection.streamName, connection.callbacks);
            
            // Subscriptions'ları tekrar ekle
            for (const subscription of connection.subscriptions) {
                newConnection.subscriptions.add(subscription);
            }
            
            Logger.success(Logger.CATEGORIES.WEBSOCKET, `Reconnected successfully: ${connection.streamName}`);
            
        } catch (error) {
            Logger.error(Logger.CATEGORIES.WEBSOCKET, `Reconnection failed: ${connection.streamName}`, error);
            scheduleReconnect(connectionId);
        }
    }

    /**
     * Subscription message handler
     */
    function handleSubscriptionMessage(data, connectionInfo) {
        // Stream data'sını parse et
        if (data.stream && data.data) {
            const streamType = parseStreamType(data.stream);
            const handlers = subscriptions.get(streamType);
            
            if (handlers && handlers.size > 0) {
                handlers.forEach(handler => {
                    try {
                        handler(data.data, data.stream, connectionInfo);
                    } catch (error) {
                        Logger.error(Logger.CATEGORIES.WEBSOCKET, 'Subscription handler hatası', error);
                    }
                });
            }
        }
    }

    /**
     * Stream tipini parse et
     */
    function parseStreamType(stream) {
        if (stream.includes('@kline_')) return 'kline';
        if (stream.includes('@ticker')) return 'ticker';
        if (stream.includes('@depth')) return 'depth';
        if (stream.includes('@trade')) return 'trade';
        if (stream.includes('@aggTrade')) return 'aggTrade';
        return 'unknown';
    }

    /**
     * Connection ID oluştur
     */
    function generateConnectionId(streamName) {
        return `ws_${streamName}_${Date.now()}`;
    }

    /**
     * Kline stream'e subscribe ol
     */
    async function subscribeKline(symbol, interval, callback) {
        const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
        
        try {
            const connection = await createConnection(streamName, {
                onMessage: function(data) {
                    if (data.e === 'kline') {
                        const kline = data.k;
                        const parsedKline = {
                            symbol: kline.s,
                            timestamp: kline.t,
                            closeTime: kline.T,
                            open: parseFloat(kline.o),
                            high: parseFloat(kline.h),
                            low: parseFloat(kline.l),
                            close: parseFloat(kline.c),
                            volume: parseFloat(kline.v),
                            isClosed: kline.x
                        };
                        
                        callback(parsedKline);
                    }
                }
            });
            
            Logger.success(Logger.CATEGORIES.WEBSOCKET, `Kline subscription active: ${symbol} ${interval}`);
            return connection;
            
        } catch (error) {
            Logger.error(Logger.CATEGORIES.WEBSOCKET, `Kline subscription failed: ${symbol} ${interval}`, error);
            throw error;
        }
    }

    /**
     * Ticker stream'e subscribe ol
     */
    async function subscribeTicker(symbol, callback) {
        const streamName = `${symbol.toLowerCase()}@ticker`;
        
        try {
            const connection = await createConnection(streamName, {
                onMessage: function(data) {
                    if (data.e === '24hrTicker') {
                        const ticker = {
                            symbol: data.s,
                            price: parseFloat(data.c),
                            priceChange: parseFloat(data.p),
                            priceChangePercent: parseFloat(data.P),
                            high: parseFloat(data.h),
                            low: parseFloat(data.l),
                            volume: parseFloat(data.v),
                            count: parseInt(data.c),
                            timestamp: data.E
                        };
                        
                        callback(ticker);
                    }
                }
            });
            
            Logger.success(Logger.CATEGORIES.WEBSOCKET, `Ticker subscription active: ${symbol}`);
            return connection;
            
        } catch (error) {
            Logger.error(Logger.CATEGORIES.WEBSOCKET, `Ticker subscription failed: ${symbol}`, error);
            throw error;
        }
    }

    /**
     * Multiple streams'e subscribe ol
     */
    async function subscribeMultiple(streams, callback) {
        const streamName = streams.join('/');
        
        try {
            const connection = await createConnection(streamName, {
                onMessage: callback
            });
            
            Logger.success(Logger.CATEGORIES.WEBSOCKET, `Multiple subscription active: ${streams.length} streams`);
            return connection;
            
        } catch (error) {
            Logger.error(Logger.CATEGORIES.WEBSOCKET, 'Multiple subscription failed', error);
            throw error;
        }
    }

    /**
     * Subscription handler ekle
     */
    function addSubscriptionHandler(streamType, handler) {
        if (!subscriptions.has(streamType)) {
            subscriptions.set(streamType, new Set());
        }
        
        subscriptions.get(streamType).add(handler);
        Logger.debug(Logger.CATEGORIES.WEBSOCKET, `Subscription handler added: ${streamType}`);
    }

    /**
     * Subscription handler kaldır
     */
    function removeSubscriptionHandler(streamType, handler) {
        const handlers = subscriptions.get(streamType);
        if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) {
                subscriptions.delete(streamType);
            }
        }
        Logger.debug(Logger.CATEGORIES.WEBSOCKET, `Subscription handler removed: ${streamType}`);
    }

    /**
     * Bağlantıyı kapat
     */
    function closeConnection(connectionId) {
        const connection = connections.get(connectionId);
        if (connection) {
            stopHeartbeat(connectionId);
            
            if (connection.websocket.readyState === WebSocket.OPEN) {
                connection.websocket.close(1000, 'Manual close');
            }
            
            connections.delete(connectionId);
            reconnectAttempts.delete(connectionId);
            
            Logger.info(Logger.CATEGORIES.WEBSOCKET, `Connection closed: ${connection.streamName}`);
        }
    }

    /**
     * Tüm bağlantıları kapat
     */
    function closeAllConnections() {
        Logger.info(Logger.CATEGORIES.WEBSOCKET, `Closing ${connections.size} connections...`);
        
        for (const [connectionId] of connections) {
            closeConnection(connectionId);
        }
        
        connections.clear();
        subscriptions.clear();
        reconnectAttempts.clear();
        heartbeatIntervals.clear();
    }

    /**
     * Tüm bağlantıları yeniden kur
     */
    async function reconnectAll() {
        const connectionIds = Array.from(connections.keys());
        
        Logger.info(Logger.CATEGORIES.WEBSOCKET, `Reconnecting ${connectionIds.length} connections...`);
        
        for (const connectionId of connectionIds) {
            try {
                await reconnectConnection(connectionId);
            } catch (error) {
                Logger.error(Logger.CATEGORIES.WEBSOCKET, `Bulk reconnect failed: ${connectionId}`, error);
            }
        }
    }

    // Public API
    return {
        // Initialization
        init: init,
        isInitialized: function() { return isInitialized; },
        
        // Connection management
        createConnection: createConnection,
        closeConnection: closeConnection,
        closeAllConnections: closeAllConnections,
        reconnectConnection: reconnectConnection,
        reconnectAll: reconnectAll,
        
        // Subscriptions
        subscribeKline: subscribeKline,
        subscribeTicker: subscribeTicker,
        subscribeMultiple: subscribeMultiple,
        
        // Subscription handlers
        addSubscriptionHandler: addSubscriptionHandler,
        removeSubscriptionHandler: removeSubscriptionHandler,
        
        // Status and info
        getConnections: function() {
            const result = {};
            for (const [id, connection] of connections) {
                result[id] = {
                    streamName: connection.streamName,
                    status: connection.status,
                    connectedAt: connection.connectedAt,
                    messageCount: connection.messageCount,
                    lastMessage: connection.lastMessage
                };
            }
            return result;
        },
        
        getConnectionCount: function() {
            return connections.size;
        },
        
        getWebSocketURL: getWebSocketURL
    };

})();

// Auto-initialize
if (window.Config && window.Logger && window.ErrorHandler) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            WebSocketManager.init();
        });
    } else {
        WebSocketManager.init();
    }
} else {
    console.warn('WebSocketManager: Gerekli modüller bulunamadı');
}
