<template>
  <button
    @click="toggleTheme"
    class="rounded-full border border-stone-200 bg-white p-2 text-stone-700 shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-all duration-200 ease-in-out hover:border-stone-900 hover:bg-stone-50 hover:text-stone-950 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-teal-300/60 dark:hover:bg-stone-800 dark:hover:text-teal-100 dark:focus:ring-teal-400 dark:focus:ring-offset-stone-950"
    :title="isDark ? 'Chuyen sang che do sang' : 'Chuyen sang che do toi'"
  >
    <transition name="icon-fade" mode="out-in">
      <SunIcon v-if="isDark" key="sun" class="w-5 h-5" />
      <MoonIcon v-else key="moon" class="w-5 h-5" />
    </transition>
  </button>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import { SunIcon, MoonIcon } from 'lucide-vue-next';

const isDark = ref(false);

const toggleTheme = () => {
  isDark.value = !isDark.value;
};

const applyTheme = (dark) => {
  if (dark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  localStorage.setItem('theme', dark ? 'dark' : 'light');
};

watch(isDark, (newValue) => {
  applyTheme(newValue);
});

onMounted(() => {
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  if (savedTheme) {
    isDark.value = savedTheme === 'dark';
  } else {
    isDark.value = systemPrefersDark;
  }
  
  applyTheme(isDark.value);
});
</script>

<style scoped>
.icon-fade-enter-active,
.icon-fade-leave-active {
  transition: all 0.2s ease-in-out;
}

.icon-fade-enter-from {
  opacity: 0;
  transform: rotate(-90deg) scale(0.8);
}

.icon-fade-leave-to {
  opacity: 0;
  transform: rotate(90deg) scale(0.8);
}
</style>
