<script setup>
import { ref, onMounted } from 'vue';

const emit = defineEmits(['text-click']);

const demos = ref([]);
const loading = ref(true);

// Load demo data
const loadDemos = async () => {
  loading.value = true;
  const demoFiles = [
    { filename: 'duy_oryx_demo', speaker: 'Duy Oryx' },
    { filename: 'manh_dung_demo', speaker: 'Mạnh Dũng' },
    { filename: 'my_tam_demo', speaker: 'Mỹ Tâm' },
    { filename: 'ngoc_huyen_moi_demo', speaker: 'Ngọc Huyền (mới)' },
    { filename: 'ngoc_ngan_demo', speaker: 'Ngọc Ngạn' },
    { filename: 'tran_thanh_demo', speaker: 'Trấn Thành' },
    { filename: 'viet_thao_demo', speaker: 'Việt Thảo' },
    { filename: 'minh_quang_demo', speaker: 'Minh Quang' },
    { filename: 'mai_phuong_demo', speaker: 'Mai Phương' },
    { filename: 'my_tam_real_demo', speaker: 'Mỹ Tâm Real' },
    { filename: 'chieu_thanh_demo', speaker: 'Chiếu Thành' },
    { filename: 'lac_phi_demo', speaker: 'Lạc Phi' },
    { filename: 'thanh_phuong_viettel_demo', speaker: 'Thanh Phương Viettel' },
	{ filename: 'phuong_trang_demo', speaker: 'Phương Trang' },
	{ filename: 'thien_tam_demo', speaker: 'Thiện Tâm' },
	{ filename: 'ban_mai_demo', speaker: 'Ban Mai' },
	{ filename: 'tai_an_demo', speaker: 'Tài An' },
	{ filename: 'minh_khang_demo', speaker: 'Minh Khang' },
  ];

  try {
    const demoPromises = demoFiles.map(async ({ filename, speaker }) => {
      try {
        const response = await fetch(`/demo/${filename}.txt`);
        if (!response.ok) throw new Error(`Failed to load ${filename}.txt`);
        const text = await response.text();
        return {
          text: text.trim(),
          speaker: speaker,
          audioUrl: `/demo/${filename}.wav`
        };
      } catch (error) {
        console.error(`Error loading ${filename}:`, error);
        return null;
      }
    });

    const results = await Promise.all(demoPromises);
    demos.value = results.filter(demo => demo !== null);
  } catch (error) {
    console.error('Error loading demos:', error);
  } finally {
    loading.value = false;
  }
};

const handleTextClick = (demoText) => {
  emit('text-click', demoText);
};

onMounted(() => {
  loadDemos();
});
</script>


