<script setup>
import { computed } from 'vue';

const props = defineProps({
  text: {
    type: String,
    required: true
  }
});

const words = computed(() => {
  return props.text.trim() ? props.text.trim().split(/\s+/).length : 0;
});

const characters = computed(() => {
  return props.text.length;
});

const stats = computed(() => [
  { label: "Words", value: words.value },
  { label: "Characters", value: characters.value }
]);
</script>

<template>
  <div class="flex flex-wrap gap-3">
    <div
      v-for="stat in stats"
      :key="stat.label"
      class="rounded-full border border-stone-200/80 bg-white px-4 py-2.5 text-sm text-stone-600 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-stone-900/80 dark:text-stone-300"
    >
      <span class="mono-ui mr-2 text-[10px] uppercase tracking-[0.24em] text-stone-400 dark:text-stone-500">{{ stat.label }}</span>
      <span class="font-semibold text-stone-900 dark:text-stone-100">{{ stat.value }}</span>
    </div>
  </div>
</template>
