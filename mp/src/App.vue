<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { useAppBootstrap } from '@/composables/use-app-bootstrap'

onLaunch(() => {
  // 启动编排：存量清理 gate（同步第一步）→ 会话预热（异步、不阻塞页面）
  useAppBootstrap()
})
</script>

<style>
@import './styles/main.css';
</style>
