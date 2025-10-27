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
      defaultLimit: 1000,
      feedWebSocket: undefined,
      gamelogWebSocket: undefined,
      feedWebSocketConnected: false,
      gamelogWebSocketConnected: false,
      feedReconnectTimer: undefined,
      gamelogReconnectTimer: undefined,
      pollingInterval: undefined,
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
    await this.fetchRecords(1, this.defaultLimit)
    this.startPolling()
    this.setupWebSockets()
  },
  beforeUnmount() {
    this.stopPolling()
    this.teardownFeedWebSocket()
    this.teardownGameLogWebSocket()
  },
  watch: {
    tab() {
      this.fetchRecords(1, this.defaultLimit)
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
    setupWebSockets() {
      if (!('WebSocket' in globalThis)) {
        this.feedWebSocketConnected = false
        this.gamelogWebSocketConnected = false
        this.updatePollingState()
        return
      }
      this.setupFeedWebSocket()
      this.setupGameLogWebSocket()
      this.updatePollingState()
    },
    setupFeedWebSocket() {
      this.teardownFeedWebSocket()
      try {
        const url = new URL('/ws/feed', this.apiBaseUrl)
        url.protocol = url.protocol.replace('http', 'ws')
        url.searchParams.set('limit', `${this.defaultLimit}`)
        const socket = new WebSocket(url)
        socket.addEventListener('open', () => {
          this.feedWebSocketConnected = true
          this.updatePollingState()
        })
        socket.addEventListener('message', (event) => {
          this.handleFeedWebSocketMessage(event)
        })
        socket.addEventListener('close', () => {
          this.feedWebSocketConnected = false
          this.feedWebSocket = undefined
          this.updatePollingState()
          this.scheduleFeedReconnect()
        })
        socket.addEventListener('error', () => {
          socket.close()
        })
        this.feedWebSocket = socket
      } catch (error) {
        console.error('Failed to open feed WebSocket', error)
        this.feedWebSocketConnected = false
        this.feedWebSocket = undefined
        this.updatePollingState()
        this.scheduleFeedReconnect()
      }
    },
    setupGameLogWebSocket() {
      this.teardownGameLogWebSocket()
      try {
        const url = new URL('/ws/gamelog', this.apiBaseUrl)
        url.protocol = url.protocol.replace('http', 'ws')
        url.searchParams.set('limit', `${this.defaultLimit}`)
        const socket = new WebSocket(url)
        socket.addEventListener('open', () => {
          this.gamelogWebSocketConnected = true
          this.updatePollingState()
        })
        socket.addEventListener('message', (event) => {
          this.handleGameLogWebSocketMessage(event)
        })
        socket.addEventListener('close', () => {
          this.gamelogWebSocketConnected = false
          this.gamelogWebSocket = undefined
          this.updatePollingState()
          this.scheduleGameLogReconnect()
        })
        socket.addEventListener('error', () => {
          socket.close()
        })
        this.gamelogWebSocket = socket
      } catch (error) {
        console.error('Failed to open gamelog WebSocket', error)
        this.gamelogWebSocketConnected = false
        this.gamelogWebSocket = undefined
        this.updatePollingState()
        this.scheduleGameLogReconnect()
      }
    },
    scheduleFeedReconnect() {
      if (this.feedReconnectTimer !== undefined) {
        return
      }
      this.feedReconnectTimer = setTimeout(() => {
        this.feedReconnectTimer = undefined
        this.setupFeedWebSocket()
      }, 5000)
    },
    scheduleGameLogReconnect() {
      if (this.gamelogReconnectTimer !== undefined) {
        return
      }
      this.gamelogReconnectTimer = setTimeout(() => {
        this.gamelogReconnectTimer = undefined
        this.setupGameLogWebSocket()
      }, 5000)
    },
    teardownFeedWebSocket() {
      if (this.feedReconnectTimer !== undefined) {
        clearTimeout(this.feedReconnectTimer)
        this.feedReconnectTimer = undefined
      }
      if (this.feedWebSocket) {
        try {
          this.feedWebSocket.close()
        } catch (error) {
          console.error('Failed to close feed WebSocket', error)
        }
        this.feedWebSocket = undefined
      }
      this.feedWebSocketConnected = false
    },
    teardownGameLogWebSocket() {
      if (this.gamelogReconnectTimer !== undefined) {
        clearTimeout(this.gamelogReconnectTimer)
        this.gamelogReconnectTimer = undefined
      }
      if (this.gamelogWebSocket) {
        try {
          this.gamelogWebSocket.close()
        } catch (error) {
          console.error('Failed to close gamelog WebSocket', error)
        }
        this.gamelogWebSocket = undefined
      }
      this.gamelogWebSocketConnected = false
    },
    handleFeedWebSocketMessage(event) {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'feed') {
          this.updateFeedFromWebSocket(data.items)
        } else if (data.type === 'error') {
          console.error('Feed WebSocket error:', data.message)
          this.feedWebSocketConnected = false
          if (this.feedWebSocket) {
            this.feedWebSocket.close()
          }
        }
      } catch (error) {
        console.error('Failed to parse feed WebSocket message', error)
      }
    },
    handleGameLogWebSocketMessage(event) {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'gamelog') {
          this.updateGameLogFromWebSocket(data.items)
        } else if (data.type === 'error') {
          console.error('Gamelog WebSocket error:', data.message)
          this.gamelogWebSocketConnected = false
          if (this.gamelogWebSocket) {
            this.gamelogWebSocket.close()
          }
        }
      } catch (error) {
        console.error('Failed to parse gamelog WebSocket message', error)
      }
    },
    updateFeedFromWebSocket(items) {
      const loadingItems = []
      for (const [type, records] of Object.entries(items)) {
        loadingItems.push(...this.buildFeedItems(type, records))
      }
      loadingItems.sort((a, b) => {
        return b.created_at - a.created_at
      })
      this.feed.loadingItems = loadingItems
      this.feed.items = loadingItems
    },
    updateGameLogFromWebSocket(items) {
      const loadingItems = []
      for (const [type, records] of Object.entries(items)) {
        loadingItems.push(...this.buildGameLogItems(type, records))
      }
      loadingItems.sort((a, b) => {
        return b.created_at - a.created_at
      })
      this.gamelog.loadingItems = loadingItems
      this.gamelog.items = loadingItems
    },
    buildFeedItems(type, records) {
      const normalizedType = String(type)
      const entries = Array.isArray(records) ? records : []
      const items = []
      for (const record of entries) {
        const createdAt = new Date(record.created_at)
        if (Number.isNaN(createdAt.getTime())) {
          continue
        }

        switch (normalizedType) {
          case 'gps': {
            items.push({
              id: `gps-${record.id}`,
              created_at: createdAt,
              type: 'gps',
              display_name: record.display_name,
              details: this.getWorldName(record),
              data: record,
            })
            break
          }
          case 'status': {
            items.push({
              id: `status-${record.id}`,
              created_at: createdAt,
              type: 'status',
              display_name: record.display_name,
              details: `${record.status_description} (${record.status})`,
              data: record,
            })
            break
          }
          case 'bio': {
            items.push({
              id: `bio-${record.id}`,
              created_at: createdAt,
              type: 'bio',
              display_name: record.display_name,
              details: record.bio,
              data: record,
            })
            break
          }
          case 'avatar': {
            items.push({
              id: `avatar-${record.id}`,
              created_at: createdAt,
              type: 'avatar',
              display_name: record.display_name,
              details: record.avatar_name,
              data: record,
            })
            break
          }
          case 'online_offline': {
            const subtype = (record.type || 'online_offline').toLowerCase()
            items.push({
              id: `${subtype}-${record.id}`,
              created_at: createdAt,
              type: subtype,
              display_name: record.display_name,
              details: this.getWorldName(record),
              data: record,
            })
            break
          }
          default: {
            break
          }
        }
      }
      return items
    },
    buildGameLogItems(type, records) {
      const normalizedType = String(type)
      const entries = Array.isArray(records) ? records : []
      const items = []
      for (const record of entries) {
        const createdAt = new Date(record.created_at)
        if (Number.isNaN(createdAt.getTime())) {
          continue
        }
        switch (normalizedType) {
          case 'location': {
            items.push({
              id: `location-${record.id}`,
              created_at: createdAt,
              type: 'location',
              display_name: '',
              details: this.getWorldName(record),
              data: record,
            })
            break
          }
          case 'join_leave': {
            const subtype = (record.type || 'join_leave').toLowerCase()
            items.push({
              id: `${subtype}-${record.id}`,
              created_at: createdAt,
              type: subtype,
              display_name: record.display_name,
              details: '',
              data: record,
            })
            break
          }
          case 'video_play': {
            items.push({
              id: `video_play-${record.id}`,
              created_at: createdAt,
              type: 'video_play',
              display_name: record.display_name,
              details: record.video_name,
              data: record,
            })
            break
          }
          case 'event': {
            items.push({
              id: `event-${record.id}`,
              created_at: createdAt,
              type: 'event',
              display_name: '',
              details: record.data,
              data: record,
            })
            break
          }
          default: {
            break
          }
        }
      }
      return items
    },
    startPolling() {
      if (this.pollingInterval !== undefined) {
        return
      }
      this.pollingInterval = setInterval(() => {
        this.fetchRecords(1, this.defaultLimit).catch((error) => {
          console.error('Failed to fetch records during polling', error)
        })
      }, 10_000)
    },
    stopPolling() {
      if (this.pollingInterval !== undefined) {
        clearInterval(this.pollingInterval)
        this.pollingInterval = undefined
      }
    },
    updatePollingState() {
      if (this.feedWebSocketConnected && this.gamelogWebSocketConnected) {
        this.stopPolling()
      } else {
        this.startPolling()
      }
    },
    async fetchUserId() {
      const url = new URL('/api/configs', this.apiBaseUrl)
      const response = await fetch(url)
      const data = await response.json()

      const key = 'config:lastuserloggedin'
      const config = data.find((item) => item.key === key)
      this.userId = config ? config.value : ''
    },
    async fetchRecords(page, limit) {
      if (this.tab === 1) {
        if (this.feedWebSocketConnected) {
          return
        }
        await this.fetchAllFeed(page, limit)
      } else if (this.tab === 2) {
        if (this.gamelogWebSocketConnected) {
          return
        }
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
      url.searchParams.append('limit', limit || this.defaultLimit)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      this.feed.loadingItems.push(...this.buildFeedItems(type, items))
    },
    async fetchStatusFeed(page, limit) {
      const type = 'status'
      const pathUserId = this.userId.replaceAll(/[_-]/g, '')
      const path = `/api/${pathUserId}_feed_${type}`
      const url = new URL(path, this.apiBaseUrl)
      url.searchParams.append('limit', limit || this.defaultLimit)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      this.feed.loadingItems.push(...this.buildFeedItems(type, items))
    },
    async fetchBioFeed(page, limit) {
      const type = 'bio'
      const pathUserId = this.userId.replaceAll(/[_-]/g, '')
      const path = `/api/${pathUserId}_feed_${type}`
      const url = new URL(path, this.apiBaseUrl)
      url.searchParams.append('limit', limit || this.defaultLimit)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      this.feed.loadingItems.push(...this.buildFeedItems(type, items))
    },
    async fetchAvatarFeed(page, limit) {
      const type = 'avatar'
      const pathUserId = this.userId.replaceAll(/[_-]/g, '')
      const path = `/api/${pathUserId}_feed_${type}`
      const url = new URL(path, this.apiBaseUrl)
      url.searchParams.append('limit', limit || this.defaultLimit)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      this.feed.loadingItems.push(...this.buildFeedItems(type, items))
    },
    async fetchOnlineOfflineFeed(page, limit) {
      const type = 'online_offline'
      const pathUserId = this.userId.replaceAll(/[_-]/g, '')
      const path = `/api/${pathUserId}_feed_${type}`
      const url = new URL(path, this.apiBaseUrl)
      url.searchParams.append('limit', limit || this.defaultLimit)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      this.feed.loadingItems.push(...this.buildFeedItems(type, items))
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
      url.searchParams.append('limit', limit || this.defaultLimit)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      this.gamelog.loadingItems.push(...this.buildGameLogItems(type, items))
    },
    async fetchJoinLeaveLog(page, limit) {
      const type = 'join_leave'
      const path = `/api/gamelog_${type}`
      const url = new URL(path, this.apiBaseUrl)
      url.searchParams.append('limit', limit || this.defaultLimit)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      this.gamelog.loadingItems.push(...this.buildGameLogItems(type, items))
    },
    async fetchVideoPlayLog(page, limit) {
      const type = 'video_play'
      const path = `/api/gamelog_${type}`
      const url = new URL(path, this.apiBaseUrl)
      url.searchParams.append('limit', limit || this.defaultLimit)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      this.gamelog.loadingItems.push(...this.buildGameLogItems(type, items))
    },
    async fetchEventLog(page, limit) {
      const type = 'event'
      const path = `/api/gamelog_${type}`
      const url = new URL(path, this.apiBaseUrl)
      url.searchParams.append('limit', limit || this.defaultLimit)
      url.searchParams.append('page', page || 1)
      const response = await fetch(url)

      const items = await response.json()
      this.gamelog.loadingItems.push(...this.buildGameLogItems(type, items))
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
