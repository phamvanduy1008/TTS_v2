<template>
  <div class="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.14),_transparent_36%),linear-gradient(180deg,_#fffaf2_0%,_#f7f3ea_100%)] text-stone-900 transition-colors duration-300 dark:bg-[radial-gradient(circle_at_top,_rgba(45,212,191,0.10),_transparent_34%),linear-gradient(180deg,_#17120d_0%,_#211a12_100%)] dark:text-stone-100">
    <div class="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6 sm:px-6 lg:px-8">
      <header class="studio-panel mb-6 overflow-hidden p-6 sm:p-7">
        <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-500 via-amber-300 to-teal-500"></div>
        <div class="flex items-start justify-between gap-4">
          <div class="space-y-3">
            <div class="studio-chip border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-300/20 dark:bg-orange-950/40 dark:text-orange-200">
              Local Vietnamese TTS
            </div>
            <div class="space-y-2">
              <h1 class="text-3xl font-bold tracking-tight">Chuyen van ban thanh giong noi</h1>
              <p class="max-w-3xl text-sm leading-6 text-stone-600 dark:text-stone-300">
                Ban toi gian chi dung model local trong <span class="mono-ui">public/tts-model/vi/</span>.
                Nhap text, chon model, tao audio, nghe va tai WAV.
              </p>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main class="flex-1">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<script setup>
import { RouterView } from 'vue-router';
import ThemeToggle from './components/ThemeToggle.vue';
</script>
