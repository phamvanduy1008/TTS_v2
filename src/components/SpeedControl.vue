<script setup>
const props = defineProps({
  speed: {
    type: Number,
    required: true
  }
});

const emit = defineEmits(['speedChange']);

const handleSpeedChange = (event) => {
  emit('speedChange', parseFloat(event.target.value));
};
</script>

<template>
  <div class="flex w-full items-center gap-3">
    <label for="speed-control" class="mono-ui text-[10px] font-semibold uppercase tracking-[0.24em] text-stone-500 dark:text-stone-400">Speed</label>
    <div class="flex w-full items-center gap-3">
      <input
        id="speed-control"
        type="range"
        :value="speed"
        @input="handleSpeedChange"
        min="0.5"
        max="2"
        step="0.1"
        class="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-stone-200 dark:bg-stone-700 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-orange-500 [&::-webkit-slider-thumb]:shadow-[0_2px_10px_rgba(249,115,22,0.35)]"
      />
      <div class="mono-ui rounded-full border border-stone-200/80 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 dark:border-white/10 dark:bg-stone-950 dark:text-stone-100">
        {{ speed }}x
      </div>
    </div>
  </div>
</template>
