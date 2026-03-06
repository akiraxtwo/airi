<script setup lang="ts">
import McpSettings from '@proj-airi/stage-pages/pages/settings/mcp/McpSettings.vue'
</script>

<template>
  <McpSettings />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.mcp.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.mcp.description
  icon: i-solar:cpu-bold-duotone
  settingsEntry: true
  order: 9
  stageTransition:
    name: slide
</route>
