/* global Vue, Vuetify, WebSocket */

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
      websocket: undefined,
      websocketConnected: false,
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
      maxReconnectDelay: 30000,
      reconnectInterval: undefined,
      wsInitTimeoutId: undefined,
      fallbackIntervalId: undefined,
      initialWsTimeoutMs: 5000,
      fallbackPollIntervalMs: 10000,
      headers: [
        { title: '', key: 'data-table-expand' },
        { title: '日付', key: 'created_at' },
        { title: '種類', key: 'type' },
        { title: 'ユーザー', key: 'display_name' },
        { title: '詳細', key: 'details' },
      ],
      feed: {
        expanded: [],
        items: [],
        loadingItems: [],
        search: '',
        selectTypes: ['gps', 'status', 'bio', 'avatar', 'online', 'offline'],
        types: { gps: 'GPS', status: 'Status', bio: 'Bio', avatar: 'Avatar', online: 'Online', offline: 'Offline' },
      },
      gamelog: {
        expanded: [],
        items: [],
        loadingItems: [],
        search: '',
        selectTypes: ['location', 'onplayerjoined', 'onplayerleft', 'video_play', 'event'],
        types: { location: 'Location', onplayerjoined: 'OnPlayerJoined', onplayerleft: 'OnPlayerLeft', video_play: 'Video Play', event: 'Event' },
      },
    }
  },
  async mounted() {
    if (!this.apiBaseUrl) {
      this.apiBaseUrl = globalThis.location.origin
    }

    await this.fetchUserId()
    this.initWebSocket()

    // WS初期データが一定時間届かない場合はRESTフォールバックを開始
    this.wsInitTimeoutId = setTimeout(() => {
      if (this.feed.items.length === 0 && this.gamelog.items.length === 0) {
        this.startFallbackPolling()
      }
      this.wsInitTimeoutId = undefined
    }, this.initialWsTimeoutMs)
  },
  watch: {
    tab() {
      // No REST fetch on tab change; WS payload drives updates for both tabs
      console.log('tab', this.tab)
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
    },
  },
  methods: {
    async fetchUserId() {
      const url = new URL('/api/configs', this.apiBaseUrl)
      const response = await fetch(url)
      const data = await response.json()

      const key = 'config:lastuserloggedin'
      const config = data.find((item) => item.key === key)
      this.userId = config.value
    },
    initWebSocket() {
      if (this.websocket) {
        this.websocket.close()
      }

      const wsUrl = this.apiBaseUrl.replace(/^http/, 'ws') + '/api/ws'
      console.log('Connecting to WebSocket:', wsUrl)
      
      this.websocket = new WebSocket(wsUrl)

      this.websocket.addEventListener('open', () => {
        console.log('WebSocket connected')
        this.websocketConnected = true
        this.reconnectAttempts = 0
        this.stopFallbackPolling()
        // Subscribe to updates
        this.websocket.send(JSON.stringify({ type: 'subscribe' }))
        if (this.reconnectInterval) {
          clearInterval(this.reconnectInterval)
          this.reconnectInterval = undefined
        }
      })

      this.websocket.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data)
          this.handleWebSocketMessage(data)
        } catch (error) {
          console.error('Error parsing WebSocket message:', error)
        }
      })

      this.websocket.addEventListener('close', () => {
        console.log('WebSocket disconnected')
        this.websocketConnected = false
        // 開いていた場合のフォールバック再開
        this.startFallbackPolling()
        this.attemptReconnect()
      })

      this.websocket.addEventListener('error', (error) => {
        console.error('WebSocket error:', error)
        this.websocketConnected = false
      })
    },
    handleWebSocketMessage(data) {
      switch (data.type) {
        case 'initial_data': {
          this.applyWsPayload(data.data)
          break
        }
        case 'data_update': {
          this.applyWsPayload(data.data)
          break
        }
        case 'pong': {
          break
        }
        default: {
          console.warn('Unknown WebSocket message type:', data.type)
        }
      }
    },
    attemptReconnect() {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('Max reconnection attempts reached')
        return
      }

      this.reconnectAttempts++
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay) // Exponential backoff
      
      console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)
      
      this.reconnectInterval = setTimeout(() => {
        this.initWebSocket()
      }, delay)
    },    // REST-based fetch functions kept for fallback only (not used in WS-only mode)

    applyWsPayload(payload) {
      if (!payload) return
      const feed = Array.isArray(payload.feed) ? payload.feed : []
      this.feed.items = this.shapeFeedRecords(feed)
      const gamelog = Array.isArray(payload.gamelog) ? payload.gamelog : []
      this.gamelog.items = this.shapeGamelogRecords(gamelog)
    },
    shapeFeedRecords(records) {
      const shaped = []
      for (const rec of records) {
        const raw = rec.data || {}
        let type = rec.type
        let details = ''
        switch (type) {
          case 'gps': {
            details = this.getWorldName(raw)
            break
          }
          case 'status': {
            details = `${raw.status_description} (${raw.status})`
            break
          }
          case 'bio': {
            details = raw.bio
            break
          }
          case 'avatar': {
            details = raw.avatar_name
            break
          }
          case 'online_offline': {
            details = this.getWorldName(raw)
            type = (raw.type || type).toLowerCase()
            break
          }
        }
        shaped.push({
          id: `${type}-${raw.id}`,
          created_at: new Date(rec.created_at),
          type,
          display_name: raw.display_name || rec.display_name || '',
          details,
          data: raw,
        })
      }
      shaped.sort((a, b) => b.created_at - a.created_at)
      return shaped
    },
    shapeGamelogRecords(records) {
      const shaped = []
      for (const rec of records) {
        const raw = rec.data || {}
        let type = rec.type
        let details = ''
        let id = `${type}-${raw.id}`
        switch (type) {
          case 'location': {
            details = this.getWorldName(raw)
            break
          }
          case 'join_leave': {
            type = (raw.type || type).toLowerCase()
            id = `${raw.type || type}-${raw.id}`
            details = ''
            break
          }
          case 'video_play': {
            details = raw.video_name
            break
          }
          case 'event': {
            details = raw.data
            break
          }
        }
        shaped.push({
          id,
          created_at: new Date(rec.created_at),
          type,
          display_name: raw.display_name || rec.display_name || '',
          details,
          data: raw,
        })
      }
      shaped.sort((a, b) => b.created_at - a.created_at)
      return shaped
    },
    async fetchRecords(page, limit) {
      if (this.tab === 1) {
        this.fetchAllFeed(page, limit)
      } else if (this.tab === 2) {
        this.fetchAllGameLog(page, limit)
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
      for (const item of items) {
        this.feed.loadingItems.push({
          id: `${type}-${item.id}`,
          created_at: new Date(item.created_at),
          type,
          display_name: item.display_name,
          details: this.getWorldName(item),
          data: item,
        })
      }
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
      for (const item of items) {
        this.feed.loadingItems.push({
          id: `${type}-${item.id}`,
          created_at: new Date(item.created_at),
          type,
          display_name: item.display_name,
          details: `${item.status_description} (${item.status})`,
          data: item,
        })
      }
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
      for (const item of items) {
        this.feed.loadingItems.push({
          id: `${type}-${item.id}`,
          created_at: new Date(item.created_at),
          type,
          display_name: item.display_name,
          details: item.bio,
          data: item,
        })
      }
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
      for (const item of items) {
        this.feed.loadingItems.push({
          id: `${type}-${item.id}`,
          created_at: new Date(item.created_at),
          type,
          display_name: item.display_name,
          details: item.avatar_name,
          data: item,
        })
      }
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
      for (const item of items) {
        this.feed.loadingItems.push({
          id: `${item.type}-${item.id}`,
          created_at: new Date(item.created_at),
          type: item.type.toLowerCase(),
          display_name: item.display_name,
          details: this.getWorldName(item),
          data: item,
        })
      }
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
      for (const item of items) {
        this.gamelog.loadingItems.push({
          id: `${type}-${item.id}`,
          created_at: new Date(item.created_at),
          type,
          display_name: '',
          details: this.getWorldName(item),
          data: item,
        })
      }
    },
    async fetchJoinLeaveLog(page, limit) {
      const type = 'join_leave'
      const path = `/api/gamelog_${type}`
      const url = new URL(path, this.apiBaseUrl)
      url.searchParams.append('limit', limit || 1000)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      for (const item of items) {
        this.gamelog.loadingItems.push({
          id: `${item.type}-${item.id}`,
          created_at: new Date(item.created_at),
          type: item.type.toLowerCase(),
          display_name: item.display_name,
          details: '',
          data: item,
        })
      }
    },
    // fetchPortalSpawnLog: ログみたことがなくてわからない
    async fetchVideoPlayLog(page, limit) {
      const type = 'video_play'
      const path = `/api/gamelog_${type}`
      const url = new URL(path, this.apiBaseUrl)
      url.searchParams.append('limit', limit || 1000)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      for (const item of items) {
        this.gamelog.loadingItems.push({
          id: `${type}-${item.id}`,
          created_at: new Date(item.created_at),
          type,
          display_name: item.display_name,
          details: item.video_name,
          data: item,
        })
      }
    },
    // fetchResourceLoadLog: ログみたことがなくてわからない
    async fetchEventLog(page, limit) {
      const type = 'event'
      const path = `/api/gamelog_${type}`
      const url = new URL(path, this.apiBaseUrl)
      url.searchParams.append('limit', limit || 1000)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      for (const item of items) {
        this.gamelog.loadingItems.push({
          id: `${type}-${item.id}`,
          created_at: new Date(item.created_at),
          type,
          display_name: '',
          details: item.data,
          data: item,
        })
      }
    },
    // fetchExternalLog: ログみたことがなくてわからない
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
    startFallbackPolling() {
      // すでに開始済みなら何もしない
      if (this.fallbackIntervalId) return
      this.fallbackIntervalId = setInterval(() => {
        this.fetchRecords(1, 1000)
      }, this.fallbackPollIntervalMs)
    },
    stopFallbackPolling() {
      if (this.fallbackIntervalId) {
        clearInterval(this.fallbackIntervalId)
        this.fallbackIntervalId = undefined
      }
    },
  beforeUnmount() {
    if (this.websocket) {
      this.websocket.close()
      this.websocket = undefined
    }
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval)
      this.reconnectInterval = undefined
    }
    if (this.wsInitTimeoutId) {
      clearTimeout(this.wsInitTimeoutId)
      this.wsInitTimeoutId = undefined
    }
    if (this.fallbackIntervalId) {
      clearInterval(this.fallbackIntervalId)
      this.fallbackIntervalId = undefined
    }
  },
})
app.use(vuetify).mount('#app')
