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
      userId: '',
      loading: false,
      expanded: [],
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
      items: [],
      types: {
        gps: 'GPS',
        status: 'Status',
        bio: 'Bio',
        avatar: 'Avatar',
        online: 'Online',
        offline: 'Offline',
      },
    }
  },
  async mounted() {
    if (!this.apiBaseUrl) {
      this.apiBaseUrl = globalThis.location.origin
    }

    await this.fetchUserId()
    await this.fetchAll(1, 1000)

    setInterval(() => {
      this.fetchAll(1, 1000)
    }, 1000 * 60)
  },
  methods: {
    async fetchAll(page, limit) {
      this.items = []
      await Promise.all([
        this.fetchGpsFeed(page, limit),
        this.fetchStatusFeed(page, limit),
        this.fetchBioFeed(page, limit),
        this.fetchAvatarFeed(page, limit),
        this.fetchOnlineOfflineFeed(page, limit),
      ]).then(() => {
        this.items.sort((a, b) => {
          return b.created_at - a.created_at
        })
      })
    },
    async fetchUserId() {
      const url = new URL('/api/configs', this.apiBaseUrl)
      const response = await fetch(url)
      const data = await response.json()

      const key = 'config:lastuserloggedin'
      const config = data.find((item) => item.key === key)
      this.userId = config.value
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
        this.items.push({
          id: `${type}-${item.id}`,
          created_at: new Date(item.created_at),
          type,
          display_name: item.display_name,
          details: item.world_name,
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
        this.items.push({
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
        this.items.push({
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
        this.items.push({
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
        this.items.push({
          id: `${item.type}-${item.id}`,
          created_at: new Date(item.created_at),
          type: item.type.toLowerCase(),
          display_name: item.display_name,
          details: item.world_name,
          data: item,
        })
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
