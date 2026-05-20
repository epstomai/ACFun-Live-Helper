<template>
  <div ref="rootRef" class="ss-root" :class="{ open }">
    <button
      type="button"
      class="ss-trigger"
      :title="modelValue"
      @click="toggle"
    >
      <span class="ss-value" :class="{ placeholder: !modelValue }">
        {{ modelValue || placeholder }}
      </span>
      <ChevronDown :size="14" class="ss-arrow" />
    </button>
    <div v-if="open" class="ss-panel" @pointerdown.stop>
      <div class="ss-search">
        <Search :size="14" class="ss-search-icon" />
        <input
          ref="searchRef"
          v-model="query"
          type="text"
          :placeholder="searchPlaceholder"
          autocomplete="off"
          spellcheck="false"
          @keydown="onKeydown"
        />
      </div>
      <ul ref="listRef" class="ss-options">
        <li
          v-for="(opt, idx) in filtered"
          :key="opt"
          class="ss-option"
          :class="{ active: idx === activeIndex, selected: opt === modelValue }"
          @mousedown.prevent="select(opt)"
          @mouseenter="activeIndex = idx"
        >{{ opt }}</li>
        <li v-if="!filtered.length" class="ss-empty">无匹配项</li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from "vue"
import { ChevronDown, Search } from "@lucide/vue"

const props = defineProps({
  modelValue: { type: String, default: "" },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: "请选择" },
  searchPlaceholder: { type: String, default: "搜索..." },
})

const emit = defineEmits(["update:modelValue", "change"])

const open = ref(false)
const query = ref("")
const activeIndex = ref(0)
const rootRef = ref(null)
const searchRef = ref(null)
const listRef = ref(null)
// 打开时记录原值，未确认前的方向键移动只是"实时预览"，关闭时回滚
let originalValue = ""
let confirmed = false

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.options
  return props.options.filter((opt) => String(opt).toLowerCase().includes(q))
})

function previewActive() {
  if (!open.value) return
  const opt = filtered.value[activeIndex.value]
  if (opt !== undefined && opt !== props.modelValue) {
    emit("update:modelValue", opt)
  }
}

watch(filtered, () => {
  if (activeIndex.value >= filtered.value.length) {
    activeIndex.value = Math.max(0, filtered.value.length - 1)
  }
  previewActive()
})

watch(activeIndex, () => previewActive())

async function toggle() {
  if (open.value) {
    close()
    return
  }
  open.value = true
  query.value = ""
  originalValue = props.modelValue
  confirmed = false
  const idx = props.options.indexOf(props.modelValue)
  activeIndex.value = idx >= 0 ? idx : 0
  await nextTick()
  searchRef.value?.focus()
  scrollActive()
}

function close() {
  if (!open.value) return
  open.value = false
  if (!confirmed && props.modelValue !== originalValue) {
    emit("update:modelValue", originalValue)
  }
}

function select(opt) {
  confirmed = true
  if (opt !== props.modelValue) {
    emit("update:modelValue", opt)
  }
  emit("change", opt)
  open.value = false
}

function onKeydown(event) {
  if (event.key === "ArrowDown") {
    event.preventDefault()
    if (filtered.value.length) {
      activeIndex.value = (activeIndex.value + 1) % filtered.value.length
      scrollActive()
    }
  } else if (event.key === "ArrowUp") {
    event.preventDefault()
    if (filtered.value.length) {
      activeIndex.value = (activeIndex.value - 1 + filtered.value.length) % filtered.value.length
      scrollActive()
    }
  } else if (event.key === "Enter") {
    event.preventDefault()
    const opt = filtered.value[activeIndex.value]
    if (opt) select(opt)
  } else if (event.key === "Escape") {
    event.preventDefault()
    close()
  }
}

async function scrollActive() {
  await nextTick()
  const list = listRef.value
  if (!list) return
  const item = list.children[activeIndex.value]
  if (item && item.scrollIntoView) item.scrollIntoView({ block: "nearest" })
}

function onDocMousedown(event) {
  if (!open.value) return
  if (rootRef.value && !rootRef.value.contains(event.target)) close()
}

onMounted(() => document.addEventListener("mousedown", onDocMousedown))
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocMousedown))
</script>

<style scoped>
.ss-root {
  position: relative;
  display: block;
  width: 100%;
}

.ss-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--field-bg, var(--page));
  color: var(--text);
  font: inherit;
  cursor: pointer;
  transition: border-color 140ms ease, background 140ms ease;
}

.ss-trigger:hover {
  border-color: rgba(253, 76, 93, 0.45);
}

.ss-root.open .ss-trigger {
  border-color: #fd4c5d;
}

.ss-value {
  flex: 1;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
}

.ss-value.placeholder {
  color: var(--muted);
}

.ss-arrow {
  flex: 0 0 auto;
  color: var(--muted);
  transition: transform 160ms ease;
}

.ss-root.open .ss-arrow {
  transform: rotate(180deg);
  color: #fd4c5d;
}

.ss-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--picker-bg, var(--page));
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  min-width: 200px;
  max-height: 300px;
}

.ss-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  margin-bottom: 6px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--field-bg, var(--page));
}

.ss-search:focus-within {
  border-color: #fd4c5d;
}

.ss-search-icon {
  flex: 0 0 auto;
  color: var(--muted);
}

.ss-search input {
  flex: 1;
  min-width: 0;
  height: auto;
  padding: 4px 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
}

/* 覆盖全局 input:focus 的红色 box-shadow，避免和容器边框形成"双框" */
.ss-search input:focus,
.ss-search input:focus-visible {
  border: none;
  box-shadow: none;
}

.ss-options {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  max-height: 240px;
}

.ss-option {
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  color: var(--text);
}

.ss-option.active {
  background: rgba(253, 76, 93, 0.12);
}

.ss-option.selected {
  color: #fd4c5d;
  font-weight: 600;
}

.ss-empty {
  padding: 12px;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}
</style>
