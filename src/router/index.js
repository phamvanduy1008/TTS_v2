import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router';
import VietnameseView from '../views/VietnameseView.vue';

const router = createRouter({
  history: import.meta.env.VITE_DESKTOP === '1'
    ? createWebHashHistory(import.meta.env.BASE_URL)
    : createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'vietnamese',
      component: VietnameseView,
    },
  ],
});

export default router;
