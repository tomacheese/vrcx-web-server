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
      pollingTimer: undefined,
      realtime: {
        supported: 'WebSocket' in globalThis,
        connected: false,
        connection: undefined,
        reconnectTimer: undefined,
        reconnectAttempt: 0,
        manualClose: false,
      },
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
    await this.fetchRecords(1, 1000)
    this.startRealtime()
    if (!this.realtime.supported) {
      this.startFallbackPolling()
    }
  },
  beforeUnmount() {
    this.stopFallbackPolling()
    this.teardownRealtime()
  },
  watch: {
    tab() {
      console.log('tab', this.tab)
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
    },
  },
  methods: {
    startRealtime() {
      if (!this.realtime.supported) {
        return
      }
      this.initializeWebSocket()
    },
    initializeWebSocket() {
      const url = new URL('/ws', this.apiBaseUrl)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

      this.teardownRealtime()

      const socket = new WebSocket(url)
      this.realtime.connection = socket

      socket.addEventListener('open', () => {
        this.realtime.connected = true
        this.realtime.reconnectAttempt = 0
        this.stopFallbackPolling()
      })

      socket.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(event.data)
          this.handleRealtimeMessage(payload)
        } catch (error) {
          console.error('Failed to parse realtime message', error)
        }
      })

      socket.addEventListener('close', () => {
        this.realtime.connected = false
        this.realtime.connection = undefined
        if (this.realtime.manualClose) {
          this.realtime.manualClose = false
          return
        }
        this.scheduleReconnect()
        this.startFallbackPolling()
      })

      socket.addEventListener('error', () => {
        socket.close()
      })
    },
    teardownRealtime() {
      if (this.realtime.reconnectTimer) {
        clearTimeout(this.realtime.reconnectTimer)
        this.realtime.reconnectTimer = undefined
      }

      if (this.realtime.connection) {
        this.realtime.manualClose = true
        this.realtime.connection.close()
        this.realtime.connection = undefined
      }

      this.realtime.connected = false
    },
    scheduleReconnect() {
      if (!this.realtime.supported) {
        return
      }

      if (this.realtime.reconnectTimer) {
        return
      }

      const attempt = this.realtime.reconnectAttempt ?? 0
      const delay = Math.min(1e3 * 2 ** attempt, 3e4)

      this.realtime.reconnectTimer = setTimeout(() => {
        this.realtime.reconnectTimer = undefined
        this.realtime.reconnectAttempt = attempt + 1
        this.initializeWebSocket()
      }, delay)
    },
    startFallbackPolling() {
      if (this.pollingTimer) {
        return
      }

      this.fetchRecords(1, 1000)
      this.pollingTimer = setInterval(() => {
        this.fetchRecords(1, 1000)
      }, 10_000)
    },
    stopFallbackPolling() {
      if (this.pollingTimer) {
        clearInterval(this.pollingTimer)
        this.pollingTimer = undefined
      }
    },
    handleRealtimeMessage(message) {
      if (!message || message.event !== 'record') {
        return
      }

      if (message.scope === 'feed') {
        const item = this.createFeedItem(message.type, message.record)
        if (!item) {
          return
        }
        this.feed.items = this.upsertItems(this.feed.items, item)
      } else if (message.scope === 'gamelog') {
        const item = this.createGameLogItem(message.type, message.record)
        if (!item) {
          return
        }
        this.gamelog.items = this.upsertItems(this.gamelog.items, item)
      }
    },
    createFeedItem(type, record) {
      if (!record || typeof record !== 'object') {
        return
      }

      const createdAt = new Date(record.created_at)
      if (Number.isNaN(createdAt.getTime())) {
        return
      }

      const base = {
        id: `${type}-${record.id}`,
        created_at: createdAt,
        type,
        display_name: record.display_name ?? '',
        details: '',
        data: record,
      }

      switch (type) {
        case 'gps': {
          base.details = this.getWorldName(record)
          break
        }
        case 'status': {
          const statusDescription = record.status_description ?? ''
          const status = record.status ?? ''
          base.details = `${statusDescription} (${status})`
          break
        }
        case 'bio': {
          base.details = record.bio ?? ''
          break
        }
        case 'avatar': {
          base.details = record.avatar_name ?? ''
          break
        }
        case 'online_offline': {
          const subtype = (record.type ?? '').toLowerCase()
          base.type = subtype || 'online_offline'
          base.id = `${record.type ?? type}-${record.id}`
          base.details = this.getWorldName(record)
          break
        }
        default: {
          break
        }
      }

      return base
    },
    createGameLogItem(type, record) {
      if (!record || typeof record !== 'object') {
        return
      }

      const createdAt = new Date(record.created_at)
      if (Number.isNaN(createdAt.getTime())) {
        return
      }

      const base = {
        id: `${type}-${record.id}`,
        created_at: createdAt,
        type,
        display_name: record.display_name ?? '',
        details: '',
        data: record,
      }

      switch (type) {
        case 'location': {
          base.details = this.getWorldName(record)
          break
        }
        case 'join_leave': {
          const subtype = (record.type ?? '').toLowerCase()
          base.type = subtype || 'join_leave'
          base.id = `${record.type ?? type}-${record.id}`
          base.display_name = record.display_name ?? ''
          break
        }
        case 'video_play': {
          base.details = record.video_name ?? ''
          break
        }
        case 'event': {
          base.details = record.data ?? ''
          break
        }
        default: {
          break
        }
      }

      return base
    },
    upsertItems(items, newItem) {
      const original = Array.isArray(items) ? items : []
      const filtered = original.filter((item) => item.id !== newItem.id)
      filtered.unshift(newItem)
      filtered.sort((a, b) => b.created_at - a.created_at)
      return filtered.slice(0, 1000)
    },
    async fetchUserId() {
      const url = new URL('/api/configs', this.apiBaseUrl)
      const response = await fetch(url)
      const data = await response.json()

      const key = 'config:lastuserloggedin'
      const config = data.find((item) => item.key === key)
      this.userId = config.value
    },
    async fetchRecords(page, limit) {
      if (this.tab === 1) {
        return this.fetchAllFeed(page, limit)
      } else if (this.tab === 2) {
        return this.fetchAllGameLog(page, limit)
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
})
app.use(vuetify).mount('#app')
