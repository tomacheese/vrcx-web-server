/* global Vue, Vuetify */

const { createApp } = Vue
const { createVuetify } = Vuetify

const vuetify = createVuetify({
  theme: {
    defaultTheme: 'dark',
  },
})

const app = createApp({
  data() {
    return {
      apiBaseUrl: undefined,
      tab: 1,
      userId: '',
      websocket: {
        feed: undefined,
        gamelog: undefined,
      },
      websocketHandlerMap: new WeakMap(),
      closingWebSockets: new WeakSet(),
      websocketReconnectTimers: {
        feed: undefined,
        gamelog: undefined,
      },
      pollingTimers: {
        feed: undefined,
        gamelog: undefined,
      },
      pollingIntervalMs: 1000 * 10,
      headers: [
        { title: '', key: 'data-table-expand' },
        {
          title: '日付',
          key: 'created_at',
        },
        {
          title: '種類',
          key: 'type',
        },
        {
          title: 'ユーザー',
          key: 'display_name',
        },
        {
          title: '詳細',
          key: 'details',
        },
      ],
      feed: {
        expanded: [],
        items: [],
        loadingItems: [],
        search: '',
        selectTypes: ['gps', 'status', 'bio', 'avatar', 'online', 'offline'],
        types: {
          gps: 'GPS',
          status: 'Status',
          bio: 'Bio',
          avatar: 'Avatar',
          online: 'Online',
          offline: 'Offline',
        },
      },
      gamelog: {
        expanded: [],
        items: [],
        loadingItems: [],
        search: '',
        selectTypes: [
          'location',
          'onplayerjoined',
          'onplayerleft',
          'video_play',
          'event',
        ],
        types: {
          location: 'Location',
          onplayerjoined: 'OnPlayerJoined',
          onplayerleft: 'OnPlayerLeft',
          video_play: 'Video Play',
          event: 'Event',
        },
      },
    }
  },
  async mounted() {
    if (!this.apiBaseUrl) {
      this.apiBaseUrl = globalThis.location.origin
    }

    await this.fetchUserId()

    await Promise.all([
      this.fetchRecords(1, 1000, 'feed'),
      this.fetchRecords(1, 1000, 'gamelog'),
    ])

    this.initializeRealtime()
  },
  beforeUnmount() {
    this.cleanupRealtime()
  },
  watch: {
    tab() {
      this.fetchRecords(1, 1000)
    },
  },
  computed: {
    filteredItems() {
      if (this.tab === 1) {
        return this.feed.items
          .filter((item) => {
            return this.feed.selectTypes.includes(item.type)
          })
          .filter((item) => {
            return [
              item.display_name,
              item.details,
              this.getWorldName(item.data),
              item.data.status_description,
              item.data.status,
              item.data.bio,
              item.data.avatar_name,
            ]
              .join(' ')
              .toLowerCase()
              .includes(this.feed.search.toLowerCase())
          })
      } else if (this.tab === 2) {
        return this.gamelog.items
          .filter((item) => {
            return this.gamelog.selectTypes.includes(item.type)
          })
          .filter((item) => {
            return [
              item.display_name,
              item.details,
              this.getWorldName(item.data),
              item.data.status_description,
              item.data.status,
              item.data.bio,
              item.data.avatar_name,
            ]
              .join(' ')
              .toLowerCase()
              .includes(this.gamelog.search.toLowerCase())
          })
      }

      return []
    },
  },
  methods: {
    initializeRealtime() {
      const WebSocketConstructor = this.getWebSocketConstructor()
      if (!WebSocketConstructor) {
        this.startPolling('feed')
        this.startPolling('gamelog')
        return
      }

      this.connectFeedWebSocket()
      this.connectGameLogWebSocket()
    },
    cleanupRealtime() {
      this.stopPolling('feed')
      this.stopPolling('gamelog')
      this.clearReconnectTimer('feed')
      this.clearReconnectTimer('gamelog')
      this.disconnectWebSocket('feed')
      this.disconnectWebSocket('gamelog')
    },
    getWebSocketConstructor() {
      return globalThis.WebSocket === undefined
        ? undefined
        : globalThis.WebSocket
    },
    connectFeedWebSocket() {
      const WebSocketConstructor = this.getWebSocketConstructor()
      if (!WebSocketConstructor) {
        this.startPolling('feed')
        return
      }

      if (!this.userId) {
        this.startPolling('feed')
        return
      }

      this.disconnectWebSocket('feed')

      const url = this.createWebSocketUrl({
        channel: 'feed',
        userId: this.userId,
        limit: '1000',
      })

      try {
        const socket = new WebSocketConstructor(url)
        this.registerWebSocket('feed', socket)
      } catch (error) {
        console.error('Failed to open feed websocket', error)
        this.startPolling('feed')
        this.scheduleReconnect('feed')
      }
    },
    connectGameLogWebSocket() {
      const WebSocketConstructor = this.getWebSocketConstructor()
      if (!WebSocketConstructor) {
        this.startPolling('gamelog')
        return
      }

      this.disconnectWebSocket('gamelog')

      const url = this.createWebSocketUrl({
        channel: 'gamelog',
        limit: '1000',
      })

      try {
        const socket = new WebSocketConstructor(url)
        this.registerWebSocket('gamelog', socket)
      } catch (error) {
        console.error('Failed to open gamelog websocket', error)
        this.startPolling('gamelog')
        this.scheduleReconnect('gamelog')
      }
    },
    registerWebSocket(channel, socket) {
      const handlers = this.createWebSocketHandlers(channel, socket)
      this.websocketHandlerMap.set(socket, handlers)
      socket.addEventListener('open', handlers.open)
      socket.addEventListener('message', handlers.message)
      socket.addEventListener('error', handlers.error)
      socket.addEventListener('close', handlers.close)
      this.websocket[channel] = socket
    },
    createWebSocketHandlers(channel, socket) {
      const openHandler = () => {
        this.stopPolling(channel)
      }
      const messageHandler = (event) => {
        if (channel === 'feed') {
          this.handleFeedMessage(event)
        } else {
          this.handleGameLogMessage(event)
        }
      }
      const errorHandler = () => {
        socket.close()
      }
      const closeHandler = () => {
        this.cleanupWebSocketAfterClose(channel, socket)
      }

      return {
        open: openHandler,
        message: messageHandler,
        error: errorHandler,
        close: closeHandler,
      }
    },
    cleanupWebSocketAfterClose(channel, socket) {
      const handlers = this.websocketHandlerMap.get(socket)
      if (handlers) {
        socket.removeEventListener('open', handlers.open)
        socket.removeEventListener('message', handlers.message)
        socket.removeEventListener('error', handlers.error)
        socket.removeEventListener('close', handlers.close)
        this.websocketHandlerMap.delete(socket)
      }

      const isCurrentSocket = this.websocket[channel] === socket
      if (isCurrentSocket) {
        this.websocket[channel] = undefined
      }

      const isClosing = this.closingWebSockets.has(socket)
      if (isClosing) {
        this.closingWebSockets.delete(socket)
        return
      }

      if (isCurrentSocket) {
        this.startPolling(channel)
        this.scheduleReconnect(channel)
      }
    },
    disconnectWebSocket(channel) {
      const socket = this.websocket[channel]
      if (!socket) {
        return
      }

      this.closingWebSockets.add(socket)
      this.websocket[channel] = undefined
      try {
        socket.close()
      } catch (error) {
        console.error('Failed to close websocket', error)
        this.closingWebSockets.delete(socket)
        this.cleanupWebSocketAfterClose(channel, socket)
      }
    },
    scheduleReconnect(channel) {
      if (this.websocketReconnectTimers[channel] !== undefined) {
        return
      }

      const timer = globalThis.setTimeout(() => {
        this.websocketReconnectTimers[channel] = undefined
        if (channel === 'feed') {
          this.connectFeedWebSocket()
        } else {
          this.connectGameLogWebSocket()
        }
      }, 5000)

      this.websocketReconnectTimers[channel] = timer
    },
    clearReconnectTimer(channel) {
      const timer = this.websocketReconnectTimers[channel]
      if (timer !== undefined) {
        globalThis.clearTimeout(timer)
        this.websocketReconnectTimers[channel] = undefined
      }
    },
    startPolling(channel) {
      this.stopPolling(channel)

      const fetcher = () => {
        this.fetchRecords(1, 1000, channel).catch((error) => {
          console.error('Failed to fetch records for polling', error)
        })
      }

      fetcher()
      const timer = globalThis.setInterval(fetcher, this.pollingIntervalMs)
      this.pollingTimers[channel] = timer
    },
    stopPolling(channel) {
      const timer = this.pollingTimers[channel]
      if (timer !== undefined) {
        globalThis.clearInterval(timer)
        this.pollingTimers[channel] = undefined
      }
    },
    createWebSocketUrl(parameters) {
      const url = new URL('/ws', this.apiBaseUrl)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      for (const [key, value] of Object.entries(parameters)) {
        url.searchParams.set(key, value)
      }
      return url.toString()
    },
    handleFeedMessage(event) {
      const payload = this.parseRealtimeMessage(event.data)
      if (!payload) {
        return
      }

      if (payload.type === 'feed') {
        this.updateFeedFromRealtime(payload.data)
      } else if (payload.type === 'error') {
        this.handleRealtimeError('feed', payload.message)
      }
    },
    handleGameLogMessage(event) {
      const payload = this.parseRealtimeMessage(event.data)
      if (!payload) {
        return
      }

      if (payload.type === 'gamelog') {
        this.updateGameLogFromRealtime(payload.data)
      } else if (payload.type === 'error') {
        this.handleRealtimeError('gamelog', payload.message)
      }
    },
    handleRealtimeError(channel, message) {
      console.error(`Realtime error (${channel}):`, message)
      this.startPolling(channel)
      this.scheduleReconnect(channel)
    },
    parseRealtimeMessage(data) {
      try {
        return JSON.parse(data)
      } catch (error) {
        console.error('Failed to parse realtime message', error)
      }
    },
    updateFeedFromRealtime(payload) {
      const loadingItems = [
        ...this.processGpsFeed(payload.gps ?? []),
        ...this.processStatusFeed(payload.status ?? []),
        ...this.processBioFeed(payload.bio ?? []),
        ...this.processAvatarFeed(payload.avatar ?? []),
        ...this.processOnlineOfflineFeed(payload.online_offline ?? []),
      ]
      loadingItems.sort((a, b) => {
        return b.created_at - a.created_at
      })
      this.feed.loadingItems = loadingItems
      this.feed.items = loadingItems
    },
    updateGameLogFromRealtime(payload) {
      const loadingItems = [
        ...this.processLocationLog(payload.location ?? []),
        ...this.processJoinLeaveLog(payload.join_leave ?? []),
        ...this.processVideoPlayLog(payload.video_play ?? []),
        ...this.processEventLog(payload.event ?? []),
      ]
      loadingItems.sort((a, b) => {
        return b.created_at - a.created_at
      })
      this.gamelog.loadingItems = loadingItems
      this.gamelog.items = loadingItems
    },
    async fetchUserId() {
      const url = new URL('/api/configs', this.apiBaseUrl)
      const response = await fetch(url)
      const data = await response.json()

      const key = 'config:lastuserloggedin'
      const config = data.find((item) => item.key === key)
      this.userId = config?.value || ''
    },
    async fetchRecords(page, limit, channel) {
      const target = channel || (this.tab === 1 ? 'feed' : 'gamelog')
      if (target === 'feed') {
        await this.fetchAllFeed(page, limit)
      } else if (target === 'gamelog') {
        await this.fetchAllGameLog(page, limit)
      }
    },
    async fetchAllFeed(page, limit) {
      this.feed.loadingItems = []
      await Promise.all([
        this.fetchGpsFeed(page, limit),
        this.fetchStatusFeed(page, limit),
        this.fetchBioFeed(page, limit),
        this.fetchAvatarFeed(page, limit),
        this.fetchOnlineOfflineFeed(page, limit),
      ]).then(() => {
        this.feed.loadingItems.sort((a, b) => {
          return b.created_at - a.created_at
        })
        this.feed.items = this.feed.loadingItems
      })
    },
    async fetchGpsFeed(page, limit) {
      const type = 'gps'
      const pathUserId = this.userId.replaceAll(/[_-]/g, '')
      const path = `/api/${pathUserId}_feed_${type}`
      const url = new URL(path, this.apiBaseUrl)
      url.searchParams.append('limit', limit || 1000)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      this.feed.loadingItems.push(...this.processGpsFeed(items))
    },
    processGpsFeed(items) {
      return items.map((item) => ({
        id: `gps-${item.id}`,
        created_at: new Date(item.created_at),
        type: 'gps',
        display_name: item.display_name,
        details: this.getWorldName(item),
        data: item,
      }))
    },
    async fetchStatusFeed(page, limit) {
      const type = 'status'
      const pathUserId = this.userId.replaceAll(/[_-]/g, '')
      const path = `/api/${pathUserId}_feed_${type}`
      const url = new URL(path, this.apiBaseUrl)
      url.searchParams.append('limit', limit || 1000)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      this.feed.loadingItems.push(...this.processStatusFeed(items))
    },
    processStatusFeed(items) {
      return items.map((item) => ({
        id: `status-${item.id}`,
        created_at: new Date(item.created_at),
        type: 'status',
        display_name: item.display_name,
        details: `${item.status_description} (${item.status})`,
        data: item,
      }))
    },
    async fetchBioFeed(page, limit) {
      const type = 'bio'
      const pathUserId = this.userId.replaceAll(/[_-]/g, '')
      const path = `/api/${pathUserId}_feed_${type}`
      const url = new URL(path, this.apiBaseUrl)
      url.searchParams.append('limit', limit || 1000)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      this.feed.loadingItems.push(...this.processBioFeed(items))
    },
    processBioFeed(items) {
      return items.map((item) => ({
        id: `bio-${item.id}`,
        created_at: new Date(item.created_at),
        type: 'bio',
        display_name: item.display_name,
        details: item.bio,
        data: item,
      }))
    },
    async fetchAvatarFeed(page, limit) {
      const type = 'avatar'
      const pathUserId = this.userId.replaceAll(/[_-]/g, '')
      const path = `/api/${pathUserId}_feed_${type}`
      const url = new URL(path, this.apiBaseUrl)
      url.searchParams.append('limit', limit || 1000)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      this.feed.loadingItems.push(...this.processAvatarFeed(items))
    },
    processAvatarFeed(items) {
      return items.map((item) => ({
        id: `avatar-${item.id}`,
        created_at: new Date(item.created_at),
        type: 'avatar',
        display_name: item.display_name,
        details: item.avatar_name,
        data: item,
      }))
    },
    async fetchOnlineOfflineFeed(page, limit) {
      const type = 'online_offline'
      const pathUserId = this.userId.replaceAll(/[_-]/g, '')
      const path = `/api/${pathUserId}_feed_${type}`
      const url = new URL(path, this.apiBaseUrl)
      url.searchParams.append('limit', limit || 1000)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      this.feed.loadingItems.push(...this.processOnlineOfflineFeed(items))
    },
    processOnlineOfflineFeed(items) {
      return items.map((item) => ({
        id: `${item.type}-${item.id}`,
        created_at: new Date(item.created_at),
        type: (item.type || '').toLowerCase(),
        display_name: item.display_name,
        details: this.getWorldName(item),
        data: item,
      }))
    },
    async fetchAllGameLog(page, limit) {
      this.gamelog.loadingItems = []
      await Promise.all([
        this.fetchLocationLog(page, limit),
        this.fetchJoinLeaveLog(page, limit),
        this.fetchVideoPlayLog(page, limit),
        this.fetchEventLog(page, limit),
      ]).then(() => {
        this.gamelog.loadingItems.sort((a, b) => {
          return b.created_at - a.created_at
        })
        this.gamelog.items = this.gamelog.loadingItems
      })
    },
    async fetchLocationLog(page, limit) {
      const type = 'location'
      const path = `/api/gamelog_${type}`
      const url = new URL(path, this.apiBaseUrl)
      url.searchParams.append('limit', limit || 1000)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      this.gamelog.loadingItems.push(...this.processLocationLog(items))
    },
    processLocationLog(items) {
      return items.map((item) => ({
        id: `location-${item.id}`,
        created_at: new Date(item.created_at),
        type: 'location',
        display_name: '',
        details: this.getWorldName(item),
        data: item,
      }))
    },
    async fetchJoinLeaveLog(page, limit) {
      const type = 'join_leave'
      const path = `/api/gamelog_${type}`
      const url = new URL(path, this.apiBaseUrl)
      url.searchParams.append('limit', limit || 1000)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      this.gamelog.loadingItems.push(...this.processJoinLeaveLog(items))
    },
    processJoinLeaveLog(items) {
      return items.map((item) => ({
        id: `${item.type}-${item.id}`,
        created_at: new Date(item.created_at),
        type: (item.type || '').toLowerCase(),
        display_name: item.display_name,
        details: '',
        data: item,
      }))
    },
    async fetchVideoPlayLog(page, limit) {
      const type = 'video_play'
      const path = `/api/gamelog_${type}`
      const url = new URL(path, this.apiBaseUrl)
      url.searchParams.append('limit', limit || 1000)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      this.gamelog.loadingItems.push(...this.processVideoPlayLog(items))
    },
    processVideoPlayLog(items) {
      return items.map((item) => ({
        id: `video_play-${item.id}`,
        created_at: new Date(item.created_at),
        type: 'video_play',
        display_name: item.display_name,
        details: item.video_name,
        data: item,
      }))
    },
    async fetchEventLog(page, limit) {
      const type = 'event'
      const path = `/api/gamelog_${type}`
      const url = new URL(path, this.apiBaseUrl)
      url.searchParams.append('limit', limit || 1000)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      this.gamelog.loadingItems.push(...this.processEventLog(items))
    },
    processEventLog(items) {
      return items.map((item) => ({
        id: `event-${item.id}`,
        created_at: new Date(item.created_at),
        type: 'event',
        display_name: '',
        details: item.data,
        data: item,
      }))
    },
    getWorldName(item) {
      if (item.world_name) {
        return item.world_name
      } else if (item.location === 'private') {
        return 'Private'
      } else if (item.location === 'traveling') {
        return 'Traveling'
      } else {
        return 'Unknown'
      }
    },
    formatDate(date) {
      return date.toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    },
  },
})
app.use(vuetify).mount('#app')
