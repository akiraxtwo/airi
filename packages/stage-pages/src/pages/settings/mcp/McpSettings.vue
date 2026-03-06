<script setup lang="ts">
import { useMcpStore } from '@proj-airi/stage-ui/stores/mcp'
import { Button, FieldInput } from '@proj-airi/ui'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const mcpStore = useMcpStore()

const status = ref<'disconnected' | 'connecting' | 'connected'>(
  mcpStore.connected ? 'connected' : 'disconnected',
)
const errorMessage = ref('')
const tools = ref<Array<{ name: string, description: string }>>([])

async function connect() {
  if (!mcpStore.serverCmd) {
    errorMessage.value = 'Server command is required'
    return
  }

  status.value = 'connecting'
  errorMessage.value = ''
  tools.value = []

  try {
    // Build args: prepend cwd change if specified
    const args = mcpStore.serverArgs
      ? mcpStore.serverArgs.split(/\s+/)
      : []

    // Dynamic import to avoid bundling issues
    const { defineInvoke, defineInvokeEventa } = await import('@moeru/eventa')
    const { createContext } = await import('@moeru/eventa/adapters/electron/renderer')

    const electronMcpConnect = defineInvokeEventa<void, { command: string, args: string[], cwd?: string }>('eventa:invoke:electron:mcp:connect')
    const electronMcpListTools = defineInvokeEventa<Array<{ name: string, description: string }>>('eventa:invoke:electron:mcp:list-tools')

    const ipcRenderer = (globalThis as any).window.electron.ipcRenderer
    const { context } = createContext(ipcRenderer)

    const invokeConnect = defineInvoke(context, electronMcpConnect)
    const invokeListTools = defineInvoke(context, electronMcpListTools)

    await invokeConnect({ command: mcpStore.serverCmd, args, cwd: mcpStore.serverCwd || undefined })
    mcpStore.connected = true
    status.value = 'connected'

    // List tools after connect
    const result = await invokeListTools()
    tools.value = result || []
  }
  catch (err: any) {
    status.value = 'disconnected'
    mcpStore.connected = false
    errorMessage.value = err?.message || 'Failed to connect'
  }
}

async function disconnect() {
  try {
    const { defineInvoke, defineInvokeEventa } = await import('@moeru/eventa')
    const { createContext } = await import('@moeru/eventa/adapters/electron/renderer')

    const electronMcpDisconnect = defineInvokeEventa('eventa:invoke:electron:mcp:disconnect')
    const ipcRenderer = (globalThis as any).window.electron.ipcRenderer
    const { context } = createContext(ipcRenderer)
    const invokeDisconnect = defineInvoke(context, electronMcpDisconnect)

    await invokeDisconnect()
  }
  catch {
    // ignore
  }
  finally {
    mcpStore.connected = false
    status.value = 'disconnected'
    tools.value = []
  }
}
</script>

<template>
  <div class="flex flex-col gap-4 pb-4">
    <!-- Connection Settings -->
    <div class="border-2 border-neutral-200/50 rounded-xl bg-white/70 p-4 shadow-sm dark:border-neutral-700/50 dark:bg-neutral-800/70">
      <div class="flex flex-col gap-4">
        <FieldInput
          v-model="mcpStore.serverCmd"
          :label="t('settings.pages.mcp.server-cmd.label')"
          :description="t('settings.pages.mcp.server-cmd.description')"
          :placeholder="t('settings.pages.mcp.server-cmd.placeholder')"
        />
        <FieldInput
          v-model="mcpStore.serverArgs"
          :label="t('settings.pages.mcp.server-args.label')"
          :description="t('settings.pages.mcp.server-args.description')"
          :placeholder="t('settings.pages.mcp.server-args.placeholder')"
        />
        <FieldInput
          v-model="mcpStore.serverCwd"
          :label="t('settings.pages.mcp.server-cwd.label')"
          :description="t('settings.pages.mcp.server-cwd.description')"
          :placeholder="t('settings.pages.mcp.server-cwd.placeholder')"
        />
        <FieldInput
          v-model="mcpStore.serverPrompt"
          :single-line="false"
          :label="t('settings.pages.mcp.server-prompt.label')"
          :description="t('settings.pages.mcp.server-prompt.description')"
          :placeholder="t('settings.pages.mcp.server-prompt.placeholder')"
        />

        <!-- Status + Actions -->
        <div class="flex items-center gap-3">
          <Button
            v-if="status !== 'connected'"
            :disabled="status === 'connecting'"
            @click="connect"
          >
            {{ status === 'connecting' ? t('settings.pages.mcp.status.connecting') : t('settings.pages.mcp.connect') }}
          </Button>
          <Button
            v-else
            @click="disconnect"
          >
            {{ t('settings.pages.mcp.disconnect') }}
          </Button>

          <div class="flex items-center gap-2">
            <div
              class="h-2.5 w-2.5 rounded-full"
              :class="{
                'bg-green-500': status === 'connected',
                'bg-neutral-400': status === 'disconnected',
                'bg-yellow-500 animate-pulse': status === 'connecting',
              }"
            />
            <span class="text-sm text-neutral-600 dark:text-neutral-400">
              {{ t(`settings.pages.mcp.status.${status}`) }}
            </span>
          </div>
        </div>

        <div v-if="errorMessage" class="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {{ errorMessage }}
        </div>
      </div>
    </div>

    <!-- Available Tools -->
    <div
      v-if="tools.length > 0"
      class="border-2 border-neutral-200/50 rounded-xl bg-white/70 p-4 shadow-sm dark:border-neutral-700/50 dark:bg-neutral-800/70"
    >
      <h3 class="mb-3 text-lg font-medium">
        {{ t('settings.pages.mcp.tools.title') }}
      </h3>
      <div class="flex flex-col gap-2">
        <div
          v-for="tool in tools"
          :key="tool.name"
          class="rounded-lg bg-neutral-100 p-3 dark:bg-neutral-700/50"
        >
          <div class="font-mono text-sm font-medium">
            {{ tool.name }}
          </div>
          <div class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {{ tool.description }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
