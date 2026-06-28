<script setup>
const props = defineProps({
  models: {
    type: Array,
    required: true
  },
  selectedModel: {
    type: String,
    required: false,
    default: "None"
  }
});

const emit = defineEmits(['modelChange']);

const handleModelChange = (event) => {
  emit('modelChange', event.target.value);
};
</script>

<template>
  <div class="relative flex-1">
    <select
      id="model-selector"
      :value="selectedModel" 
      @change="handleModelChange"
      class="w-full appearance-none rounded-[18px] border-0 bg-transparent px-4 py-3 pr-10 text-sm font-medium text-stone-800 transition focus:outline-none dark:bg-stone-900 dark:text-stone-100"
    >
      <option value="None">None</option>
      <option 
        v-for="model in models" 
        :key="model" 
        :value="model"
      >
        {{ model }}
      </option>
    </select>
    <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3">
      <svg class="h-4 w-4 text-stone-500 dark:text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
      </svg>
    </div>
  </div>
</template>

